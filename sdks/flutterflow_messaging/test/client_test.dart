import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:opengrow_flutterflow_messaging/opengrow_flutterflow_messaging.dart';

void main() {
  test('sends application identity and project headers', () async {
    final client = OpenGrowMessagingClient(
      baseUri: Uri.parse('https://messages.example'),
      projectId: 11,
      identityToken: 'signed-token',
      httpClient: MockClient((request) async {
        expect(request.headers['authorization'], 'Bearer signed-token');
        expect(request.headers['x-opengrow-project-id'], '11');
        return http.Response(
          jsonEncode({
            'data': [
              {'id': 'conversation-1', 'status': 'open', 'priority': 'normal'},
            ],
          }),
          200,
        );
      }),
    );
    expect((await client.conversations()).single.id, 'conversation-1');
  });

  test('surfaces stable server errors', () async {
    final client = OpenGrowMessagingClient(
      baseUri: Uri.parse('https://messages.example'),
      projectId: 11,
      identityToken: 'token',
      httpClient: MockClient(
        (_) async => http.Response(
          jsonEncode({
            'code': 'identity_invalid',
            'message': 'expired',
            'retryable': false,
          }),
          401,
        ),
      ),
    );
    expect(client.conversations, throwsA(isA<OpenGrowMessagingException>()));
  });

  test(
    'refreshes an expired identity once and retries the failed request',
    () async {
      var refreshes = 0;
      var requests = 0;
      final client = OpenGrowMessagingClient(
        baseUri: Uri.parse('https://messages.example'),
        projectId: 11,
        identityToken: 'expired-token',
        identityTokenProvider: () async {
          refreshes += 1;
          return 'fresh-token';
        },
        httpClient: MockClient((request) async {
          requests += 1;
          if (request.headers['authorization'] == 'Bearer expired-token') {
            return http.Response(
              jsonEncode({
                'code': 'identity_invalid',
                'message': 'Identity token is invalid or expired',
                'retryable': false,
              }),
              401,
            );
          }
          expect(request.headers['authorization'], 'Bearer fresh-token');
          return http.Response(
            jsonEncode({
              'data': [
                {
                  'id': 'conversation-1',
                  'status': 'open',
                  'priority': 'normal',
                },
              ],
            }),
            200,
          );
        }),
      );

      expect((await client.conversations()).single.id, 'conversation-1');
      expect(refreshes, 1);
      expect(requests, 2);
    },
  );

  test(
    'exposes read receipts and typing updates with authenticated requests',
    () async {
      final requests = <http.Request>[];
      final client = OpenGrowMessagingClient(
        baseUri: Uri.parse('https://messages.example'),
        projectId: 42,
        identityToken: 'signed-token',
        httpClient: MockClient((request) async {
          requests.add(request);
          if (request.url.path.endsWith('/read')) {
            return http.Response(
              jsonEncode({'read_at': '2026-08-04T00:00:00.000Z'}),
              200,
            );
          }
          return http.Response('', 204);
        }),
      );

      expect(
        await client.markRead('conversation/with space'),
        '2026-08-04T00:00:00.000Z',
      );
      await client.setTyping('conversation/with space', true);
      expect(requests.map((request) => request.url.path).toList(), [
        '/v1/conversations/conversation%2Fwith%20space/read',
        '/v1/conversations/conversation%2Fwith%20space/typing',
      ]);
      expect(jsonDecode(requests.last.body), {'active': true});
      expect(
        requests.every(
          (request) => request.headers['x-opengrow-project-id'] == '42',
        ),
        isTrue,
      );
    },
  );
}
