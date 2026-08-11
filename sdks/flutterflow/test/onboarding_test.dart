import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:superboard_flutterflow/superboard_flutterflow.dart';

void main() {
  testWidgets('renders screens, tracks progression and completes', (
    tester,
  ) async {
    final eventTypes = <String>[];
    final client = SuperBoardExperienceClient(
      projectKey: 'test_key',
      platform: 'ios',
      identifier: 'com.example.app',
      baseUrl: 'https://api.example.com/api/v1',
      httpClient: MockClient((request) async {
        if (request.url.path.endsWith('/resolve')) {
          return http.Response(
            jsonEncode({
              'data': {
                'onboarding_id': 'onboarding_1',
                'placement_id': 'placement_1',
                'placement': 'app_launch',
                'version_id': 'version_1',
                'version': 1,
                'definition': {
                  'theme': {'accent_color': '#ff0066'},
                  'screens': [
                    {
                      'id': 'welcome',
                      'name': 'Welcome',
                      'blocks': [
                        {
                          'id': 'title',
                          'type': 'heading',
                          'props': {'text': 'Welcome'},
                        },
                        {
                          'id': 'next',
                          'type': 'button',
                          'props': {'text': 'Next', 'action': 'next'},
                        },
                      ],
                    },
                    {
                      'id': 'done',
                      'name': 'Done',
                      'blocks': [
                        {
                          'id': 'title',
                          'type': 'heading',
                          'props': {'text': 'All done'},
                        },
                        {
                          'id': 'finish',
                          'type': 'button',
                          'props': {'text': 'Finish', 'action': 'complete'},
                        },
                      ],
                    },
                  ],
                },
              },
            }),
            200,
          );
        }
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        eventTypes.add(
          ((body['events'] as List).single as Map)['type'].toString(),
        );
        return http.Response('{"data":{"accepted":1}}', 202);
      }),
    );
    var completed = false;
    await tester.pumpWidget(
      MaterialApp(
        home: SuperBoardOnboarding(
          experienceClient: client,
          onCompleted: () => completed = true,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Welcome'), findsOneWidget);
    await tester.tap(find.text('Next'));
    await tester.pumpAndSettle();
    expect(find.text('All done'), findsOneWidget);
    await tester.tap(find.text('Finish'));
    await tester.pumpAndSettle();
    expect(completed, isTrue);
    expect(
      eventTypes,
      containsAllInOrder([
        'impression',
        'step_view',
        'progress',
        'step_view',
        'complete',
      ]),
    );
  });

  testWidgets(
    'renders nothing and invokes unavailable when no version resolves',
    (tester) async {
      var unavailable = false;
      final client = SuperBoardExperienceClient(
        projectKey: 'test_key',
        platform: 'ios',
        identifier: 'com.example.app',
        baseUrl: 'https://api.example.com/api/v1',
        httpClient: MockClient(
          (_) async => http.Response('{"data":null}', 200),
        ),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: SuperBoardOnboarding(
            experienceClient: client,
            onUnavailable: () => unavailable = true,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(unavailable, isTrue);
      expect(find.byType(CircularProgressIndicator), findsNothing);
    },
  );

  testWidgets(
    'records explicit newsletter consent independently during onboarding',
    (tester) async {
      final updates = <Map<String, dynamic>>[];
      final client = SuperBoardExperienceClient(
        projectKey: 'test_key',
        platform: 'ios',
        identifier: 'com.example.app',
        baseUrl: 'https://api.example.com/api/v1',
        httpClient: MockClient((request) async {
          if (request.url.path.endsWith('/resolve')) {
            return http.Response(
              jsonEncode({
                'data': {
                  'onboarding_id': 'onboarding_marketing',
                  'placement_id': 'placement_marketing',
                  'placement': 'app_launch',
                  'version_id': 'version_marketing_1',
                  'version': 1,
                  'definition': {
                    'screens': [
                      {
                        'id': 'preferences',
                        'blocks': [
                          {
                            'id': 'newsletter',
                            'type': 'marketing_consent',
                            'props': {
                              'title': 'Send me VocoStar news',
                              'body': 'Transactional account emails continue.',
                              'list_ids': ['product-news'],
                              'attributes': {'source': 'onboarding'},
                            },
                          },
                          {
                            'id': 'finish',
                            'type': 'button',
                            'props': {'text': 'Finish', 'action': 'complete'},
                          },
                        ],
                      },
                    ],
                  },
                },
              }),
              200,
            );
          }
          return http.Response('{"data":{"accepted":1}}', 202);
        }),
      );
      var completed = false;
      await tester.pumpWidget(
        MaterialApp(
          home: SuperBoardOnboarding(
            anonymousId: 'installation-1',
            experienceClient: client,
            marketingConsentUpdater:
                ({
                  required consented,
                  required idempotencyKey,
                  attributesJson = '{}',
                  listIdsJson = '[]',
                }) async {
                  updates.add({
                    'consented': consented,
                    'idempotency_key': idempotencyKey,
                    'attributes': jsonDecode(attributesJson),
                    'list_ids': jsonDecode(listIdsJson),
                  });
                  return '{"data":{"consented":true}}';
                },
            onCompleted: () => completed = true,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Send me VocoStar news'), findsOneWidget);
      await tester.tap(find.byType(Checkbox));
      await tester.pump();
      await tester.tap(find.text('Finish'));
      await tester.pumpAndSettle();

      expect(completed, isTrue);
      expect(updates, hasLength(1));
      expect(updates.single['consented'], isTrue);
      expect(updates.single['list_ids'], ['product-news']);
      expect(updates.single['attributes'], {'source': 'onboarding'});
      expect(
        updates.single['idempotency_key'],
        startsWith('onboarding-consent:version_marketing_1:installation-1:'),
      );
    },
  );
}
