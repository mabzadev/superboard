import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

import 'client.dart';
import 'models.dart';

typedef SuperBoardSupportConnectionFactory =
    Future<SuperBoardSupportConnection> Function(String conversationId);

class SuperBoardSupportConnection {
  SuperBoardSupportConnection.fromChannel(WebSocketChannel channel)
    : this(channel.stream, () => channel.sink.close(1000, 'Client closed'));

  SuperBoardSupportConnection(this.stream, this._close);

  final Stream<dynamic> stream;
  final FutureOr<void> Function() _close;

  Future<void> close() async => _close();
}

class SuperBoardSupportRealtime {
  SuperBoardSupportRealtime(
    SuperBoardSupportClient client, {
    List<Duration>? retryDelays,
  }) : this.withConnectionFactory(
         (conversationId) async => SuperBoardSupportConnection.fromChannel(
           await client.connect(conversationId),
         ),
         retryDelays: retryDelays,
       );

  SuperBoardSupportRealtime.withConnectionFactory(
    this._connect, {
    List<Duration>? retryDelays,
  }) : _retryDelays = retryDelays ?? _defaultRetryDelays;

  static const _defaultRetryDelays = [
    Duration(seconds: 1),
    Duration(seconds: 2),
    Duration(seconds: 5),
    Duration(seconds: 10),
    Duration(seconds: 30),
  ];

  static const _allowedEventTypes = {
    'connected',
    'message.created',
    'message.updated',
    'message.deleted',
    'conversation.updated',
    'typing.started',
    'typing.stopped',
    'conversation.read',
    'delivery.updated',
    'presence.updated',
    'assignment.updated',
    'error',
  };

  final SuperBoardSupportConnectionFactory _connect;
  final List<Duration> _retryDelays;
  final _events = StreamController<String>.broadcast();
  final _typedEvents = StreamController<SuperBoardSupportRealtimeEvent>.broadcast();
  SuperBoardSupportConnection? _connection;
  StreamSubscription<dynamic>? _subscription;
  Timer? _retryTimer;
  String? _conversationId;
  int _generation = 0;
  int _attempt = 0;
  int _localEventSequence = 0;
  bool _requested = false;
  bool _disposed = false;

  Stream<String> get events => _events.stream;
  Stream<SuperBoardSupportRealtimeEvent> get typedEvents => _typedEvents.stream;
  bool get connected => _connection != null;
  String? get conversationId => _conversationId;

  Future<void> connect(String conversationId) async {
    final normalized = conversationId.trim();
    if (normalized.isEmpty || normalized.length > 255) {
      throw const SuperBoardSupportException(
        'conversation_id_invalid',
        'A valid conversation ID is required',
      );
    }
    if (_disposed) {
      throw const SuperBoardSupportException(
        'realtime_disposed',
        'Support realtime has been disposed',
      );
    }
    await _stopCurrentConnection();
    _requested = true;
    _conversationId = normalized;
    _attempt = 0;
    final generation = ++_generation;
    await _open(generation, surfaceFailure: true);
  }

  Future<void> disconnect() async {
    if (_disposed) return;
    _requested = false;
    _conversationId = null;
    _attempt = 0;
    _generation += 1;
    await _stopCurrentConnection();
  }

  Future<void> dispose() async {
    if (_disposed) return;
    await disconnect();
    _disposed = true;
    await _typedEvents.close();
    await _events.close();
  }

  Future<void> _open(int generation, {required bool surfaceFailure}) async {
    final conversation = _conversationId;
    if (!_active(generation, conversation)) return;
    try {
      final connection = await _connect(conversation!);
      if (!_active(generation, conversation)) {
        await connection.close();
        return;
      }
      _connection = connection;
      _attempt = 0;
      _emit({
        'schema_version': 1,
        'type': 'connected',
        'event_id': _nextLocalEventId(),
        'conversation_id': conversation,
        'occurred_at': DateTime.now().toUtc().toIso8601String(),
      });
      _subscription = connection.stream.listen(
        (event) => _emitServerEvent(event, conversation),
        onError: (Object error, StackTrace stackTrace) {
          _connectionEnded(connection, generation, conversation, error);
        },
        onDone: () {
          _connectionEnded(connection, generation, conversation, null);
        },
        cancelOnError: true,
      );
    } catch (error) {
      if (!_active(generation, conversation)) return;
      _scheduleReconnect(generation, conversation!, error);
      if (surfaceFailure) {
        throw const SuperBoardSupportException(
          'realtime_connection_failed',
          'Unable to connect to Support realtime',
          retryable: true,
        );
      }
    }
  }

  void _connectionEnded(
    SuperBoardSupportConnection connection,
    int generation,
    String conversation,
    Object? error,
  ) {
    if (!identical(_connection, connection)) return;
    _connection = null;
    _subscription = null;
    unawaited(_closeQuietly(connection));
    _scheduleReconnect(generation, conversation, error);
  }

  void _scheduleReconnect(int generation, String conversation, Object? error) {
    if (!_active(generation, conversation) || _retryTimer != null) return;
    final delay = _retryDelays.isEmpty
        ? Duration.zero
        : _retryDelays[_attempt.clamp(0, _retryDelays.length - 1)];
    _attempt += 1;
    _emitError(
      conversation,
      code: 'realtime_connection_lost',
      message: 'Support realtime connection was interrupted',
      retryable: true,
      details: {'retry_in_ms': delay.inMilliseconds, 'attempt': _attempt},
    );
    _retryTimer = Timer(delay, () {
      _retryTimer = null;
      unawaited(_open(generation, surfaceFailure: false));
    });
  }

  bool _active(int generation, String? conversation) =>
      !_disposed &&
      _requested &&
      generation == _generation &&
      conversation != null &&
      conversation == _conversationId;

  Future<void> _stopCurrentConnection() async {
    _retryTimer?.cancel();
    _retryTimer = null;
    final subscription = _subscription;
    final connection = _connection;
    _subscription = null;
    _connection = null;
    await subscription?.cancel();
    await connection?.close();
  }

  Future<void> _closeQuietly(SuperBoardSupportConnection connection) async {
    try {
      await connection.close();
    } catch (_) {
      // The socket is already unusable; reconnection owns recovery.
    }
  }

  void _emitServerEvent(dynamic event, String conversation) {
    try {
      final decoded = event is String ? jsonDecode(event) : event;
      if (decoded is! Map) throw const FormatException();
      final normalized = decoded.map(
        (key, value) => MapEntry(key.toString(), value),
      );
      final type = normalized['type']?.toString();
      if (!_allowedEventTypes.contains(type)) throw const FormatException();
      // `_open` owns the public connection lifecycle event. The server
      // acknowledgement contains no additional public state and would
      // otherwise produce a duplicate event for every connection/reconnect.
      if (type == 'connected') return;
      _emit({
        ...normalized,
        'schema_version': 1,
        'type': type,
        'event_id': normalized['event_id']?.toString() ?? _nextLocalEventId(),
        'conversation_id':
            normalized['conversation_id']?.toString() ?? conversation,
        'occurred_at':
            normalized['occurred_at']?.toString() ??
            DateTime.now().toUtc().toIso8601String(),
      });
    } catch (_) {
      _emitError(
        conversation,
        code: 'realtime_event_invalid',
        message: 'Support realtime returned an invalid event',
        retryable: false,
      );
    }
  }

  void _emitError(
    String conversation, {
    required String code,
    required String message,
    required bool retryable,
    Map<String, dynamic>? details,
  }) {
    _emit({
      'schema_version': 1,
      'type': 'error',
      'event_id': _nextLocalEventId(),
      'conversation_id': conversation,
      'occurred_at': DateTime.now().toUtc().toIso8601String(),
      'error': {
        'code': code,
        'message': message,
        'retryable': retryable,
        if (details != null) 'details': details,
      },
    });
  }

  void _emit(Map<String, dynamic> event) {
    final typed = SuperBoardSupportRealtimeEvent.fromJson(event);
    if (!_typedEvents.isClosed) _typedEvents.add(typed);
    if (!_events.isClosed) _events.add(jsonEncode(typed.toJson()));
  }

  String _nextLocalEventId() {
    _localEventSequence += 1;
    return 'sdk-${DateTime.now().microsecondsSinceEpoch}-$_localEventSequence';
  }
}

@Deprecated('Use SuperBoardSupportConnectionFactory.')
typedef SuperBoardMessagingConnectionFactory =
    SuperBoardSupportConnectionFactory;

@Deprecated('Use SuperBoardSupportConnection.')
typedef SuperBoardMessagingConnection = SuperBoardSupportConnection;

@Deprecated('Use SuperBoardSupportRealtime.')
typedef SuperBoardMessagingRealtime = SuperBoardSupportRealtime;
