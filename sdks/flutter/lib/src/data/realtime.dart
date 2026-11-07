import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

import '../support/backoff.dart';
import 'transport.dart';

typedef SuperBoardRealtimeConnector = WebSocketChannel Function(Uri uri);

final RegExp _channelPattern = RegExp(r'^[A-Za-z0-9:_.-]{1,64}$');
final RegExp _presenceKeyPattern = RegExp(r'^[A-Za-z0-9:_.@-]{1,64}$');

enum SuperBoardRealtimeConnectionState { disconnected, connecting, connected }

enum SuperBoardRealtimeChannelStatus { closed, joining, joined, errored }

enum SuperBoardRealtimeChangeEvent { insert, update, delete }

enum SuperBoardPresenceEventType { sync, join, leave }

class SuperBoardRealtimeBroadcast {
  const SuperBoardRealtimeBroadcast({
    required this.channel,
    required this.event,
    this.payload,
  });

  final String channel;
  final String event;
  final Object? payload;
}

class SuperBoardRealtimeChange {
  const SuperBoardRealtimeChange({
    required this.channel,
    required this.table,
    required this.event,
    this.record,
    this.oldRecord,
    this.commitTimestamp,
  });

  final String channel;
  final String table;
  final SuperBoardRealtimeChangeEvent event;
  final Map<String, dynamic>? record;
  final Map<String, dynamic>? oldRecord;
  final DateTime? commitTimestamp;
}

class SuperBoardPresenceEvent {
  const SuperBoardPresenceEvent({
    required this.type,
    required this.state,
    this.key,
    this.presences = const [],
  });

  final SuperBoardPresenceEventType type;

  /// Presence key that joined or left; null for [SuperBoardPresenceEventType.sync].
  final String? key;

  /// States that joined or left under [key].
  final List<Object?> presences;

  /// Every state on the channel after this event, grouped by presence key.
  final Map<String, List<Object?>> state;
}

class SuperBoardRealtime {
  SuperBoardRealtime(
    this._transport, {
    SuperBoardRealtimeConnector? connector,
    this.heartbeatInterval = const Duration(seconds: 25),
    this.replyTimeout = const Duration(seconds: 10),
    List<Duration> reconnectDelays = const [
      Duration(seconds: 1),
      Duration(seconds: 2),
      Duration(seconds: 5),
      Duration(seconds: 10),
      Duration(seconds: 30),
    ],
  }) : _connector = connector ?? WebSocketChannel.connect,
       _reconnectDelays = List.unmodifiable(reconnectDelays) {
    if (_reconnectDelays.isEmpty) {
      throw ArgumentError.value(
        reconnectDelays,
        'reconnectDelays',
        'At least one reconnect delay is required',
      );
    }
  }

  final SuperBoardDataTransport _transport;
  final SuperBoardRealtimeConnector _connector;
  final List<Duration> _reconnectDelays;
  final Duration heartbeatInterval;
  final Duration replyTimeout;
  final Map<String, SuperBoardRealtimeChannel> _channels = {};
  final Map<String, Completer<Map<String, dynamic>>> _replies = {};
  final StreamController<SuperBoardRealtimeConnectionState> _states =
      StreamController.broadcast(sync: true);
  final StreamController<SuperBoardDataException> _errors =
      StreamController.broadcast(sync: true);

  SuperBoardRealtimeConnectionState _state =
      SuperBoardRealtimeConnectionState.disconnected;
  WebSocketChannel? _socket;
  StreamSubscription<Object?>? _subscription;
  Future<void>? _connecting;
  Timer? _heartbeat;
  Timer? _reconnectTimer;
  String? _unansweredPing;
  int _attempt = 0;
  int _ref = 0;
  bool _disposed = false;

  SuperBoardRealtimeConnectionState get connectionState => _state;
  Stream<SuperBoardRealtimeConnectionState> get connectionStates =>
      _states.stream;

  /// Server errors that are not tied to a channel.
  Stream<SuperBoardDataException> get errors => _errors.stream;

  /// Returns the channel named [name], creating it on first use. Channels
  /// named `db:<table>` deliver row changes of that table.
  SuperBoardRealtimeChannel channel(String name, {String? presenceKey}) {
    if (_disposed) throw StateError('SuperBoard realtime is disposed');
    if (!_channelPattern.hasMatch(name)) {
      throw ArgumentError.value(name, 'name', 'Invalid channel name');
    }
    if (presenceKey != null && !_presenceKeyPattern.hasMatch(presenceKey)) {
      throw ArgumentError.value(presenceKey, 'presenceKey', 'Invalid key');
    }
    final existing = _channels[name];
    if (existing != null) {
      if (existing.presenceKey != presenceKey) {
        throw StateError('Channel $name already uses another presence key');
      }
      return existing;
    }
    return _channels[name] = SuperBoardRealtimeChannel._(
      this,
      name,
      presenceKey,
    );
  }

  /// Closes the socket and every channel. Channels can be subscribed again.
  Future<void> disconnect() async {
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    for (final channel in _channels.values) {
      channel._close();
    }
    await _closeSocket(SuperBoardRealtimeConnectionState.disconnected);
  }

  Future<void> dispose() async {
    if (_disposed) return;
    await disconnect();
    _disposed = true;
    for (final channel in _channels.values) {
      await channel._dispose();
    }
    _channels.clear();
    await _states.close();
    await _errors.close();
  }

  Future<void> _ensureConnected() {
    if (_disposed) {
      return Future.error(StateError('SuperBoard realtime is disposed'));
    }
    if (_socket != null) return Future.value();
    return _connecting ??= _open().whenComplete(() => _connecting = null);
  }

  Future<void> _open() async {
    _setState(SuperBoardRealtimeConnectionState.connecting);
    try {
      final ticket = asObject(
        await _transport.sendJson(
          'POST',
          _transport.uri(['realtime', 'tickets']),
        ),
      );
      final url = Uri.tryParse(ticket['url']?.toString() ?? '');
      if (url == null || !const {'ws', 'wss'}.contains(url.scheme)) {
        throw const SuperBoardDataException(
          'server_response_invalid',
          'SuperBoard returned an invalid realtime URL',
        );
      }
      final socket = _connector(url);
      final subscription = socket.stream.listen(
        _receive,
        onError: (Object _) => _connectionLost(socket),
        onDone: () => _connectionLost(socket),
        cancelOnError: true,
      );
      try {
        await socket.ready.timeout(replyTimeout);
      } on Object {
        await subscription.cancel();
        unawaited(socket.sink.close().catchError((Object _) {}));
        rethrow;
      }
      _socket = socket;
      _subscription = subscription;
      _attempt = 0;
      _unansweredPing = null;
      _heartbeat?.cancel();
      _heartbeat = Timer.periodic(heartbeatInterval, (_) => _beat());
      _reconnectTimer?.cancel();
      _reconnectTimer = null;
      _setState(SuperBoardRealtimeConnectionState.connected);
      for (final channel in _channels.values.toList()) {
        channel._resume();
      }
    } on SuperBoardDataException {
      _setState(SuperBoardRealtimeConnectionState.disconnected);
      rethrow;
    } on Object catch (error) {
      _setState(SuperBoardRealtimeConnectionState.disconnected);
      throw SuperBoardDataException(
        'realtime_connection_failed',
        'The realtime connection could not be opened: $error',
        retryable: true,
      );
    }
  }

  void _beat() {
    if (_unansweredPing != null) {
      final socket = _socket;
      if (socket != null) _connectionLost(socket);
      return;
    }
    final ref = _nextRef();
    _unansweredPing = ref;
    _write({'type': 'ping', 'ref': ref});
  }

  void _connectionLost(WebSocketChannel socket) {
    if (!identical(socket, _socket)) return;
    unawaited(
      _closeSocket(SuperBoardRealtimeConnectionState.disconnected).then((_) {
        for (final channel in _channels.values) {
          channel._connectionLost();
        }
        _scheduleReconnect();
      }),
    );
  }

  void _scheduleReconnect() {
    if (_disposed || _reconnectTimer != null) return;
    if (!_channels.values.any((channel) => channel._wanted)) return;
    final base =
        _reconnectDelays[_attempt.clamp(0, _reconnectDelays.length - 1)];
    _attempt += 1;
    _reconnectTimer = Timer(supportRetryDelayWithJitter(base), () {
      _reconnectTimer = null;
      unawaited(_reconnect());
    });
  }

  Future<void> _reconnect() async {
    if (_disposed) return;
    try {
      await _ensureConnected();
    } on Object catch (error) {
      if (error is SuperBoardDataException) _emitError(error);
      _scheduleReconnect();
    }
  }

  Future<void> _closeSocket(SuperBoardRealtimeConnectionState state) async {
    _heartbeat?.cancel();
    _heartbeat = null;
    _unansweredPing = null;
    final socket = _socket;
    final subscription = _subscription;
    _socket = null;
    _subscription = null;
    _failReplies(
      const SuperBoardDataException(
        'realtime_disconnected',
        'The realtime connection closed',
        retryable: true,
      ),
    );
    await subscription?.cancel();
    if (socket != null) {
      unawaited(socket.sink.close(1000).catchError((Object _) {}));
    }
    _setState(state);
  }

  Future<void> _closeIfIdle() async {
    if (_channels.values.any((channel) => channel._active)) return;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    await _closeSocket(SuperBoardRealtimeConnectionState.disconnected);
  }

  Future<Map<String, dynamic>> _request(Map<String, Object?> message) {
    final ref = _nextRef();
    final completer = Completer<Map<String, dynamic>>();
    _replies[ref] = completer;
    if (!_write({...message, 'ref': ref})) {
      _replies.remove(ref);
      return Future.error(
        const SuperBoardDataException(
          'realtime_disconnected',
          'The realtime connection is closed',
          retryable: true,
        ),
      );
    }
    return completer.future
        .timeout(
          replyTimeout,
          onTimeout: () => throw const SuperBoardDataException(
            'realtime_timeout',
            'The realtime server did not answer in time',
            retryable: true,
          ),
        )
        .whenComplete(() => _replies.remove(ref));
  }

  bool _write(Map<String, Object?> message) {
    final socket = _socket;
    if (socket == null) return false;
    socket.sink.add(jsonEncode(message));
    return true;
  }

  void _receive(Object? raw) {
    final Map<String, dynamic> message;
    try {
      final text = raw is String ? raw : utf8.decode(raw! as List<int>);
      final decoded = jsonDecode(text);
      if (decoded is! Map) return;
      message = decoded.cast<String, dynamic>();
    } on Object {
      return;
    }
    final type = message['type'];
    final ref = message['ref']?.toString();
    if (type == 'pong') {
      if (ref == _unansweredPing) _unansweredPing = null;
      return;
    }
    if (ref != null) {
      final reply = _replies.remove(ref);
      if (reply != null && !reply.isCompleted) {
        if (type == 'error') {
          reply.completeError(_serverError(message));
        } else {
          reply.complete(message);
        }
        return;
      }
    }
    final channel = _channels[message['channel']?.toString()];
    if (channel != null) {
      channel._receive(message);
    } else if (type == 'error') {
      _emitError(_serverError(message));
    }
  }

  void _failReplies(SuperBoardDataException error) {
    final replies = _replies.values.toList();
    _replies.clear();
    for (final reply in replies) {
      if (!reply.isCompleted) reply.completeError(error);
    }
  }

  void _emitError(SuperBoardDataException error) {
    if (!_errors.isClosed) _errors.add(error);
  }

  void _setState(SuperBoardRealtimeConnectionState state) {
    if (_state == state) return;
    _state = state;
    if (!_states.isClosed) _states.add(state);
  }

  String _nextRef() => '${++_ref}';
}

class SuperBoardRealtimeChannel {
  SuperBoardRealtimeChannel._(this._realtime, this.name, this.presenceKey);

  final SuperBoardRealtime _realtime;
  final String name;
  final String? presenceKey;
  final StreamController<SuperBoardRealtimeChannelStatus> _statuses =
      StreamController.broadcast(sync: true);
  final StreamController<SuperBoardRealtimeBroadcast> _broadcasts =
      StreamController.broadcast(sync: true);
  final StreamController<SuperBoardRealtimeChange> _changes =
      StreamController.broadcast(sync: true);
  final StreamController<SuperBoardPresenceEvent> _presence =
      StreamController.broadcast(sync: true);
  final StreamController<SuperBoardDataException> _errors =
      StreamController.broadcast(sync: true);
  final Map<String, List<Object?>> _presences = {};

  SuperBoardRealtimeChannelStatus _status =
      SuperBoardRealtimeChannelStatus.closed;
  Future<void>? _joining;
  Map<String, Object?>? _tracked;
  bool _wanted = false;
  int _generation = 0;

  SuperBoardRealtimeChannelStatus get status => _status;
  Stream<SuperBoardRealtimeChannelStatus> get statusChanges => _statuses.stream;
  Stream<SuperBoardRealtimeBroadcast> get broadcasts => _broadcasts.stream;
  Stream<SuperBoardRealtimeChange> get changes => _changes.stream;
  Stream<SuperBoardPresenceEvent> get presenceEvents => _presence.stream;
  Stream<SuperBoardDataException> get errors => _errors.stream;

  Map<String, List<Object?>> get presenceState => _snapshot();

  bool get isDatabaseChannel => name.startsWith('db:');

  bool get _active =>
      _wanted || _status == SuperBoardRealtimeChannelStatus.joining;

  /// Joins the channel. Once joined, the channel is joined again after each
  /// reconnection until [unsubscribe]. When this throws, the channel is not
  /// joined.
  Future<void> subscribe() async {
    if (_status == SuperBoardRealtimeChannelStatus.joined) return;
    await (_joining ??= _subscribe().whenComplete(() => _joining = null));
    if (_status != SuperBoardRealtimeChannelStatus.joined) {
      throw const SuperBoardDataException(
        'channel_not_joined',
        'The channel could not be joined yet',
        retryable: true,
      );
    }
  }

  Future<void> _subscribe() async {
    final generation = _generation;
    _setStatus(SuperBoardRealtimeChannelStatus.joining);
    try {
      await _realtime._ensureConnected();
      await _join();
    } on Object {
      if (generation == _generation) {
        _wanted = false;
        _tracked = null;
        _presences.clear();
        _setStatus(SuperBoardRealtimeChannelStatus.errored);
      }
      await _realtime._closeIfIdle();
      rethrow;
    }
    if (generation != _generation) {
      _realtime._write({'type': 'leave', 'channel': name});
      return;
    }
    _wanted = true;
    _joined();
  }

  Future<void> unsubscribe() async {
    final joined = _status == SuperBoardRealtimeChannelStatus.joined;
    _wanted = false;
    _tracked = null;
    if (joined) {
      try {
        await _realtime._request({'type': 'leave', 'channel': name});
      } on SuperBoardDataException {
        // The server drops the subscription with the socket anyway.
      }
    }
    _close();
    await _realtime._closeIfIdle();
  }

  /// Sends [event] to the other members, and to this client when [self] is
  /// true. Completes when the server acknowledges it.
  Future<void> send(String event, Object? payload, {bool self = false}) async {
    _requireJoined();
    await _realtime._request({
      'type': 'broadcast',
      'channel': name,
      'event': event,
      'payload': payload,
      if (self) 'self': true,
    });
  }

  /// Publishes this client's presence [state]; it is published again after a
  /// reconnection.
  Future<void> track(Map<String, Object?> state) async {
    _requireJoined();
    _tracked = Map.unmodifiable(state);
    _realtime._write({'type': 'presence', 'channel': name, 'state': state});
  }

  Future<void> untrack() async {
    _requireJoined();
    _tracked = null;
    _realtime._write({'type': 'presence_untrack', 'channel': name});
  }

  Future<void> _join() => _realtime._request({
    'type': 'join',
    'channel': name,
    if (presenceKey != null)
      'config': {
        'presence': {'key': presenceKey},
      },
  });

  void _joined() {
    _setStatus(SuperBoardRealtimeChannelStatus.joined);
    final tracked = _tracked;
    if (tracked != null) {
      _realtime._write({'type': 'presence', 'channel': name, 'state': tracked});
    }
  }

  void _resume() {
    if (!_wanted || _joining != null) return;
    _joining = _rejoin().whenComplete(() => _joining = null);
  }

  Future<void> _rejoin() async {
    final generation = _generation;
    _setStatus(SuperBoardRealtimeChannelStatus.joining);
    try {
      await _join();
    } on Object catch (error) {
      if (generation != _generation) return;
      if (error is SuperBoardDataException && error.retryable) return;
      _wanted = false;
      _tracked = null;
      _setStatus(SuperBoardRealtimeChannelStatus.errored);
      if (error is SuperBoardDataException) _emitError(error);
      await _realtime._closeIfIdle();
      return;
    }
    if (generation != _generation) {
      _realtime._write({'type': 'leave', 'channel': name});
      return;
    }
    _joined();
  }

  void _requireJoined() {
    if (_status != SuperBoardRealtimeChannelStatus.joined) {
      throw const SuperBoardDataException(
        'channel_not_joined',
        'Subscribe to the channel first',
      );
    }
    if (isDatabaseChannel) {
      throw const SuperBoardDataException(
        'channel_read_only',
        'Database channels only deliver changes',
      );
    }
  }

  void _receive(Map<String, dynamic> message) {
    switch (message['type']) {
      case 'broadcast':
        if (!_broadcasts.isClosed) {
          _broadcasts.add(
            SuperBoardRealtimeBroadcast(
              channel: name,
              event: message['event']?.toString() ?? '',
              payload: message['payload'],
            ),
          );
        }
      case 'change':
        final event = switch (message['event']) {
          'INSERT' => SuperBoardRealtimeChangeEvent.insert,
          'UPDATE' => SuperBoardRealtimeChangeEvent.update,
          'DELETE' => SuperBoardRealtimeChangeEvent.delete,
          _ => null,
        };
        if (event == null || _changes.isClosed) return;
        final record = message['record'];
        final oldRecord = message['old_record'];
        _changes.add(
          SuperBoardRealtimeChange(
            channel: name,
            table: message['table']?.toString() ?? name.substring(3),
            event: event,
            record: record is Map ? record.cast<String, dynamic>() : null,
            oldRecord: oldRecord is Map
                ? oldRecord.cast<String, dynamic>()
                : null,
            commitTimestamp: optionalDate(message['commit_timestamp']),
          ),
        );
      case 'presence_state':
        _presences
          ..clear()
          ..addAll(_presenceMap(message['presences']));
        _emitPresence(
          SuperBoardPresenceEvent(
            type: SuperBoardPresenceEventType.sync,
            state: _snapshot(),
          ),
        );
      case 'presence_diff':
        _applyDiff(
          _presenceMap(message['joins']),
          _presenceMap(message['leaves']),
        );
      case 'error':
        _emitError(_serverError(message));
    }
  }

  void _applyDiff(
    Map<String, List<Object?>> joins,
    Map<String, List<Object?>> leaves,
  ) {
    final events = <SuperBoardPresenceEvent>[];
    for (final MapEntry(:key, value: left) in leaves.entries) {
      final current = _presences[key];
      if (current == null) continue;
      for (final state in left) {
        final encoded = jsonEncode(state);
        final index = current.indexWhere((item) => jsonEncode(item) == encoded);
        if (index >= 0) current.removeAt(index);
      }
      if (current.isEmpty) _presences.remove(key);
      events.add(_presenceEvent(SuperBoardPresenceEventType.leave, key, left));
    }
    for (final MapEntry(:key, value: joined) in joins.entries) {
      (_presences[key] ??= []).addAll(joined);
      events.add(_presenceEvent(SuperBoardPresenceEventType.join, key, joined));
    }
    events.forEach(_emitPresence);
    _emitPresence(
      SuperBoardPresenceEvent(
        type: SuperBoardPresenceEventType.sync,
        state: _snapshot(),
      ),
    );
  }

  SuperBoardPresenceEvent _presenceEvent(
    SuperBoardPresenceEventType type,
    String key,
    List<Object?> presences,
  ) => SuperBoardPresenceEvent(
    type: type,
    key: key,
    presences: List.unmodifiable(presences),
    state: _snapshot(),
  );

  void _connectionLost() {
    if (!_wanted) {
      _close();
      return;
    }
    _presences.clear();
    _setStatus(SuperBoardRealtimeChannelStatus.joining);
  }

  void _close() {
    _generation += 1;
    _wanted = false;
    _presences.clear();
    _setStatus(SuperBoardRealtimeChannelStatus.closed);
  }

  Future<void> _dispose() async {
    await _statuses.close();
    await _broadcasts.close();
    await _changes.close();
    await _presence.close();
    await _errors.close();
  }

  Map<String, List<Object?>> _snapshot() => Map.unmodifiable({
    for (final MapEntry(:key, :value) in _presences.entries)
      key: List<Object?>.unmodifiable(value),
  });

  void _emitPresence(SuperBoardPresenceEvent event) {
    if (!_presence.isClosed) _presence.add(event);
  }

  void _emitError(SuperBoardDataException error) {
    if (!_errors.isClosed) _errors.add(error);
  }

  void _setStatus(SuperBoardRealtimeChannelStatus status) {
    if (_status == status) return;
    _status = status;
    if (!_statuses.isClosed) _statuses.add(status);
  }
}

Map<String, List<Object?>> _presenceMap(Object? value) {
  if (value is! Map) return {};
  return {
    for (final entry in value.entries)
      if (entry.value is List)
        entry.key.toString(): List<Object?>.of(entry.value as List),
  };
}

SuperBoardDataException _serverError(Map<String, dynamic> message) {
  final code = message['code']?.toString() ?? 'realtime_error';
  return SuperBoardDataException(
    code,
    'The realtime server refused the request ($code)',
    details: {if (message['channel'] != null) 'channel': message['channel']},
  );
}
