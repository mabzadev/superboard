// ignore_for_file: deprecated_member_use_from_same_package

import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:superboard_flutterflow/superboard_flutterflow.dart';

void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));
  testWidgets(
    'branches from an answer and resumes the same published version',
    (tester) async {
      final events = <Map<String, dynamic>>[];
      final client = SuperBoardExperienceClient(
        projectKey: 'questions',
        platform: 'ios',
        identifier: 'test.app',
        baseUrl: 'https://api.example.test/api/v1',
        httpClient: MockClient((request) async {
          if (request.url.path.endsWith('/resolve'))
            return http.Response(
              jsonEncode({
                'data': {
                  'onboarding_id': 'welcome',
                  'placement_id': 'launch',
                  'placement': 'app_launch',
                  'version_id': 'v1',
                  'version': 1,
                  'definition': {
                    'screens': [
                      {
                        'id': 'question',
                        'name': 'Profile',
                        'blocks': [
                          {
                            'id': 'level',
                            'type': 'question',
                            'props': {
                              'text': 'Votre niveau',
                              'attribute': 'level',
                              'required': true,
                              'options': [
                                {
                                  'value': 'beginner',
                                  'label': 'Débutant',
                                  'next_screen_id': 'beginner',
                                },
                                {
                                  'value': 'advanced',
                                  'label': 'Avancé',
                                  'next_screen_id': 'advanced',
                                },
                              ],
                            },
                          },
                          {
                            'id': 'next',
                            'type': 'button',
                            'props': {'text': 'Suivant', 'action': 'next'},
                          },
                        ],
                      },
                      {
                        'id': 'advanced',
                        'name': 'Expert',
                        'blocks': [
                          {
                            'id': 'title',
                            'type': 'heading',
                            'props': {'text': 'Parcours expert'},
                          },
                        ],
                      },
                      {
                        'id': 'beginner',
                        'name': 'Start',
                        'blocks': [
                          {
                            'id': 'title',
                            'type': 'heading',
                            'props': {'text': 'On commence ensemble'},
                          },
                          {
                            'id': 'finish',
                            'type': 'button',
                            'props': {'text': 'Terminer', 'action': 'complete'},
                          },
                        ],
                      },
                    ],
                  },
                },
              }),
              200,
            );
          final body = jsonDecode(request.body) as Map<String, dynamic>;
          events.add((body['events'] as List).single as Map<String, dynamic>);
          return http.Response('{"data":{"accepted":1}}', 202);
        }),
      );
      var completed = false;
      Widget app() => MaterialApp(
        home: SuperBoardOnboarding(
          experienceClient: client,
          customerId: 'person',
          resumeProgress: true,
          locale: 'fr',
          onCompleted: () => completed = true,
        ),
      );
      await tester.pumpWidget(app());
      await tester.pumpAndSettle();
      await tester.tap(find.text('Suivant'));
      await tester.pumpAndSettle();
      expect(
        find.text('Choisissez une réponse pour continuer.'),
        findsOneWidget,
      );
      await tester.tap(find.text('Débutant'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Suivant'));
      await tester.pumpAndSettle();
      expect(find.text('On commence ensemble'), findsOneWidget);
      expect(find.text('Parcours expert'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
      await tester.pumpWidget(app());
      await tester.pumpAndSettle();
      expect(find.text('On commence ensemble'), findsOneWidget);
      await tester.tap(find.text('Terminer'));
      await tester.pumpAndSettle();
      expect(completed, isTrue);
      expect(events.any((event) => event['type'] == 'complete'), isTrue);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
      await tester.pumpWidget(app());
      await tester.pumpAndSettle();
      expect(find.text('Votre niveau'), findsOneWidget);
    },
  );
}
