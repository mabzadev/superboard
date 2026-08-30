import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:superboard_flutterflow/superboard_flutterflow.dart';

void main() {
  test('all canonical Support actions use the native gateway contract', () async {
    final server = await _SupportTestServer.start();
    addTearDown(server.close);
    addTearDown(superboardSupportDispose);

    final initialized = await superboardSupportInitializeAuthenticated(
      applicationAccessToken: 'application-token',
      projectId: 42,
      authGatewayUrl: server.origin,
      supportUrl: '${server.origin}/api/v1/support-client',
    );
    expect(initialized, isTrue);
    final realtimeEvents = <Map<String, dynamic>>[];
    final realtimeSubscription = superboardSupportEventJsonStream.listen(
      (event) => realtimeEvents.add(jsonDecode(event) as Map<String, dynamic>),
    );
    addTearDown(realtimeSubscription.cancel);

    expect(
      jsonDecode(await superboardSupportGetConfigurationJson()),
      containsPair('locale', 'fr'),
    );
    expect(
      jsonDecode(await superboardSupportListConversationsJson()),
      isA<List<Object?>>(),
    );
    expect(
      await superboardSupportOpenConversation(
        clientConversationId: 'client-conversation-1',
        subject: 'Question',
        inboxId: 'inbox-1',
        customAttributesJson: '{"plan":"pro"}',
      ),
      'conversation-1',
    );
    expect(
      jsonDecode(
        await superboardSupportUpdateConversationJson(
          conversationId: 'conversation-1',
          status: 'pending',
          customAttributesJson: '{"topic":"billing"}',
        ),
      ),
      containsPair('status', 'open'),
    );
    expect(
      jsonDecode(
        await superboardSupportMessagesJson(
          'conversation-1',
          beforeSequence: 3,
          limit: 25,
        ),
      ),
      isA<List<Object?>>(),
    );
    expect(
      await superboardSupportSend(
        conversationId: 'conversation-1',
        body: 'Bonjour',
        clientMessageId: 'message-client-1',
      ),
      'message-1',
    );
    expect(
      await superboardSupportSendAdvanced(
        conversationId: 'conversation-1',
        body: 'Choix',
        clientMessageId: 'message-client-2',
        contentType: 'input_select',
        replyToMessageId: 'message-0',
        metadataJson: '{"choice":"one"}',
      ),
      'message-1',
    );
    expect(
      jsonDecode(
        await superboardSupportSubmitCsatJson(
          conversationId: 'conversation-1',
          rating: 5,
          feedback: 'Merci',
        ),
      ),
      containsPair('rating', 5),
    );
    final attachment =
        jsonDecode(
              await superboardSupportUploadAttachmentJson(
                conversationId: 'conversation-1',
                bytes: Uint8List.fromList([1, 2, 3]),
                filename: 'preuve.txt',
                contentType: 'text/plain',
              ),
            )
            as Map<String, dynamic>;
    expect(attachment['key'], 'attachment-key');
    expect(
      await superboardSupportDownloadAttachment(
        conversationId: 'conversation-1',
        messageId: 'message-1',
        attachmentId: 'attachment-1',
      ),
      Uint8List.fromList([1, 2, 3]),
    );
    expect(
      await superboardSupportSendAttachment(
        conversationId: 'conversation-1',
        attachmentJson: jsonEncode(attachment),
        clientMessageId: 'message-client-3',
        body: 'Pièce jointe',
      ),
      'message-1',
    );
    expect(
      await superboardSupportMarkRead('conversation-1'),
      '2026-08-13T12:00:00.000Z',
    );
    expect(await superboardSupportSetTyping('conversation-1', true), isTrue);
    expect(await superboardSupportConnectRealtime('conversation-1'), isTrue);
    await Future<void>.delayed(Duration.zero);
    expect(
      jsonDecode(await superboardSupportGetLastRealtimeEventJson()),
      containsPair('type', 'connected'),
    );
    expect(realtimeEvents.single, containsPair('type', 'connected'));
    expect(await superboardSupportDisconnectRealtime(), isTrue);

    expect(
      jsonDecode(await superboardSupportGetContactJson()),
      containsPair('id', 'contact-1'),
    );
    expect(
      jsonDecode(
        await superboardSupportUpdateContactJson(
          name: 'Ada',
          email: 'ada@example.com',
          customAttributesJson: '{"tier":"gold"}',
          idempotencyKey: 'contact-update-1',
        ),
      ),
      containsPair('name', 'Ada'),
    );
    expect(
      jsonDecode(
        await superboardSupportTrackEventJson(
          name: 'account.viewed',
          propertiesJson: '{"screen":"account"}',
          idempotencyKey: 'event-1',
        ),
      ),
      containsPair('id', 'event-1'),
    );
    expect(
      jsonDecode(await superboardSupportInboxMembersJson('inbox-1')),
      isA<List<Object?>>(),
    );
    expect(
      jsonDecode(
        await superboardSupportProactiveSupportJson(
          cursor: 'cursor-1',
          limit: 10,
        ),
      ),
      isA<List<Object?>>(),
    );
    expect(
      jsonDecode(
        await superboardSupportConversationLabelsJson('conversation-1'),
      ),
      isA<List<Object?>>(),
    );
    expect(
      jsonDecode(
        await superboardSupportRequestTranscriptJson(
          conversationId: 'conversation-1',
          idempotencyKey: 'transcript-1',
        ),
      ),
      containsPair('status', 'queued'),
    );
    expect(
      jsonDecode(
        await superboardSupportHelpCenterCategoriesJson(
          portalSlug: 'aide',
          locale: 'fr',
        ),
      ),
      isA<List<Object?>>(),
    );
    expect(
      jsonDecode(
        await superboardSupportSearchHelpCenterJson(
          portalSlug: 'aide',
          query: 'compte',
          locale: 'fr',
          limit: 10,
        ),
      ),
      isA<List<Object?>>(),
    );
    expect(
      jsonDecode(
        await superboardSupportHelpCenterArticleJson(
          portalSlug: 'aide',
          articleSlug: 'mon-compte',
          locale: 'fr',
        ),
      ),
      containsPair('slug', 'mon-compte'),
    );
    expect(
      jsonDecode(
        await superboardSupportRecordHelpCenterViewJson(
          portalSlug: 'aide',
          articleSlug: 'mon-compte',
          idempotencyKey: 'view-1',
        ),
      ),
      containsPair('recorded', true),
    );
    expect(
      jsonDecode(
        await superboardSupportJoinMeetingJson(
          conversationId: 'conversation-1',
          meetingId: 'meeting-1',
          idempotencyKey: 'meeting-join-1',
        ),
      ),
      containsPair('meeting_id', 'meeting-1'),
    );
    expect(await superboardSupportDispose(), isTrue);

    expect(server.requests, isNotEmpty);
    expect(
      server.requests.every(
        (request) =>
            !request.path.contains('/v1/v1/') &&
            !request.path.contains('/api/v1/support-client/v1/'),
      ),
      isTrue,
    );
    expect(
      server.requests
          .where((request) => request.path.startsWith('/api/v1/support-client'))
          .every(
            (request) =>
                request.headers.value('x-superboard-project-id') == '42' &&
                request.headers.value(HttpHeaders.authorizationHeader) ==
                    'Bearer signed-token',
          ),
      isTrue,
    );

    final expectedNativePaths = <String>{
      '/api/v1/support-client/configuration',
      '/api/v1/support-client/conversations',
      '/api/v1/support-client/conversations/conversation-1',
      '/api/v1/support-client/conversations/conversation-1/messages',
      '/api/v1/support-client/conversations/conversation-1/csat',
      '/api/v1/support-client/conversations/conversation-1/attachments',
      '/api/v1/support-client/conversations/conversation-1/attachments/message-1',
      '/api/v1/support-client/conversations/conversation-1/read',
      '/api/v1/support-client/conversations/conversation-1/typing',
      '/api/v1/support-client/conversations/conversation-1/realtime-ticket',
      '/api/v1/support-client/contact',
      '/api/v1/support-client/events',
      '/api/v1/support-client/inboxes/inbox-1/members',
      '/api/v1/support-client/proactive-support',
      '/api/v1/support-client/conversations/conversation-1/labels',
      '/api/v1/support-client/conversations/conversation-1/transcript',
      '/api/v1/support-client/help-center/aide/categories',
      '/api/v1/support-client/help-center/aide/search',
      '/api/v1/support-client/help-center/aide/articles/mon-compte',
      '/api/v1/support-client/help-center/aide/articles/mon-compte/views',
      '/api/v1/support-client/conversations/conversation-1/meetings',
      '/api/v1/support/realtime/ticket-1',
    };
    expect(
      server.requests.map((request) => request.path).toSet(),
      containsAll(expectedNativePaths),
    );

    final replayableMutations = server.requests.where(
      (request) =>
          request.path.startsWith('/api/v1/support-client') &&
          !{'GET', 'HEAD', 'OPTIONS'}.contains(request.method),
    );
    expect(
      replayableMutations.every(
        (request) =>
            (request.headers.value('idempotency-key') ?? '').isNotEmpty,
      ),
      isTrue,
    );
  });
}

class _SupportTestServer {
  _SupportTestServer._(this._server) {
    _subscription = _server.listen(_handle);
  }

  static Future<_SupportTestServer> start() async => _SupportTestServer._(
    await HttpServer.bind(InternetAddress.loopbackIPv4, 0),
  );

  final HttpServer _server;
  final requests = <_ObservedRequest>[];
  final sockets = <WebSocket>[];
  late final StreamSubscription<HttpRequest> _subscription;

  String get origin => 'http://${_server.address.host}:${_server.port}';

  Future<void> close() async {
    for (final socket in sockets) {
      await socket.close();
    }
    await _subscription.cancel();
    await _server.close(force: true);
  }

  Future<void> _handle(HttpRequest request) async {
    requests.add(
      _ObservedRequest(request.method, request.uri.path, request.headers),
    );
    final path = request.uri.path;

    if (path == '/api/v1/support/realtime/ticket-1' &&
        WebSocketTransformer.isUpgradeRequest(request)) {
      sockets.add(await WebSocketTransformer.upgrade(request));
      return;
    }
    if (path == '/auth/opengrow-token') {
      return _json(request.response, {'access_token': 'signed-token'});
    }
    if (request.method == 'GET' &&
        path ==
            '/api/v1/support-client/conversations/conversation-1/attachments/message-1') {
      request.response.statusCode = HttpStatus.ok;
      request.response.add([1, 2, 3]);
      await request.response.close();
      return;
    }
    if (path == '/api/v1/support-client/configuration') {
      return _data(request.response, {'locale': 'fr'});
    }
    if (path == '/api/v1/support-client/conversations') {
      return request.method == 'GET'
          ? _data(request.response, <Object?>[_conversation])
          : _data(request.response, _conversation, status: HttpStatus.created);
    }
    if (path == '/api/v1/support-client/conversations/conversation-1') {
      return _data(request.response, _conversation);
    }
    if (path ==
        '/api/v1/support-client/conversations/conversation-1/messages') {
      return request.method == 'GET'
          ? _data(request.response, <Object?>[_message])
          : _data(request.response, _message, status: HttpStatus.created);
    }
    if (path.endsWith('/csat')) {
      return _data(request.response, {'rating': 5});
    }
    if (path.endsWith('/attachments')) {
      return _json(request.response, {
        'key': 'attachment-key',
        'filename': 'preuve.txt',
        'content_type': 'text/plain',
      });
    }
    if (path.endsWith('/read')) {
      return _data(request.response, {'read_at': '2026-08-13T12:00:00.000Z'});
    }
    if (path.endsWith('/typing')) {
      return _json(request.response, const <String, Object?>{});
    }
    if (path.endsWith('/realtime-ticket')) {
      return _data(request.response, {'ticket': 'ticket-1'});
    }
    if (path == '/api/v1/support-client/contact') {
      return _data(request.response, {
        'id': 'contact-1',
        'name': request.method == 'PATCH' ? 'Ada' : 'Client',
      });
    }
    if (path == '/api/v1/support-client/events') {
      return _data(request.response, {'id': 'event-1'});
    }
    if (path.endsWith('/inboxes/inbox-1/members')) {
      return _data(request.response, <Object?>[
        {'id': 'member-1', 'name': 'Agent'},
      ]);
    }
    if (path == '/api/v1/support-client/proactive-support') {
      return _data(request.response, <Object?>[
        {'id': 'campaign-1'},
      ]);
    }
    if (path.endsWith('/labels')) {
      return _data(request.response, <Object?>[
        {'id': 'label-1', 'name': 'Prioritaire'},
      ]);
    }
    if (path.endsWith('/transcript')) {
      return _data(request.response, {'status': 'queued'});
    }
    if (path.endsWith('/help-center/aide/categories')) {
      return _data(request.response, <Object?>[
        {'id': 'category-1', 'name': 'Compte'},
      ]);
    }
    if (path.endsWith('/help-center/aide/search')) {
      return _data(request.response, <Object?>[_article]);
    }
    if (path.endsWith('/help-center/aide/articles/mon-compte')) {
      return _data(request.response, _article);
    }
    if (path.endsWith('/help-center/aide/articles/mon-compte/views')) {
      return _data(request.response, {'recorded': true});
    }
    if (path.endsWith('/meetings')) {
      return _data(request.response, {'meeting_id': 'meeting-1'});
    }

    request.response.statusCode = HttpStatus.notFound;
    await _json(request.response, {
      'error': {
        'code': 'not_found',
        'message': 'Unknown test route',
        'retryable': false,
        'request_id': 'request-test',
      },
    });
  }

  Future<void> _data(
    HttpResponse response,
    Object? data, {
    int status = HttpStatus.ok,
  }) => _json(response, {'data': data}, status: status);

  Future<void> _json(
    HttpResponse response,
    Object? value, {
    int status = HttpStatus.ok,
  }) async {
    response.statusCode = status;
    response.headers.contentType = ContentType.json;
    response.write(jsonEncode(value));
    await response.close();
  }
}

class _ObservedRequest {
  const _ObservedRequest(this.method, this.path, this.headers);

  final String method;
  final String path;
  final HttpHeaders headers;
}

const _conversation = <String, Object?>{
  'id': 'conversation-1',
  'status': 'open',
  'priority': 'normal',
};

const _message = <String, Object?>{
  'id': 'message-1',
  'conversation_id': 'conversation-1',
  'sender_kind': 'user',
  'sequence': 1,
  'created_at': '2026-08-13T12:00:00.000Z',
  'body': 'Bonjour',
};

const _article = <String, Object?>{
  'id': 'article-1',
  'title': 'Mon compte',
  'slug': 'mon-compte',
  'locale': 'fr',
};
