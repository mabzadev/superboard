import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:opengrow_flutterflow_messaging/opengrow_flutterflow_messaging.dart';

void main() {
  test(
    'emits validated server events and connection lifecycle events',
    () async {
      final socket = FakeMessagingConnection();
      final realtime = OpenGrowMessagingRealtime.withConnectionFactory(
        (_) async => socket.connection,
        retryDelays: const [Duration.zero],
      );
      final events = <Map<String, dynamic>>[];
      final subscription = realtime.events.listen(
        (event) => events.add(jsonDecode(event) as Map<String, dynamic>),
      );
      addTearDown(() async {
        await subscription.cancel();
        await realtime.dispose();
      });

      await realtime.connect('conversation-1');
      socket.add(
        jsonEncode({
          'type': 'message.created',
          'message': {'id': 'message-1'},
        }),
      );
      await flushEvents();

      expect(events.first, {
        'type': 'connection.changed',
        'status': 'connected',
        'conversation_id': 'conversation-1',
        'retrying': false,
        'attempt': 0,
      });
      expect(events.last['type'], 'message.created');
      expect(events.last['conversation_id'], 'conversation-1');
    },
  );

  test('reconnects after an unexpected socket close', () async {
    final sockets = <FakeMessagingConnection>[];
    final realtime = OpenGrowMessagingRealtime.withConnectionFactory((_) async {
      final socket = FakeMessagingConnection();
      sockets.add(socket);
      return socket.connection;
    }, retryDelays: const [Duration.zero]);
    final events = <Map<String, dynamic>>[];
    final subscription = realtime.events.listen(
      (event) => events.add(jsonDecode(event) as Map<String, dynamic>),
    );
    addTearDown(() async {
      await subscription.cancel();
      await realtime.dispose();
    });

    await realtime.connect('conversation-1');
    await sockets.single.remoteClose();
    await flushEvents();
    await flushEvents();

    expect(sockets, hasLength(2));
    expect(
      events.map((event) => event['status']).whereType<String>(),
      containsAllInOrder(['connected', 'reconnecting', 'connected']),
    );
  });

  test(
    'does not reconnect a stale socket after switching conversations',
    () async {
      final openedConversations = <String>[];
      final sockets = <FakeMessagingConnection>[];
      final realtime = OpenGrowMessagingRealtime.withConnectionFactory((
        conversationId,
      ) async {
        openedConversations.add(conversationId);
        final socket = FakeMessagingConnection();
        sockets.add(socket);
        return socket.connection;
      }, retryDelays: const [Duration.zero]);
      addTearDown(realtime.dispose);

      await realtime.connect('conversation-1');
      final staleSocket = sockets.first;
      await realtime.connect('conversation-2');
      await staleSocket.remoteClose();
      await flushEvents();
      await flushEvents();

      expect(openedConversations, ['conversation-1', 'conversation-2']);
      expect(realtime.conversationId, 'conversation-2');
      expect(realtime.connected, isTrue);
    },
  );
}

Future<void> flushEvents() =>
    Future<void>.delayed(const Duration(milliseconds: 5));

class FakeMessagingConnection {
  final _controller = StreamController<dynamic>.broadcast();
  bool closedByClient = false;

  late final connection = OpenGrowMessagingConnection(
    _controller.stream,
    () async {
      closedByClient = true;
      if (!_controller.isClosed) await _controller.close();
    },
  );

  void add(String event) => _controller.add(event);

  Future<void> remoteClose() async {
    if (!_controller.isClosed) await _controller.close();
  }
}
