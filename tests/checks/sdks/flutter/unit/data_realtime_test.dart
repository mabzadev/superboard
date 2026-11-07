import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:stream_channel/stream_channel.dart';
import 'package:superboard_flutter/superboard_data.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

void main() {
  test('multiplexes channels on one socket and applies presence', () async {
    final harness = _Harness();
    addTearDown(harness.dispose);
    final room = harness.realtime.channel('room:1', presenceKey: 'user-1');
    final feed = harness.realtime.channel('db:todos');
    final events = <SuperBoardPresenceEvent>[];
    final subscription = room.presenceEvents.listen(events.add);
    addTearDown(subscription.cancel);

    final roomJoined = room.subscribe();
    final feedJoined = feed.subscribe();
    final socket = await harness.socket(0);
    await harness.accept(socket, 'room:1');
    await harness.accept(socket, 'db:todos');
    await roomJoined;
    await feedJoined;

    final ticket = harness.tickets.single;
    expect(ticket.method, 'POST');
    expect(ticket.url.path, '/v1/data/realtime/tickets');
    expect(ticket.headers['PROJECT-KEY'], 'og_app_key');
    expect(ticket.headers['Authorization'], 'Bearer app-token');
    expect(harness.sockets, hasLength(1));
    expect(socket.uri.queryParameters['ticket'], 't1');
    expect(socket.message('join', 'room:1')['config'], {
      'presence': {'key': 'user-1'},
    });
    expect(socket.message('join', 'db:todos').containsKey('config'), isFalse);

    socket.serverSend({
      'type': 'presence_state',
      'channel': 'room:1',
      'presences': {
        'user-1': [
          {'status': 'online'},
        ],
        'user-2': [
          {'status': 'away'},
        ],
      },
    });
    socket.serverSend({
      'type': 'presence_diff',
      'channel': 'room:1',
      'joins': {
        'user-2': [
          {'status': 'online'},
        ],
        'user-3': [
          {'status': 'online'},
        ],
      },
      'leaves': {
        'user-2': [
          {'status': 'away'},
        ],
        'user-1': [
          {'status': 'online'},
        ],
      },
    });
    await _eventually(() => events.length == 6);

    expect(room.presenceState, {
      'user-2': [
        {'status': 'online'},
      ],
      'user-3': [
        {'status': 'online'},
      ],
    });
    expect(feed.presenceState, isEmpty);
    expect(events.map((event) => (event.type, event.key)), [
      (SuperBoardPresenceEventType.sync, null),
      (SuperBoardPresenceEventType.leave, 'user-2'),
      (SuperBoardPresenceEventType.leave, 'user-1'),
      (SuperBoardPresenceEventType.join, 'user-2'),
      (SuperBoardPresenceEventType.join, 'user-3'),
      (SuperBoardPresenceEventType.sync, null),
    ]);
    expect(events[2].presences, [
      {'status': 'online'},
    ]);
  });

  test('routes broadcasts and row changes and waits for acks', () async {
    final harness = _Harness();
    addTearDown(harness.dispose);
    final room = harness.realtime.channel('room:1');
    final feed = harness.realtime.channel('db:todos');
    final broadcasts = <SuperBoardRealtimeBroadcast>[];
    final changes = <SuperBoardRealtimeChange>[];
    final broadcastSubscription = room.broadcasts.listen(broadcasts.add);
    final changeSubscription = feed.changes.listen(changes.add);
    addTearDown(broadcastSubscription.cancel);
    addTearDown(changeSubscription.cancel);
    final joining = Future.wait([room.subscribe(), feed.subscribe()]);
    final socket = await harness.socket(0);
    await harness.accept(socket, 'room:1');
    await harness.accept(socket, 'db:todos');
    await joining;

    var acknowledged = false;
    final sending = room
        .send('cursor', {'x': 1})
        .then((_) => acknowledged = true);
    final sent = await socket.next('broadcast', 'room:1');
    await Future<void>.delayed(const Duration(milliseconds: 5));
    expect(acknowledged, isFalse);
    socket.serverSend({'type': 'ack', 'channel': 'room:1', 'ref': sent['ref']});
    await sending;

    socket.serverSend({
      'type': 'broadcast',
      'channel': 'room:1',
      'event': 'cursor',
      'payload': {'x': 2},
    });
    socket.serverSend({
      'type': 'change',
      'channel': 'db:todos',
      'table': 'todos',
      'event': 'UPDATE',
      'record': {'id': 'r1', 'done': true},
      'old_record': {'id': 'r1', 'done': false},
      'commit_timestamp': '2026-11-07T12:00:00.000Z',
    });
    await _eventually(() => broadcasts.isNotEmpty && changes.isNotEmpty);

    expect(sent['event'], 'cursor');
    expect(sent['payload'], {'x': 1});
    expect(sent.containsKey('self'), isFalse);
    expect(broadcasts.single.payload, {'x': 2});
    expect(changes.single.event, SuperBoardRealtimeChangeEvent.update);
    expect(changes.single.record, {'id': 'r1', 'done': true});
    expect(changes.single.oldRecord, {'id': 'r1', 'done': false});
    expect(changes.single.commitTimestamp, DateTime.utc(2026, 11, 7, 12));
    await expectLater(
      feed.send('cursor', null),
      throwsA(_code('channel_read_only')),
    );

    final leaving = room.unsubscribe();
    final leave = await socket.next('leave', 'room:1');
    socket.serverSend({
      'type': 'left',
      'channel': 'room:1',
      'ref': leave['ref'],
    });
    await leaving;
    expect(room.status, SuperBoardRealtimeChannelStatus.closed);
    expect(socket.closedByClient, isFalse);

    final closing = feed.unsubscribe();
    final last = await socket.next('leave', 'db:todos');
    socket.serverSend({
      'type': 'left',
      'channel': 'db:todos',
      'ref': last['ref'],
    });
    await closing;
    expect(socket.closedByClient, isTrue);
    expect(
      harness.realtime.connectionState,
      SuperBoardRealtimeConnectionState.disconnected,
    );
  });

  test('reconnects with a fresh ticket and joins and tracks again', () async {
    final harness = _Harness();
    addTearDown(harness.dispose);
    final room = harness.realtime.channel('room:1', presenceKey: 'user-1');
    final feed = harness.realtime.channel('db:todos');
    final joining = Future.wait([room.subscribe(), feed.subscribe()]);
    final first = await harness.socket(0);
    await harness.accept(first, 'room:1');
    await harness.accept(first, 'db:todos');
    await joining;
    await room.track({'status': 'online'});
    expect(first.message('presence', 'room:1')['state'], {'status': 'online'});

    first.serverClose();
    final second = await harness.socket(1);
    expect(harness.tickets, hasLength(2));
    expect(second.uri.queryParameters['ticket'], 't2');
    expect(room.status, SuperBoardRealtimeChannelStatus.joining);

    await harness.accept(second, 'room:1');
    await harness.accept(second, 'db:todos');
    await _eventually(
      () =>
          room.status == SuperBoardRealtimeChannelStatus.joined &&
          feed.status == SuperBoardRealtimeChannelStatus.joined,
    );
    final presence = await second.next('presence', 'room:1');

    expect(second.message('join', 'room:1')['config'], {
      'presence': {'key': 'user-1'},
    });
    expect(presence['state'], {'status': 'online'});
    expect(
      second.sent.indexOf(presence),
      greaterThan(second.sent.indexOf(second.message('join', 'room:1'))),
    );
  });

  test('replaces a socket whose ping goes unanswered', () async {
    final harness = _Harness(heartbeat: const Duration(milliseconds: 20));
    addTearDown(harness.dispose);
    final room = harness.realtime.channel('room:1');
    final joining = room.subscribe();
    final first = await harness.socket(0);
    await harness.accept(first, 'room:1');
    await joining;

    final answering = DateTime.now().add(const Duration(milliseconds: 120));
    final answered = <Object?>{};
    while (DateTime.now().isBefore(answering)) {
      for (final ping in first.sent.where((m) => m['type'] == 'ping')) {
        if (answered.add(ping['ref'])) {
          first.serverSend({'type': 'pong', 'ref': ping['ref']});
        }
      }
      await Future<void>.delayed(const Duration(milliseconds: 2));
    }
    expect(answered.length, greaterThanOrEqualTo(2));
    expect(harness.sockets, hasLength(1));

    final second = await harness.socket(1);
    expect(first.closedByClient, isTrue);
    await harness.accept(second, 'room:1');
    await _eventually(
      () => room.status == SuperBoardRealtimeChannelStatus.joined,
    );
  });

  test('leaves a channel unsubscribed while its join was pending', () async {
    final harness = _Harness();
    addTearDown(harness.dispose);
    final room = harness.realtime.channel('room:1');
    final feed = harness.realtime.channel('db:todos');
    final feedJoined = feed.subscribe();
    final socket = await harness.socket(0);
    await harness.accept(socket, 'db:todos');
    await feedJoined;

    final joining = room.subscribe();
    final join = await socket.next('join', 'room:1');
    await room.unsubscribe();
    socket.serverSend({
      'type': 'joined',
      'channel': 'room:1',
      'ref': join['ref'],
    });

    await expectLater(joining, throwsA(_code('channel_not_joined')));
    await socket.next('leave', 'room:1');
    expect(room.status, SuperBoardRealtimeChannelStatus.closed);
    expect(feed.status, SuperBoardRealtimeChannelStatus.joined);
  });

  test('reports a refused join and closes the idle socket', () async {
    final harness = _Harness();
    addTearDown(harness.dispose);
    final secret = harness.realtime.channel('private:1');

    final joining = secret.subscribe();
    final socket = await harness.socket(0);
    final join = await socket.next('join', 'private:1');
    socket.serverSend({
      'type': 'error',
      'code': 'authentication_required',
      'channel': 'private:1',
      'ref': join['ref'],
    });

    await expectLater(joining, throwsA(_code('authentication_required')));
    expect(secret.status, SuperBoardRealtimeChannelStatus.errored);
    await _eventually(() => socket.closedByClient);
    expect(
      harness.realtime.connectionState,
      SuperBoardRealtimeConnectionState.disconnected,
    );
  });
}

class _Harness {
  _Harness({Duration heartbeat = const Duration(minutes: 5)}) {
    data = SuperBoardData(
      baseUrl: 'https://sdk.example.test',
      projectKey: 'og_app_key',
      platformIdentifier: 'com.example.app',
      platform: 'android',
      accessToken: 'app-token',
      httpClient: MockClient((request) async {
        tickets.add(request);
        final ticket = 't${tickets.length}';
        return http.Response(
          jsonEncode({
            'ticket': ticket,
            'url':
                'wss://sdk.example.test/v1/data/realtime/connect?ticket=$ticket',
            'expires_at': '2026-11-07T12:01:00.000Z',
          }),
          201,
          headers: {'content-type': 'application/json'},
        );
      }),
      webSocketConnector: (uri) {
        final socket = _FakeSocket(uri);
        sockets.add(socket);
        return socket;
      },
      heartbeatInterval: heartbeat,
      reconnectDelays: const [Duration.zero],
    );
  }

  late final SuperBoardData data;
  final tickets = <http.Request>[];
  final sockets = <_FakeSocket>[];

  SuperBoardRealtime get realtime => data.realtime;

  Future<_FakeSocket> socket(int index) =>
      _eventually(() => sockets.length > index ? sockets[index] : null);

  Future<void> accept(_FakeSocket socket, String channel) async {
    final join = await socket.next('join', channel);
    socket.serverSend({
      'type': 'joined',
      'channel': channel,
      'ref': join['ref'],
    });
  }

  Future<void> dispose() => data.dispose();
}

class _FakeSocket extends StreamChannelMixin<Object?>
    implements WebSocketChannel {
  _FakeSocket(this.uri);

  final Uri uri;
  final StreamController<Object?> _incoming = StreamController();
  final List<Map<String, dynamic>> sent = [];
  final Set<Map<String, dynamic>> _consumed = {};
  late final _FakeSink _sink = _FakeSink(this);
  bool closedByClient = false;

  void serverSend(Map<String, Object?> message) =>
      _incoming.add(jsonEncode(message));

  void serverClose() => unawaited(_incoming.close());

  Map<String, dynamic> message(String type, String channel) => sent.firstWhere(
    (message) => message['type'] == type && message['channel'] == channel,
  );

  Future<Map<String, dynamic>> next(String type, String channel) =>
      _eventually(() {
        for (final message in sent) {
          if (message['type'] == type &&
              message['channel'] == channel &&
              _consumed.add(message)) {
            return message;
          }
        }
        return null;
      });

  @override
  int? get closeCode => null;

  @override
  String? get closeReason => null;

  @override
  String? get protocol => null;

  @override
  Future<void> get ready => Future.value();

  @override
  WebSocketSink get sink => _sink;

  @override
  Stream<Object?> get stream => _incoming.stream;
}

class _FakeSink implements WebSocketSink {
  _FakeSink(this._socket);

  final _FakeSocket _socket;

  @override
  void add(Object? data) => _socket.sent.add(
    (jsonDecode(data! as String) as Map).cast<String, dynamic>(),
  );

  @override
  void addError(Object error, [StackTrace? stackTrace]) {}

  @override
  Future<void> addStream(Stream<Object?> stream) => stream.forEach(add);

  @override
  Future<void> close([int? closeCode, String? closeReason]) async {
    _socket.closedByClient = true;
  }

  @override
  Future<void> get done => Future.value();
}

Future<T> _eventually<T extends Object>(Object? Function() probe) async {
  for (var attempt = 0; attempt < 1000; attempt += 1) {
    final value = probe();
    if (value != null && value != false) return value as T;
    await Future<void>.delayed(const Duration(milliseconds: 2));
  }
  fail('Timed out waiting for the expected realtime state');
}

Matcher _code(String code) =>
    isA<SuperBoardDataException>().having((error) => error.code, 'code', code);
