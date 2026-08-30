import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:superboard_flutter/superboard_support.dart';

void main() {
  test(
    'normalizes allowed server events to the native realtime contract',
    () async {
      final socket = _FakeSupportConnection();
      final realtime = SuperBoardSupportRealtime.withConnectionFactory(
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
          'schema_version': 1,
          'type': 'connected',
          'event_id': 'server-connected',
          'conversation_id': 'conversation-1',
          'occurred_at': '2026-08-13T12:00:00.000Z',
        }),
      );
      socket.add(
        jsonEncode({
          'type': 'message.created',
          'message': {'id': 'message-1'},
        }),
      );
      await _flushEvents();

      expect(events.first['type'], 'connected');
      expect(events.last, containsPair('schema_version', 1));
      expect(events.last, containsPair('type', 'message.created'));
      expect(events.last, containsPair('conversation_id', 'conversation-1'));
      expect(events.last['event_id'], isNotEmpty);
      expect(events.where((event) => event['type'] == 'connected'), hasLength(1));
    },
  );

  test('rejects unknown server event names without leaking them', () async {
    final socket = _FakeSupportConnection();
    final realtime = SuperBoardSupportRealtime.withConnectionFactory(
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
    socket.add('{"type":"migration.progress"}');
    await _flushEvents();

    expect(events.last['type'], 'error');
    expect((events.last['error'] as Map)['code'], 'realtime_event_invalid');
    expect(jsonEncode(events.last), isNot(contains('migration.progress')));
  });
}

Future<void> _flushEvents() =>
    Future<void>.delayed(const Duration(milliseconds: 5));

class _FakeSupportConnection {
  final _controller = StreamController<dynamic>.broadcast();

  late final connection = SuperBoardSupportConnection(
    _controller.stream,
    () async {
      if (!_controller.isClosed) await _controller.close();
    },
  );

  void add(String event) => _controller.add(event);
}
