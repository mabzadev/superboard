import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:superboard_flutter/superboard_flows.dart';
import 'package:stream_channel/stream_channel.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

void main() {
  test(
    'initializes against the native Flows contract and persists blocks',
    () async {
      final requests = <http.Request>[];
      final storage = SuperBoardMemoryFlowStorage();
      final client = SuperBoardFlowsClient(
        apiUrl: 'https://board.example/api/v1/flows/',
        projectId: 'project_1',
        environment: 'production',
        userId: 'user_1',
        sdkKey: 'environment-secret',
        language: 'fr-CH',
        userProperties: const {'plan': 'pro'},
        realtime: false,
        storage: storage,
        httpClient: MockClient((request) async {
          requests.add(request);
          return http.Response(
            jsonEncode({
              'blocks': [_blockJson(id: 'card_1')],
            }),
            200,
          );
        }),
      );

      await client.start();

      expect(client.blocks.single.id, 'card_1');
      expect(client.floatingBlocks, hasLength(1));
      expect(
        requests.single.url.toString(),
        'https://board.example/api/v1/flows/v2/sdk/blocks',
      );
      final body = jsonDecode(requests.single.body) as Map<String, dynamic>;
      expect(body, {
        'projectId': 'project_1',
        'environment': 'production',
        'userId': 'user_1',
        'userProperties': {'plan': 'pro'},
        'language': 'fr-CH',
      });
      expect(
        requests.single.headers['x-flows-version'],
        'superboard-flutter@3.0.0',
      );
      expect(
        requests.single.headers['x-superboard-flows-sdk-key'],
        'environment-secret',
      );
      expect((await storage.read())?.blocks.single.id, 'card_1');
      await client.dispose();
    },
  );

  test(
    'event commands keep idempotency and reconcile updated blocks',
    () async {
      final events = <Map<String, dynamic>>[];
      final idempotencyKeys = <String>[];
      final client = SuperBoardFlowsClient(
        apiUrl: 'https://board.example/api/v1/flows',
        projectId: 'project_1',
        environment: 'production',
        userId: 'user_1',
        realtime: false,
        storage: SuperBoardMemoryFlowStorage(),
        httpClient: MockClient((request) async {
          if (request.url.path.endsWith('/blocks')) {
            return http.Response(
              jsonEncode({
                'blocks': [_blockJson(id: 'card_1')],
              }),
              200,
            );
          }
          final body = jsonDecode(request.body) as Map<String, dynamic>;
          events.add(body);
          idempotencyKeys.add(request.headers['idempotency-key'] ?? '');
          return http.Response(
            jsonEncode({
              'success': true,
              'exitedBlockIds': ['card_1'],
              'updatedBlocks': [_blockJson(id: 'card_2')],
            }),
            200,
          );
        }),
      );
      await client.start();

      await client.transition(client.blocks.single, exitNode: 'continue');

      expect(events.single['name'], 'transition');
      expect(events.single['propertyKey'], 'continue');
      expect(events.single['blockStateId'], 'state_card_1');
      expect(events.single['eventId'], idempotencyKeys.single);
      expect(client.blocks.single.id, 'card_2');
      await client.dispose();
    },
  );

  test('persists a failed action and reuses its event id on retry', () async {
    final storage = SuperBoardMemoryFlowStorage();
    final keys = <String>[];
    var eventAttempt = 0;
    final client = SuperBoardFlowsClient(
      apiUrl: 'https://board.example/api/v1/flows',
      projectId: 'project_1',
      environment: 'production',
      userId: 'user_1',
      realtime: false,
      storage: storage,
      httpClient: MockClient((request) async {
        if (request.url.path.endsWith('/blocks')) {
          return http.Response(
            jsonEncode({
              'blocks': [_blockJson(id: 'card_1')],
            }),
            200,
          );
        }
        eventAttempt += 1;
        keys.add(request.headers['idempotency-key'] ?? '');
        return eventAttempt == 1
            ? http.Response('{"message":"retry"}', 503)
            : http.Response(
                '{"success":true,"exitedBlockIds":[],"updatedBlocks":[]}',
                200,
              );
      }),
    );
    await client.start();

    await expectLater(
      client.transition(client.blocks.single, exitNode: 'continue'),
      throwsA(isA<SuperBoardFlowException>()),
    );
    expect(storage.state?.pendingCommands, hasLength(1));
    await client.transition(client.blocks.single, exitNode: 'continue');

    expect(keys, hasLength(2));
    expect(keys.first, isNotEmpty);
    expect(keys.last, keys.first);
    expect(storage.state?.pendingCommands, isEmpty);
    await client.dispose();
  });

  test('replays a survey and its transition in order after restart', () async {
    final storage = SuperBoardMemoryFlowStorage();
    final surveyBlock = {
      ..._blockJson(id: 'survey_1'),
      'type': 'survey',
      'survey': {
        'id': 'survey_1',
        'blockStateId': 'state_survey_1',
        'questions': <Map<String, dynamic>>[],
      },
    };
    final firstKeys = <String>[];
    final first = SuperBoardFlowsClient(
      apiUrl: 'https://board.example/api/v1/flows',
      projectId: 'project_1',
      environment: 'production',
      userId: 'user_1',
      realtime: false,
      storage: storage,
      httpClient: MockClient((request) async {
        if (request.url.path.endsWith('/blocks')) {
          return http.Response(
            jsonEncode({
              'blocks': [surveyBlock],
            }),
            200,
          );
        }
        firstKeys.add(request.headers['idempotency-key'] ?? '');
        return http.Response('{"message":"retry"}', 503);
      }),
    );
    await first.start();
    await expectLater(
      first.submitSurvey(first.blocks.single, const []),
      throwsA(isA<SuperBoardFlowException>()),
    );
    await expectLater(
      first.submitSurvey(first.blocks.single, const []),
      throwsA(isA<SuperBoardFlowException>()),
    );
    expect(storage.state?.pendingCommands, hasLength(1));
    await first.dispose();

    final replayPaths = <String>[];
    final replayKeys = <String>[];
    final replay = SuperBoardFlowsClient(
      apiUrl: 'https://board.example/api/v1/flows',
      projectId: 'project_1',
      environment: 'production',
      userId: 'user_1',
      realtime: false,
      storage: storage,
      httpClient: MockClient((request) async {
        replayPaths.add(request.url.path);
        if (request.url.path.endsWith('/blocks')) {
          return http.Response('{"blocks":[]}', 200);
        }
        replayKeys.add(request.headers['idempotency-key'] ?? '');
        return http.Response(
          '{"success":true,"exitedBlockIds":[],"updatedBlocks":[]}',
          200,
        );
      }),
    );

    await replay.start();

    expect(firstKeys, everyElement('survey:state_survey_1'));
    expect(replayPaths.take(3), [
      '/api/v1/flows/v2/sdk/survey',
      '/api/v1/flows/v2/sdk/events',
      '/api/v1/flows/v2/sdk/blocks',
    ]);
    expect(replayKeys.first, firstKeys.first);
    expect(replayKeys.last, isNotEmpty);
    expect(storage.state?.pendingCommands, isEmpty);
    await replay.dispose();
  });

  test('applies ordered websocket updates and uses a scoped WSS URL', () async {
    late Uri connectedUri;
    final socket = _FakeWebSocketChannel();
    final client = SuperBoardFlowsClient(
      apiUrl: 'https://board.example/api/v1/flows',
      projectId: 'project_1',
      environment: 'preview',
      userId: 'user@example.com',
      sdkKey: 'preview-secret',
      storage: SuperBoardMemoryFlowStorage(),
      httpClient: MockClient(
        (_) async => http.Response(
          jsonEncode({
            'blocks': [_blockJson(id: 'card_1')],
          }),
          200,
        ),
      ),
      webSocketConnector: (uri) {
        connectedUri = uri;
        return socket;
      },
    );
    await client.start();
    final next = client.blocksStream.firstWhere(
      (blocks) => blocks.any((block) => block.id == 'modal_1'),
    );

    socket.addServerMessage(
      jsonEncode({
        'exitedBlockIds': ['card_1'],
        'updatedBlocks': [
          _blockJson(id: 'modal_1', componentType: 'BasicsV2Modal'),
        ],
      }),
    );

    expect((await next).single.id, 'modal_1');
    expect(connectedUri.scheme, 'wss');
    expect(connectedUri.path, '/api/v1/flows/ws/sdk/block-updates');
    expect(connectedUri.queryParameters, {
      'projectId': 'project_1',
      'environment': 'preview',
      'userId': 'user@example.com',
      'sdkKey': 'preview-secret',
    });
    await client.dispose();
  });

  test('reconnects realtime after the server closes the socket', () async {
    final sockets = <_FakeWebSocketChannel>[];
    var refreshCount = 0;
    final client = SuperBoardFlowsClient(
      apiUrl: 'https://board.example/api/v1/flows',
      projectId: 'project_1',
      environment: 'production',
      userId: 'user_1',
      storage: SuperBoardMemoryFlowStorage(),
      reconnectDelays: const [Duration.zero],
      httpClient: MockClient((_) async {
        refreshCount += 1;
        return http.Response(
          jsonEncode({
            'blocks': [_blockJson(id: 'card_$refreshCount')],
          }),
          200,
        );
      }),
      webSocketConnector: (_) {
        final socket = _FakeWebSocketChannel();
        sockets.add(socket);
        return socket;
      },
    );
    await client.start();

    await sockets.single.closeServer();
    for (var attempt = 0; attempt < 10 && sockets.length < 2; attempt++) {
      await Future<void>.delayed(const Duration(milliseconds: 5));
    }

    expect(sockets, hasLength(2));
    for (
      var attempt = 0;
      attempt < 10 && client.blocks.single.id != 'card_2';
      attempt++
    ) {
      await Future<void>.delayed(const Duration(milliseconds: 5));
    }
    expect(client.blocks.single.id, 'card_2');
    await client.dispose();
  });

  test('uses encrypted-cache abstraction while offline', () async {
    final storage = SuperBoardMemoryFlowStorage()
      ..state = SuperBoardFlowPersistedState(
        projectId: 'project_1',
        environment: 'production',
        userId: 'user_1',
        language: 'fr',
        userProperties: const {'country': 'CH'},
        blocks: [SuperBoardFlowBlock.fromJson(_blockJson(id: 'cached_card'))],
      );
    final client = SuperBoardFlowsClient(
      apiUrl: 'https://board.example/api/v1/flows',
      projectId: 'project_1',
      environment: 'production',
      userId: 'user_1',
      realtime: false,
      storage: storage,
      httpClient: MockClient(
        (_) async => throw http.ClientException('offline'),
      ),
    );

    await client.start();

    expect(client.blocks.single.id, 'cached_card');
    expect(client.language, 'fr');
    expect(client.userProperties, {'country': 'CH'});
    await client.dispose();
  });

  test('fetches workflow states using upstream-compatible names', () async {
    final client = SuperBoardFlowsClient(
      apiUrl: 'https://board.example/api/v1/flows',
      projectId: 'project_1',
      environment: 'production',
      userId: 'user_1',
      realtime: false,
      storage: SuperBoardMemoryFlowStorage(),
      httpClient: MockClient((request) async {
        if (request.url.path.endsWith('/blocks')) {
          return http.Response('{"blocks":[]}', 200);
        }
        return http.Response(
          jsonEncode({
            'workflows': [
              {
                'id': 'workflow_1',
                'workflow_status': 'launchpad-enabled',
                'frequency': 'every-time',
                'user_state': 'in-progress',
                'entered_at': '2026-08-13T09:00:00.000Z',
              },
            ],
          }),
          200,
        );
      }),
    );
    await client.start();

    final workflows = await client.fetchWorkflows();

    expect(
      workflows.single.status,
      SuperBoardFlowWorkflowStatus.launchpadEnabled,
    );
    expect(
      workflows.single.frequency,
      SuperBoardFlowWorkflowFrequency.everyTime,
    );
    expect(workflows.single.userState, SuperBoardFlowUserState.inProgress);
    await client.dispose();
  });

  test('filters native blocks and tour slots using page targeting', () async {
    var location = '/settings/profile';
    final client = SuperBoardFlowsClient(
      apiUrl: 'https://board.example/api/v1/flows',
      projectId: 'project_1',
      environment: 'production',
      userId: 'user_1',
      realtime: false,
      storage: SuperBoardMemoryFlowStorage(),
      navigationAdapter: SuperBoardCallbackFlowNavigationAdapter(
        location: () => location,
        onNavigate: (next) => location = next,
      ),
      httpClient: MockClient((request) async {
        if (!request.url.path.endsWith('/blocks')) {
          return http.Response(
            '{"success":true,"exitedBlockIds":[],"updatedBlocks":[]}',
            200,
          );
        }
        return http.Response(
          jsonEncode({
            'blocks': [
              {
                ..._blockJson(id: 'home_card'),
                'page_targeting_operator': 'eq',
                'page_targeting_values': ['/home'],
              },
              {
                ..._tourBlockJson(),
                'tourBlocks': [
                  {
                    ..._blockJson(id: 'settings_tour_step'),
                    'type': 'tour-component',
                    'slottable': true,
                    'slotId': 'settings',
                    'slotIndex': 2,
                    'page_targeting_operator': 'contains',
                    'page_targeting_values': ['/settings'],
                  },
                ],
              },
            ],
          }),
          200,
        );
      }),
    );
    await client.start();

    expect(client.floatingBlocks, isEmpty);
    expect(client.slotBlocks('settings').single.id, 'tour_1');

    location = '/home';
    await client.notifyNavigation(location);
    expect(client.floatingBlocks.single.id, 'home_card');
    expect(client.slotBlocks('settings'), isEmpty);
    await client.dispose();
  });

  test('persists complete survey definitions for offline rendering', () {
    final block = SuperBoardFlowBlock.fromJson({
      ..._blockJson(id: 'survey_1'),
      'type': 'survey',
      'survey': {
        'id': 'survey_1',
        'blockStateId': 'state_survey_1',
        'questions': [
          {
            'id': 'question_1',
            'type': 'single-choice',
            'title': 'Choose one',
            'optional': false,
            'options': [
              {'id': 'option_1', 'label': 'First'},
            ],
          },
        ],
      },
    });

    final restored = SuperBoardFlowBlock.fromJson(block.toJson());

    expect(restored.survey?.questions.single.title, 'Choose one');
    expect(restored.survey?.questions.single.options.single.label, 'First');
  });

  test('resolves typed component properties at nested upstream paths', () {
    final block = SuperBoardFlowBlock.fromJson({
      ..._blockJson(id: 'checklist_1'),
      'data': {
        'items': [
          {'title': 'Connect account', 'completed': false},
        ],
      },
      'propertyMeta': [
        {'key': 'items.0.completed', 'type': 'state-memory', 'value': true},
        {
          'key': 'primaryButton',
          'type': 'action',
          'value': {'label': 'Continue', 'exitNode': 'continue'},
        },
      ],
    });

    expect(
      ((block.resolvedData['items'] as List).single as Map)['completed'],
      isTrue,
    );
    expect(block.resolvedData['primaryButton'], {
      'label': 'Continue',
      'exitNode': 'continue',
    });
    expect(
      ((block.data['items'] as List).single as Map)['completed'],
      isFalse,
      reason: 'the immutable wire definition must not be mutated',
    );
  });

  test('persists native tour progress across client restarts', () async {
    final storage = SuperBoardMemoryFlowStorage();
    final tour = _tourBlockJson();
    final online = SuperBoardFlowsClient(
      apiUrl: 'https://board.example/api/v1/flows',
      projectId: 'project_1',
      environment: 'production',
      userId: 'user_1',
      realtime: false,
      storage: storage,
      httpClient: MockClient((request) async {
        if (request.url.path.endsWith('/blocks')) {
          return http.Response(
            jsonEncode({
              'blocks': [tour],
            }),
            200,
          );
        }
        return http.Response(
          '{"success":true,"exitedBlockIds":[],"updatedBlocks":[]}',
          200,
        );
      }),
    );
    await online.start();
    await online.updateTour(online.blocks.single, index: 1, action: 'next');
    expect(online.tourIndex(online.blocks.single), 1);
    await online.dispose();

    final offline = SuperBoardFlowsClient(
      apiUrl: 'https://board.example/api/v1/flows',
      projectId: 'project_1',
      environment: 'production',
      userId: 'user_1',
      realtime: false,
      storage: storage,
      httpClient: MockClient(
        (_) async => throw http.ClientException('offline'),
      ),
    );
    await offline.start();

    expect(offline.tourIndex(offline.blocks.single), 1);
    await offline.dispose();
  });
}

Map<String, dynamic> _blockJson({
  required String id,
  String componentType = 'BasicsV2Card',
  String? slotId,
}) => {
  'id': id,
  'blockStateId': 'state_$id',
  'workflowId': 'workflow_1',
  'key': id,
  'type': 'component',
  'componentType': componentType,
  'data': {
    'title': 'Welcome',
    'body': 'Native Flows',
    'primaryButton': {'label': 'Continue', 'exitNode': 'continue'},
  },
  'propertyMeta': [],
  'exitNodes': ['continue', 'close'],
  'slottable': slotId != null,
  if (slotId != null) 'slotId': slotId,
  if (slotId != null) 'slotIndex': 0,
};

Map<String, dynamic> _tourBlockJson() => {
  'id': 'tour_1',
  'blockStateId': 'state_tour_1',
  'workflowId': 'workflow_1',
  'key': 'tour',
  'type': 'tour',
  'data': {},
  'propertyMeta': [],
  'exitNodes': ['complete', 'cancel'],
  'slottable': false,
  'tourBlocks': [
    {..._blockJson(id: 'tour_step_1'), 'componentType': 'BasicsV2Modal'},
    {..._blockJson(id: 'tour_step_2'), 'componentType': 'BasicsV2Modal'},
  ],
  'currentTourIndex': 0,
};

class _FakeWebSocketChannel extends StreamChannelMixin<Object?>
    implements WebSocketChannel {
  final StreamController<Object?> _incoming = StreamController.broadcast();
  final _FakeWebSocketSink _sink = _FakeWebSocketSink();

  void addServerMessage(Object? value) => _incoming.add(value);

  Future<void> closeServer() => _incoming.close();

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

class _FakeWebSocketSink implements WebSocketSink {
  final StreamController<Object?> _outgoing = StreamController.broadcast();

  @override
  void add(Object? data) => _outgoing.add(data);

  @override
  void addError(Object error, [StackTrace? stackTrace]) =>
      _outgoing.addError(error, stackTrace);

  @override
  Future<void> addStream(Stream<Object?> stream) => _outgoing.addStream(stream);

  @override
  Future<void> close([int? closeCode, String? closeReason]) =>
      _outgoing.close();

  @override
  Future<void> get done => _outgoing.done;
}
