import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:superboard_flutterflow/superboard_flutterflow.dart';

void main() {
  test('preserves an API gateway path prefix for canonical Support', () async {
    Uri? requested;
    final client = SuperBoardMessagingClient(
      baseUri: Uri.parse('https://api.example/api/v1/support-client'),
      projectId: 11,
      identityToken: 'signed-token',
      httpClient: MockClient((request) async {
        requested = request.url;
        return http.Response(jsonEncode({'data': []}), 200);
      }),
    );

    await client.conversations();
    expect(
      requested.toString(),
      'https://api.example/api/v1/support-client/v1/conversations',
    );
  });

  test('sends application identity and project headers', () async {
    final client = SuperBoardMessagingClient(
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

  test('decodes every normalized Support message attachment', () {
    final message = SuperBoardMessage.fromJson({
      'id': 'message-1',
      'conversation_id': 'conversation-1',
      'sender_kind': 'agent',
      'sequence': 1,
      'created_at': '2026-08-08T00:00:00.000Z',
      'body': null,
      'attachments_json': jsonEncode([
        {
          'id': 'attachment-2',
          'file_name': 'second.pdf',
          'content_type': 'application/pdf',
          'byte_size': 20,
          'position': 1,
        },
        {
          'id': 'attachment-1',
          'file_name': 'first.png',
          'content_type': 'image/png',
          'byte_size': 10,
          'position': 0,
        },
      ]),
    });

    expect(message.attachments.map((item) => item.id), [
      'attachment-1',
      'attachment-2',
    ]);
    expect(message.toJson()['attachments'], hasLength(2));
  });

  test('surfaces stable server errors', () async {
    final client = SuperBoardMessagingClient(
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
    expect(client.conversations, throwsA(isA<SuperBoardMessagingException>()));
  });

  test(
    'refreshes an expired identity once and retries the failed request',
    () async {
      var refreshes = 0;
      var requests = 0;
      final client = SuperBoardMessagingClient(
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
                  'unread_count': 3,
                },
              ],
            }),
            200,
          );
        }),
      );

      final conversation = (await client.conversations()).single;
      expect(conversation.id, 'conversation-1');
      expect(conversation.unreadCount, 3);
      expect(refreshes, 1);
      expect(requests, 2);
    },
  );

  test(
    'exposes read receipts and typing updates with authenticated requests',
    () async {
      final requests = <http.Request>[];
      final client = SuperBoardMessagingClient(
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

  test('returns a retryable error when an HTTP request times out', () async {
    final client = SuperBoardMessagingClient(
      baseUri: Uri.parse('https://messages.example'),
      projectId: 11,
      identityToken: 'token',
      requestTimeout: const Duration(milliseconds: 1),
      httpClient: MockClient((_) => Completer<http.Response>().future),
    );

    await expectLater(
      client.conversations(),
      throwsA(
        isA<SuperBoardMessagingException>()
            .having((error) => error.code, 'code', 'request_timeout')
            .having((error) => error.retryable, 'retryable', isTrue),
      ),
    );
  });

  test('rejects an oversized attachment before starting the upload', () async {
    var requests = 0;
    final client = SuperBoardMessagingClient(
      baseUri: Uri.parse('https://messages.example'),
      projectId: 11,
      identityToken: 'token',
      httpClient: MockClient((_) async {
        requests += 1;
        return http.Response('{}', 200);
      }),
    );

    await expectLater(
      client.uploadAttachment(
        'conversation-1',
        bytes: Uint8List(10 * 1024 * 1024 + 1),
        filename: 'large.bin',
        contentType: 'application/octet-stream',
      ),
      throwsA(
        isA<SuperBoardMessagingException>().having(
          (error) => error.code,
          'code',
          'attachment_invalid',
        ),
      ),
    );
    expect(requests, 0);
  });

  test(
    'loads remote configuration and sends advanced messages and CSAT',
    () async {
      final requests = <http.Request>[];
      final client = SuperBoardMessagingClient(
        baseUri: Uri.parse('https://messages.example'),
        projectId: 11,
        identityToken: 'token',
        httpClient: MockClient((request) async {
          requests.add(request);
          if (request.url.path == '/v1/configuration') {
            return http.Response(
              jsonEncode({
                'data': {'locale': 'en', 'inboxes': []},
              }),
              200,
            );
          }
          if (request.url.path.endsWith('/csat')) {
            return http.Response(
              jsonEncode({
                'data': {'rating': 5, 'feedback': 'Great'},
              }),
              201,
            );
          }
          return http.Response(
            jsonEncode({
              'data': {
                'id': 'message-1',
                'conversation_id': 'conversation-1',
                'sender_kind': 'user',
                'sequence': 1,
                'created_at': '2026-08-05T00:00:00Z',
                'body': 'Choice',
                'content_type': 'input_select',
                'reply_to_message_id': 'message-0',
                'metadata_json': '{"choice":"one"}',
              },
            }),
            201,
          );
        }),
      );

      expect(await client.configuration(), {'locale': 'en', 'inboxes': []});
      final message = await client.sendMessage(
        'conversation-1',
        body: 'Choice',
        clientMessageId: 'local-1',
        contentType: 'input_select',
        replyToMessageId: 'message-0',
        metadata: {'choice': 'one'},
      );
      expect(message.contentType, 'input_select');
      expect(message.metadata, {'choice': 'one'});
      expect(
        await client.submitCsat('conversation-1', rating: 5, feedback: 'Great'),
        {'rating': 5, 'feedback': 'Great'},
      );
      expect(
        jsonDecode(requests[1].body),
        containsPair('reply_to_message_id', 'message-0'),
      );
      expect(requests[2].url.path, '/v1/conversations/conversation-1/csat');
    },
  );
}
