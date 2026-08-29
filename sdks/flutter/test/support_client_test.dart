// ignore_for_file: deprecated_member_use, deprecated_member_use_from_same_package

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:superboard_flutter/superboard_support.dart';

void main() {
  test(
    'uses the Support gateway without adding a second API version',
    () async {
      late http.Request observed;
      final client = SuperBoardSupportClient(
        baseUri: Uri.parse('https://api.example/api/v1/support-client/'),
        projectId: 11,
        identityToken: 'signed-token',
        httpClient: MockClient((request) async {
          observed = request;
          return http.Response('{"data":[]}', 200);
        }),
      );

      await client.conversations();
      expect(observed.url.path, '/api/v1/support-client/conversations');
      expect(observed.url.queryParameters, {'limit': '50'});
      expect(observed.headers['x-superboard-project-id'], '11');
      expect(observed.headers, isNot(contains('x-opengrow-project-id')));
    },
  );

  test(
    'keeps the deprecated direct Worker client on its v1 contract',
    () async {
      late http.Request observed;
      final client = SuperBoardMessagingClient(
        baseUri: Uri.parse('https://support.example'),
        projectId: 11,
        identityToken: 'signed-token',
        httpClient: MockClient((request) async {
          observed = request;
          return http.Response('{"data":[]}', 200);
        }),
      );

      await client.conversations();
      expect(observed.url.path, '/v1/conversations');
      expect(observed.headers['x-opengrow-project-id'], '11');
    },
  );

  test('parses the shared success fixture', () async {
    final fixtures = jsonDecode(_fixtureFile().readAsStringSync()) as Map;
    final success = (fixtures['success'] as Map).map(
      (key, value) => MapEntry(key.toString(), value),
    );
    final client = SuperBoardSupportClient(
      baseUri: Uri.parse('https://api.example/api/v1/support-client'),
      projectId: 11,
      identityToken: 'signed-token',
      httpClient: MockClient(
        (_) async => http.Response(jsonEncode(success), 200),
      ),
    );

    final conversation = await client.updateConversation('conversation-1');
    expect(conversation.id, 'conversation-1');
    expect(conversation.displayId, 1001);
    expect(conversation.assignedTeamId, 'team-1');
    expect(conversation.customAttributes, {'plan': 'plus'});
  });

  test('parses canonical nested errors and legacy flat errors', () async {
    var request = 0;
    final client = SuperBoardSupportClient(
      baseUri: Uri.parse('https://api.example/api/v1/support-client'),
      projectId: 11,
      identityToken: 'signed-token',
      httpClient: MockClient((_) async {
        request += 1;
        if (request == 1) {
          final fixtures = jsonDecode(_fixtureFile().readAsStringSync()) as Map;
          return http.Response(jsonEncode(fixtures['error']), 422);
        }
        return http.Response(
          '{"code":"request_failed","message":"Try again","retryable":true}',
          503,
          headers: {'X-Request-Id': 'legacy-request'},
        );
      }),
    );

    await expectLater(
      client.conversations(),
      throwsA(
        isA<SuperBoardSupportException>()
            .having((error) => error.code, 'code', 'configuration_required')
            .having((error) => error.requestId, 'requestId', 'request-2')
            .having((error) => error.details, 'details', {'provider': 'email'}),
      ),
    );
    await expectLater(
      client.conversations(),
      throwsA(
        isA<SuperBoardSupportException>()
            .having((error) => error.code, 'code', 'request_failed')
            .having((error) => error.retryable, 'retryable', isTrue)
            .having((error) => error.requestId, 'requestId', 'legacy-request'),
      ),
    );
  });

  test('sends stable idempotency keys on replayable mutations', () async {
    final requests = <http.Request>[];
    final client = SuperBoardSupportClient(
      baseUri: Uri.parse('https://api.example/api/v1/support-client'),
      projectId: 11,
      identityToken: 'signed-token',
      httpClient: MockClient((request) async {
        requests.add(request);
        if (request.url.path.endsWith('/messages')) {
          return http.Response(
            jsonEncode({
              'data': {
                'id': 'message-1',
                'conversation_id': 'conversation-1',
                'sender_kind': 'user',
                'sequence': 1,
                'created_at': '2026-08-13T10:00:00.000Z',
              },
            }),
            201,
          );
        }
        return http.Response(
          jsonEncode({
            'data': {
              'id': 'conversation-1',
              'status': 'open',
              'priority': 'normal',
            },
          }),
          201,
        );
      }),
    );

    await client.createConversation(
      clientConversationId: 'client-conversation-1',
    );
    await client.sendMessage(
      'conversation-1',
      body: 'Hello',
      clientMessageId: 'client-message-1',
    );
    expect(requests[0].headers['idempotency-key'], 'client-conversation-1');
    expect(requests[1].headers['idempotency-key'], 'client-message-1');
  });

  test(
    'uses native client routes for contact, events, help and meetings',
    () async {
      final paths = <String>[];
      final client = SuperBoardSupportClient(
        baseUri: Uri.parse('https://api.example/api/v1/support-client'),
        projectId: 11,
        identityToken: 'signed-token',
        httpClient: MockClient((request) async {
          paths.add(request.url.path);
          if (request.url.path.endsWith('/search')) {
            return http.Response('{"data":[]}', 200);
          }
          return http.Response('{"data":{"id":"result-1"}}', 200);
        }),
      );

      expect((await client.contact()).id, 'result-1');
      await client.trackEvent(
        name: 'checkout.failed',
        idempotencyKey: 'event:checkout-1',
      );
      expect(
        await client.searchHelpCenter(portalSlug: 'help', query: 'billing'),
        isEmpty,
      );
      await client.joinMeeting(
        'conversation-1',
        idempotencyKey: 'meeting:conversation-1',
      );
      expect(paths, [
        '/api/v1/support-client/contact',
        '/api/v1/support-client/events',
        '/api/v1/support-client/help-center/help/search',
        '/api/v1/support-client/conversations/conversation-1/meetings',
      ]);
    },
  );

  test('accepts the flat attachment upload response during rollout', () async {
    final client = SuperBoardSupportClient(
      baseUri: Uri.parse('https://api.example/api/v1/support-client'),
      projectId: 11,
      identityToken: 'signed-token',
      httpClient: MockClient(
        (_) async => http.Response(
          '{"key":"attachments/file","filename":"file.txt","content_type":"text/plain","size":3}',
          201,
        ),
      ),
    );

    expect(
      await client.uploadAttachment(
        'conversation-1',
        bytes: Uint8List.fromList([1, 2, 3]),
        filename: 'file.txt',
        contentType: 'text/plain',
      ),
      containsPair('key', 'attachments/file'),
    );
  });
}

File _fixtureFile() {
  var directory = Directory.current.absolute;
  while (true) {
    final candidate = File(
      '${directory.path}/packages/contracts/fixtures/support/v1.json',
    );
    if (candidate.existsSync()) return candidate;
    final parent = directory.parent;
    if (parent.path == directory.path) {
      throw StateError('Support contract fixture was not found');
    }
    directory = parent;
  }
}
