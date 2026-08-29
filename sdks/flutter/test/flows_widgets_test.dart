import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:superboard_flutter/models/superboard_purchases.dart';
import 'package:superboard_flutter/superboard_flows.dart';

void main() {
  testWidgets('slot renders a native Card and transitions through its action', (
    tester,
  ) async {
    final eventNames = <String>[];
    final client = await _client(
      MockClient((request) async {
        if (request.url.path.endsWith('/blocks')) {
          return http.Response(
            jsonEncode({
              'blocks': [_cardBlock(slotId: 'home')],
            }),
            200,
          );
        }
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        eventNames.add(body['name'].toString());
        return http.Response(
          '{"success":true,"exitedBlockIds":[],"updatedBlocks":[]}',
          200,
        );
      }),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SuperBoardFlowsSlot(slotId: 'home', client: client),
        ),
      ),
    );
    await tester.pump();

    expect(find.text('Welcome to Flows'), findsOneWidget);
    expect(find.text('Continue'), findsOneWidget);
    await tester.tap(find.text('Continue'));
    await tester.pump();

    expect(eventNames, containsAll(['block-activated', 'transition']));
    await client.dispose();
  });

  testWidgets('custom component builders receive block and controller', (
    tester,
  ) async {
    final registry = SuperBoardFlowBuilderRegistry();
    registry.register(
      'MyNativeComponent',
      (context, block, controller) => Text('Custom ${block.data['title']}'),
    );
    final client = await _client(
      MockClient((request) async {
        if (request.url.path.endsWith('/blocks')) {
          return http.Response(
            jsonEncode({
              'blocks': [
                {
                  ..._cardBlock(slotId: 'custom'),
                  'componentType': 'MyNativeComponent',
                },
              ],
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

    await tester.pumpWidget(
      MaterialApp(
        home: SuperBoardFlowsSlot(
          slotId: 'custom',
          client: client,
          registry: registry,
        ),
      ),
    );
    await tester.pump();

    expect(find.text('Custom Welcome to Flows'), findsOneWidget);
    await client.dispose();
  });

  testWidgets('native anchor exposes geometry for mobile tooltips', (
    tester,
  ) async {
    final anchors = SuperBoardFlowAnchorController();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Align(
            alignment: Alignment.topLeft,
            child: SuperBoardFlowAnchor(
              name: 'settings-button',
              controller: anchors,
              child: const SizedBox(width: 80, height: 40),
            ),
          ),
        ),
      ),
    );

    final rect = anchors.rectFor('settings-button');
    expect(rect, isNotNull);
    expect(rect!.size, const Size(80, 40));
  });

  testWidgets('anchored tooltip waits for layout before activation', (
    tester,
  ) async {
    final events = <Map<String, dynamic>>[];
    final anchors = SuperBoardFlowAnchorController();
    final client = await _client(
      MockClient((request) async {
        if (request.url.path.endsWith('/blocks')) {
          return http.Response('{"blocks":[]}', 200);
        }
        events.add(jsonDecode(request.body) as Map<String, dynamic>);
        return http.Response(
          '{"success":true,"exitedBlockIds":[],"updatedBlocks":[]}',
          200,
        );
      }),
    );
    final block = SuperBoardFlowBlock.fromJson({
      ..._cardBlock(slotId: 'tooltip'),
      'componentType': 'BasicsV2Tooltip',
      'data': {'title': 'Anchored help', 'targetElement': '#settings-button'},
    });

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              SuperBoardFlowAnchor(
                name: 'settings-button',
                controller: anchors,
                child: const SizedBox(width: 80, height: 40),
              ),
              SuperBoardFlowRenderer(
                block: block,
                client: client,
                anchorController: anchors,
              ),
            ],
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.text('Anchored help'), findsOneWidget);
    expect(
      events.where((event) => event['name'] == 'block-activated'),
      hasLength(1),
    );
    await client.dispose();
  });

  testWidgets('survey supports native freeform submission', (tester) async {
    final requests = <Map<String, dynamic>>[];
    final surveyIdempotencyKeys = <String>[];
    final client = await _client(
      MockClient((request) async {
        if (request.url.path.endsWith('/blocks')) {
          return http.Response(
            jsonEncode({
              'blocks': [_surveyBlock()],
            }),
            200,
          );
        }
        requests.add(jsonDecode(request.body) as Map<String, dynamic>);
        if (request.url.path.endsWith('/survey')) {
          surveyIdempotencyKeys.add(request.headers['idempotency-key'] ?? '');
        }
        return http.Response(
          request.url.path.endsWith('/survey')
              ? '{"success":true}'
              : '{"success":true,"exitedBlockIds":[],"updatedBlocks":[]}',
          200,
        );
      }),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              SuperBoardFlowRenderer(
                block: client.blocks.single,
                client: client,
              ),
            ],
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.enterText(find.byType(TextField), 'Very useful');
    await tester.tap(find.text('Submit'));
    await tester.pumpAndSettle();

    final survey = requests.firstWhere(
      (request) => request.containsKey('surveyId'),
    );
    expect(survey['questions'], [
      {'questionId': 'question_1', 'textResponse': 'Very useful'},
    ]);
    expect(survey['eventId'], surveyIdempotencyKeys.single);
    expect(requests.map((request) => request['name']), contains('transition'));
    await client.dispose();
  });

  testWidgets('native Basics V2 card golden', (tester) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(600, 400);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);
    final client = await _client(
      MockClient((request) async {
        if (request.url.path.endsWith('/blocks')) {
          return http.Response(jsonEncode({'blocks': []}), 200);
        }
        return http.Response(
          '{"success":true,"exitedBlockIds":[],"updatedBlocks":[]}',
          200,
        );
      }),
    );
    final block = SuperBoardFlowBlock.fromJson(_cardBlock(slotId: 'golden'));

    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF5B5FF0)),
          useMaterial3: true,
        ),
        home: Scaffold(
          body: RepaintBoundary(
            key: const ValueKey('flows-card-golden'),
            child: SuperBoardFlowCard(
              block: block,
              controller: SuperBoardFlowComponentController(
                client: client,
                block: block,
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await expectLater(
      find.byKey(const ValueKey('flows-card-golden')),
      matchesGoldenFile('goldens/flows_card.png'),
    );
    await client.dispose();
  });

  testWidgets(
    'commerce delegates checkout to Products and only emits an outcome transition',
    (tester) async {
      final requests = <Map<String, dynamic>>[];
      final client = await _client(
        MockClient((request) async {
          if (request.url.path.endsWith('/blocks')) {
            return http.Response('{"blocks":[]}', 200);
          }
          requests.add(jsonDecode(request.body) as Map<String, dynamic>);
          return http.Response(
            '{"success":true,"exitedBlockIds":[],"updatedBlocks":[]}',
            200,
          );
        }),
      );
      final gateway = _FakeCommerceGateway();
      final block = SuperBoardFlowBlock.fromJson(_commerceBlock());

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SuperBoardFlowCommerce(
              block: block,
              client: client,
              gateway: gateway,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Premium access'), findsOneWidget);
      expect(find.text(r'$4.99'), findsOneWidget);
      await tester.tap(find.text('Buy now'));
      await tester.pumpAndSettle();

      expect(gateway.purchasedPackages, ['monthly']);
      final transition = requests.singleWhere(
        (request) => request['name'] == 'transition',
      );
      expect(transition['propertyKey'], 'purchase');
      final properties = transition['properties'] as Map<String, dynamic>;
      expect(properties['authority'], 'products');
      expect(properties['packageIdentifier'], 'monthly');
      expect(properties['transactionIdentifier'], 'verified_transaction');
      expect(properties, isNot(contains('revenue')));
      expect(properties, isNot(contains('revenueMicros')));
      expect(properties, isNot(contains('price')));
      await client.dispose();
    },
  );

  testWidgets('tour delay resumes the next native step and persists progress', (
    tester,
  ) async {
    final events = <Map<String, dynamic>>[];
    final client = await _client(
      MockClient((request) async {
        if (request.url.path.endsWith('/blocks')) {
          return http.Response('{"blocks":[]}', 200);
        }
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        events.add(body);
        return http.Response(
          '{"success":true,"exitedBlockIds":[],"updatedBlocks":[]}',
          200,
        );
      }),
    );
    final tour = SuperBoardFlowBlock.fromJson(_tourBlock());

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [SuperBoardFlowRenderer(block: tour, client: client)],
          ),
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 25));
    await tester.pump();

    expect(find.text('After the delay'), findsOneWidget);
    final update = events.singleWhere(
      (event) => event['name'] == 'tour-update',
    );
    expect(update['properties'], containsPair('currentTourIndex', 1));
    expect(client.tourIndex(tour), 1);
    await client.dispose();
  });

  testWidgets('tour click trigger waits for a native anchor interaction', (
    tester,
  ) async {
    final eventNames = <String>[];
    final anchors = SuperBoardFlowAnchorController();
    final client = await _client(
      MockClient((request) async {
        if (request.url.path.endsWith('/blocks')) {
          return http.Response('{"blocks":[]}', 200);
        }
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        eventNames.add(body['name'].toString());
        return http.Response(
          '{"success":true,"exitedBlockIds":[],"updatedBlocks":[]}',
          200,
        );
      }),
    );
    final tour = SuperBoardFlowBlock.fromJson(_clickTriggeredTourBlock());

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              Align(
                alignment: Alignment.topLeft,
                child: SuperBoardFlowAnchor(
                  name: 'settings',
                  controller: anchors,
                  child: const TextButton(
                    onPressed: null,
                    child: Text('Settings'),
                  ),
                ),
              ),
              SuperBoardFlowRenderer(
                block: tour,
                client: client,
                anchorController: anchors,
              ),
            ],
          ),
        ),
      ),
    );
    await tester.pump();
    expect(find.text('Triggered tour'), findsNothing);

    await tester.tap(find.text('Settings'));
    await tester.pump();

    expect(find.text('Triggered tour'), findsOneWidget);
    expect(eventNames, contains('block-activated'));
    await client.dispose();
  });

  testWidgets('survey trigger is persisted and resumes without another click', (
    tester,
  ) async {
    final storage = SuperBoardMemoryFlowStorage();
    final events = <Map<String, dynamic>>[];
    final online = SuperBoardFlowsClient(
      apiUrl: 'https://board.example/api/v1/flows',
      projectId: 'project_1',
      environment: 'test',
      userId: 'user_1',
      realtime: false,
      storage: storage,
      httpClient: MockClient((request) async {
        if (request.url.path.endsWith('/blocks')) {
          return http.Response(
            jsonEncode({
              'blocks': [_clickTriggeredSurveyBlock()],
            }),
            200,
          );
        }
        events.add(jsonDecode(request.body) as Map<String, dynamic>);
        return http.Response(
          '{"success":true,"exitedBlockIds":[],"updatedBlocks":[]}',
          200,
        );
      }),
    );
    await online.start();
    final anchors = SuperBoardFlowAnchorController();

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Stack(
            children: [
              SuperBoardFlowAnchor(
                name: 'feedback',
                controller: anchors,
                child: const Text('Feedback'),
              ),
              SuperBoardFlowRenderer(
                block: online.blocks.single,
                client: online,
                anchorController: anchors,
              ),
            ],
          ),
        ),
      ),
    );
    await tester.pump();
    expect(find.text('How useful is this?'), findsNothing);

    await tester.tap(find.text('Feedback'));
    await tester.pump();
    expect(find.text('How useful is this?'), findsOneWidget);
    expect(events.map((event) => event['name']), contains('block-activated'));
    expect((await storage.read())?.activeSurveyBlockStates, [
      'state_survey_triggered',
    ]);
    await online.dispose();

    final offline = SuperBoardFlowsClient(
      apiUrl: 'https://board.example/api/v1/flows',
      projectId: 'project_1',
      environment: 'test',
      userId: 'user_1',
      realtime: false,
      storage: storage,
      httpClient: MockClient(
        (_) async => throw http.ClientException('offline'),
      ),
    );
    await offline.start();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SuperBoardFlowRenderer(
            block: offline.blocks.single,
            client: offline,
          ),
        ),
      ),
    );
    await tester.pump();
    expect(find.text('How useful is this?'), findsOneWidget);
    await offline.dispose();
  });
}

Future<SuperBoardFlowsClient> _client(http.Client httpClient) async {
  final client = SuperBoardFlowsClient(
    apiUrl: 'https://board.example/api/v1/flows',
    projectId: 'project_1',
    environment: 'test',
    userId: 'user_1',
    realtime: false,
    storage: SuperBoardMemoryFlowStorage(),
    httpClient: httpClient,
  );
  await client.start();
  return client;
}

Map<String, dynamic> _cardBlock({required String slotId}) => {
  'id': 'card_1',
  'blockStateId': 'state_card_1',
  'workflowId': 'workflow_1',
  'key': 'welcome_card',
  'type': 'component',
  'componentType': 'BasicsV2Card',
  'data': {'title': 'Welcome to Flows', 'body': 'A native mobile component.'},
  'propertyMeta': [
    {
      'key': 'primaryButton',
      'type': 'action',
      'value': {'label': 'Continue', 'exitNode': 'continue'},
    },
  ],
  'exitNodes': ['continue', 'close'],
  'slottable': true,
  'slotId': slotId,
  'slotIndex': 0,
};

Map<String, dynamic> _surveyBlock() => {
  'id': 'survey_1',
  'blockStateId': 'state_survey_1',
  'workflowId': 'workflow_1',
  'key': 'feedback',
  'type': 'survey',
  'componentType': 'BasicsV2SurveyPopover',
  'data': {},
  'propertyMeta': [],
  'exitNodes': ['submit', 'close'],
  'slottable': false,
  'survey': {
    'id': 'survey_1',
    'blockStateId': 'state_survey_1',
    'questions': [
      {
        'id': 'question_1',
        'type': 'freeform',
        'title': 'How useful is this?',
        'optional': false,
        'textPlaceholder': 'Your answer',
      },
    ],
  },
};

Map<String, dynamic> _commerceBlock() => {
  'id': 'commerce_1',
  'blockStateId': 'state_commerce_1',
  'workflowId': 'workflow_1',
  'key': 'superboard-commerce',
  'type': 'component',
  'componentType': 'superboard-commerce',
  'data': {
    'placement': 'premium',
    'metadata': {'offering_identifier': 'premium'},
    'components': [
      {
        'type': 'heading',
        'props': {'text': 'Premium access'},
      },
      {
        'type': 'button',
        'props': {'text': 'Buy now', 'action': 'purchase'},
      },
    ],
    'authority': 'products',
    'purchase_events_are_verified': true,
  },
  'propertyMeta': [],
  'exitNodes': [
    'dismiss',
    'checkout',
    'purchase',
    'cancel',
    'restore',
    'error',
  ],
  'slottable': true,
  'slotId': 'paywall',
};

Map<String, dynamic> _clickTriggeredSurveyBlock() => {
  ..._surveyBlock(),
  'blockStateId': 'state_survey_triggered',
  'tour_trigger': {
    '\$and': [
      {'type': 'click', 'value': 'feedback'},
    ],
  },
  'survey': {
    ...(_surveyBlock()['survey'] as Map<String, dynamic>),
    'blockStateId': 'state_survey_triggered',
  },
};

Map<String, dynamic> _tourBlock() => {
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
    {
      'id': 'wait_1',
      'workflowId': 'workflow_1',
      'key': 'wait',
      'type': 'wait',
      'data': {},
      'propertyMeta': [],
      'exitNodes': [],
      'slottable': false,
      'tourWait': {'interaction': 'delay', 'ms': 10},
    },
    {
      ..._cardBlock(slotId: 'tour'),
      'id': 'tour_card',
      'blockStateId': 'state_tour_card',
      'slottable': false,
      'data': {'title': 'After the delay'},
    },
  ],
  'currentTourIndex': 0,
};

Map<String, dynamic> _clickTriggeredTourBlock() => {
  'id': 'tour_triggered',
  'blockStateId': 'state_tour_triggered',
  'workflowId': 'workflow_1',
  'key': 'triggered_tour',
  'type': 'tour',
  'data': {},
  'propertyMeta': [],
  'exitNodes': ['complete', 'cancel'],
  'slottable': false,
  'tour_trigger': {
    '\$and': [
      {'type': 'click', 'value': 'settings'},
    ],
  },
  'tourBlocks': [
    {
      ..._cardBlock(slotId: 'tour'),
      'id': 'triggered_card',
      'blockStateId': 'state_triggered_card',
      'slottable': false,
      'data': {'title': 'Triggered tour'},
    },
  ],
  'currentTourIndex': 0,
};

class _FakeCommerceGateway implements SuperBoardFlowCommerceGateway {
  final List<String> purchasedPackages = [];

  @override
  Future<SuperBoardOfferings> getOfferings({required String placement}) async {
    final offering = SuperBoardOffering(
      identifier: 'premium',
      displayName: 'Premium',
      packages: const [
        SuperBoardPackage(
          identifier: 'monthly',
          packageType: 'monthly',
          product: SuperBoardStoreProduct(
            identifier: 'premium_monthly',
            type: 'subscription',
            title: 'Monthly',
            localizedPrice: r'$4.99',
          ),
        ),
      ],
    );
    return SuperBoardOfferings(
      all: {offering.identifier: offering},
      current: offering,
    );
  }

  @override
  Future<SuperBoardPurchaseResult> purchasePackage(
    SuperBoardPackage package,
  ) async {
    purchasedPackages.add(package.identifier);
    return SuperBoardPurchaseResult(
      SuperBoardPurchaseOutcome.purchased,
      productIdentifier: package.product.identifier,
      transactionIdentifier: 'verified_transaction',
    );
  }

  @override
  Future<SuperBoardCustomerInfo> restorePurchases() =>
      throw UnimplementedError();
}
