import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

import 'client.dart';

typedef OpenGrowMessagingConnectionFactory =
    Future<OpenGrowMessagingConnection> Function(String conversationId);

class OpenGrowMessagingConnection {
  OpenGrowMessagingConnection.fromChannel(WebSocketChannel channel)
    : this(channel.stream, () => channel.sink.close(1000, 'Client closed'));

  OpenGrowMessagingConnection(this.stream, this._close);

  final Stream<dynamic> stream;
  final FutureOr<void> Function() _close;

  Future<void> close() async => _close();
}

class OpenGrowMessagingRealtime {
  OpenGrowMessagingRealtime(
    OpenGrowMessagingClient client, {
    List<Duration>? retryDelays,
  }) : this.withConnectionFactory(
         (conversationId) async => OpenGrowMessagingConnection.fromChannel(
           await client.connect(conversationId),
         ),
         retryDelays: retryDelays,
       );

  OpenGrowMessagingRealtime.withConnectionFactory(
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

  final OpenGrowMessagingConnectionFactory _connect;
  final List<Duration> _retryDelays;
  final _events = StreamController<String>.broadcast();
  OpenGrowMessagingConnection? _connection;
  StreamSubscription<dynamic>? _subscription;
  Timer? _retryTimer;
  String? _conversationId;
  int _generation = 0;
  int _attempt = 0;
  bool _requested = false;
  bool _disposed = false;

  Stream<String> get events => _events.stream;
  bool get connected => _connection != null;
  String? get conversationId => _conversationId;

  Future<void> connect(String conversationId) async {
    final normalized = conversationId.trim();
    if (normalized.isEmpty || normalized.length > 255) {
      throw const OpenGrowMessagingException(
        'conversation_id_invalid',
        'A valid conversation ID is required',
      );
    }
    if (_disposed) {
      throw const OpenGrowMessagingException(
        'realtime_disposed',
        'Messaging realtime has been disposed',
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
    final conversation = _conversationId;
    _requested = false;
    _conversationId = null;
    _attempt = 0;
    _generation += 1;
    await _stopCurrentConnection();
    if (conversation != null) {
      _emitLifecycle('disconnected', conversation, retrying: false);
    }
  }

  Future<void> dispose() async {
    if (_disposed) return;
    await disconnect();
    _disposed = true;
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
      _emitLifecycle('connected', conversation, retrying: false);
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
        throw OpenGrowMessagingException(
          'realtime_connection_failed',
          'Unable to connect to Messaging realtime',
          retryable: true,
        );
      }
    }
  }

  void _connectionEnded(
    OpenGrowMessagingConnection connection,
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
    _emitLifecycle(
      'reconnecting',
      conversation,
      retrying: true,
      retryIn: delay,
      error: error,
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

  Future<void> _closeQuietly(OpenGrowMessagingConnection connection) async {
    try {
      await connection.close();
    } catch (_) {
      // The socket is already unusable; reconnection owns recovery.
    }
  }

  void _emitServerEvent(dynamic event, String conversation) {
    try {
      final decoded = event is String ? jsonDecode(event) : null;
      if (decoded is! Map) throw const FormatException();
      _events.add(
        jsonEncode({
          ...decoded.cast<String, dynamic>(),
          'conversation_id':
              decoded['conversation_id']?.toString() ?? conversation,
        }),
      );
    } catch (_) {
      _events.add(
        jsonEncode({
          'type': 'realtime.error',
          'code': 'realtime_event_invalid',
          'message': 'Messaging realtime returned an invalid event',
          'conversation_id': conversation,
        }),
      );
    }
  }

  void _emitLifecycle(
    String status,
    String conversation, {
    required bool retrying,
    Duration? retryIn,
    Object? error,
  }) {
    if (_events.isClosed) return;
    _events.add(
      jsonEncode({
        'type': 'connection.changed',
        'status': status,
        'conversation_id': conversation,
        'retrying': retrying,
        'attempt': _attempt,
        if (retryIn != null) 'retry_in_ms': retryIn.inMilliseconds,
        if (error != null) 'code': 'realtime_connection_lost',
      }),
    );
  }
}
