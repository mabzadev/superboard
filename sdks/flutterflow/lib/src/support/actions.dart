import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import 'client.dart';
import 'models.dart';
import 'realtime.dart';

SuperBoardSupportClient? _client;
SuperBoardSupportRealtime? _realtime;
StreamSubscription<String>? _realtimeSubscription;
final _realtimeEvents = StreamController<String>.broadcast();
String _lastRealtimeEventJson = '';

Stream<String> get superboardMessagingEventJsonStream => _realtimeEvents.stream;

Future<bool> superboardMessagingInitializeAuthenticated({
  required String applicationAccessToken,
  required int projectId,
  required String authGatewayUrl,
  required String messagingUrl,
}) async {
  if (applicationAccessToken.trim().isEmpty) {
    throw const SuperBoardSupportException(
      'identity_required',
      'Application authentication is required before Support initialization',
    );
  }
  if (projectId <= 0) {
    throw const SuperBoardSupportException(
      'project_id_invalid',
      'Project ID must be positive',
    );
  }

  Future<String> tokenProvider() async {
    final base = authGatewayUrl.replaceFirst(RegExp(r'/+$'), '');
    late http.Response response;
    try {
      response = await http
          .post(
            Uri.parse('$base/auth/opengrow-token'),
            headers: {
              'Authorization': 'Bearer ${applicationAccessToken.trim()}',
              'Accept': 'application/json',
            },
          )
          .timeout(const Duration(seconds: 10));
    } catch (error) {
      if (error is SuperBoardSupportException) rethrow;
      throw const SuperBoardSupportException(
        'identity_gateway_unavailable',
        'The authentication gateway is temporarily unavailable',
        retryable: true,
      );
    }
    Map<String, dynamic> payload;
    try {
      payload = response.body.isEmpty
          ? <String, dynamic>{}
          : decodeSupportObject(response.body);
    } catch (_) {
      throw SuperBoardSupportException(
        'identity_response_invalid',
        'The authentication gateway returned an invalid response',
        retryable: response.statusCode >= 500,
        statusCode: response.statusCode,
      );
    }
    final rawError = payload['error'];
    final apiError = rawError is Map
        ? rawError.map((key, value) => MapEntry(key.toString(), value))
        : payload;
    final identityToken = payload['access_token']?.toString() ?? '';
    if (response.statusCode != 200 || identityToken.isEmpty) {
      throw SuperBoardSupportException(
        apiError['code']?.toString() ?? 'identity_sync_failed',
        apiError['message']?.toString() ?? 'Identity synchronization failed',
        retryable: apiError['retryable'] == true || response.statusCode >= 500,
        statusCode: response.statusCode,
        requestId:
            apiError['request_id']?.toString() ??
            response.headers['x-request-id'],
        details: apiError['details'] is Map
            ? (apiError['details'] as Map).map(
                (key, value) => MapEntry(key.toString(), value),
              )
            : null,
      );
    }
    return identityToken;
  }

  final initialToken = await tokenProvider();
  await _realtimeSubscription?.cancel();
  await _realtime?.dispose();
  _client?.close();
  _client = SuperBoardSupportClient(
    baseUri: Uri.parse(messagingUrl),
    projectId: projectId,
    identityToken: initialToken,
    identityTokenProvider: tokenProvider,
  );
  _realtime = SuperBoardSupportRealtime(_client!);
  _realtimeSubscription = _realtime!.events.listen((event) {
    _lastRealtimeEventJson = event;
    _realtimeEvents.add(event);
  });
  return true;
}

Future<String> superboardMessagingOpenConversation({
  required String clientConversationId,
  String? subject,
  String? inboxId,
  String customAttributesJson = '{}',
}) async {
  final customAttributes = decodeSupportObject(customAttributesJson);
  final conversation = await _requiredClient.createConversation(
    clientConversationId: clientConversationId,
    subject: subject,
    inboxId: inboxId,
    customAttributes: customAttributes,
  );
  return conversation.id;
}

Future<String> superboardMessagingGetConfigurationJson() async =>
    jsonEncode(await _requiredClient.configuration());

Future<String> superboardMessagingListConversationsJson() async => jsonEncode(
  (await _requiredClient.conversations())
      .map(
        (item) => {
          'id': item.id,
          'status': item.status,
          'priority': item.priority,
          'unread_count': item.unreadCount,
          'subject': item.subject,
          'inbox_id': item.inboxId,
          'assigned_team_id': item.assignedTeamId,
          'custom_attributes': item.customAttributes,
          'snoozed_until': item.snoozedUntil,
          'last_message_preview': item.lastMessagePreview,
          'last_message_at': item.lastMessageAt,
        },
      )
      .toList(growable: false),
);

Future<String> superboardMessagingUpdateConversationJson({
  required String conversationId,
  String? status,
  String? customAttributesJson,
}) async {
  final conversation = await _requiredClient.updateConversation(
    conversationId,
    status: status,
    customAttributes: customAttributesJson == null
        ? null
        : decodeSupportObject(customAttributesJson),
  );
  return jsonEncode({
    'id': conversation.id,
    'status': conversation.status,
    'priority': conversation.priority,
    'inbox_id': conversation.inboxId,
    'assigned_team_id': conversation.assignedTeamId,
    'custom_attributes': conversation.customAttributes,
    'snoozed_until': conversation.snoozedUntil,
  });
}

Future<String> superboardMessagingMessagesJson(
  String conversationId, {
  int? beforeSequence,
  int limit = 50,
}) async => jsonEncode(
  (await _requiredClient.messages(
    conversationId,
    beforeSequence: beforeSequence,
    limit: limit,
  )).map((item) => item.toJson()).toList(growable: false),
);

Future<String> superboardMessagingSend({
  required String conversationId,
  required String body,
  required String clientMessageId,
}) async => (await _requiredClient.sendMessage(
  conversationId,
  body: body,
  clientMessageId: clientMessageId,
)).id;

Future<String> superboardMessagingSendAdvanced({
  required String conversationId,
  required String body,
  required String clientMessageId,
  String contentType = 'text',
  String? replyToMessageId,
  String metadataJson = '{}',
}) async => (await _requiredClient.sendMessage(
  conversationId,
  body: body,
  clientMessageId: clientMessageId,
  contentType: contentType,
  replyToMessageId: replyToMessageId,
  metadata: decodeSupportObject(metadataJson),
)).id;

Future<String> superboardMessagingSubmitCsatJson({
  required String conversationId,
  required int rating,
  String? feedback,
}) async => jsonEncode(
  await _requiredClient.submitCsat(
    conversationId,
    rating: rating,
    feedback: feedback,
  ),
);

Future<String> superboardMessagingUploadAttachmentJson({
  required String conversationId,
  required Uint8List bytes,
  required String filename,
  required String contentType,
}) async => jsonEncode(
  await _requiredClient.uploadAttachment(
    conversationId,
    bytes: bytes,
    filename: filename,
    contentType: contentType,
  ),
);

Future<Uint8List> superboardMessagingDownloadAttachment({
  required String conversationId,
  required String messageId,
  String? attachmentId,
}) => _requiredClient.downloadAttachment(
  conversationId,
  messageId,
  attachmentId: attachmentId,
);

Future<String> superboardMessagingSendAttachment({
  required String conversationId,
  required String attachmentJson,
  required String clientMessageId,
  String body = '',
}) async {
  final attachment = decodeSupportObject(attachmentJson);
  return (await _requiredClient.sendAttachment(
    conversationId,
    attachmentKey: attachment['key']?.toString() ?? '',
    attachmentName: attachment['filename']?.toString() ?? 'attachment',
    attachmentContentType:
        attachment['content_type']?.toString() ?? 'application/octet-stream',
    clientMessageId: clientMessageId,
    body: body.trim().isEmpty ? null : body.trim(),
  )).id;
}

Future<String> superboardMessagingMarkRead(String conversationId) =>
    _requiredClient.markRead(conversationId);

Future<bool> superboardMessagingSetTyping(
  String conversationId,
  bool active,
) async {
  await _requiredClient.setTyping(conversationId, active);
  return true;
}

Future<bool> superboardMessagingConnectRealtime(String conversationId) async {
  await _requiredRealtime.connect(conversationId);
  return true;
}

Future<bool> superboardMessagingDisconnectRealtime() async {
  await _requiredRealtime.disconnect();
  return true;
}

Future<String> superboardMessagingGetLastRealtimeEventJson() async =>
    _lastRealtimeEventJson;

Future<bool> superboardMessagingDispose() async {
  await _realtimeSubscription?.cancel();
  _realtimeSubscription = null;
  await _realtime?.dispose();
  _realtime = null;
  _client?.close();
  _client = null;
  _lastRealtimeEventJson = '';
  return true;
}

Future<String> superboardSupportGetContactJson() async =>
    jsonEncode((await _requiredClient.contact()).toJson());

Future<String> superboardSupportUpdateContactJson({
  String? name,
  String? email,
  String? phone,
  String customAttributesJson = '{}',
  required String idempotencyKey,
}) async => jsonEncode(
  (await _requiredClient.updateContact(
    name: name,
    email: email,
    phone: phone,
    customAttributes: decodeSupportObject(customAttributesJson),
    idempotencyKey: idempotencyKey,
  )).toJson(),
);

Future<String> superboardSupportTrackEventJson({
  required String name,
  String propertiesJson = '{}',
  required String idempotencyKey,
}) async => jsonEncode(
  await _requiredClient.trackEvent(
    name: name,
    properties: decodeSupportObject(propertiesJson),
    idempotencyKey: idempotencyKey,
  ),
);

Future<String> superboardSupportInboxMembersJson(String inboxId) async =>
    jsonEncode(await _requiredClient.inboxMembers(inboxId));

Future<String> superboardSupportProactiveSupportJson({
  String? cursor,
  int limit = 50,
}) async => jsonEncode(
  await _requiredClient.proactiveSupport(cursor: cursor, limit: limit),
);

Future<String> superboardSupportConversationLabelsJson(
  String conversationId,
) async => jsonEncode(await _requiredClient.conversationLabels(conversationId));

Future<String> superboardSupportRequestTranscriptJson({
  required String conversationId,
  required String idempotencyKey,
}) async => jsonEncode(
  await _requiredClient.requestTranscript(
    conversationId,
    idempotencyKey: idempotencyKey,
  ),
);

Future<String> superboardSupportHelpCenterCategoriesJson({
  required String portalSlug,
  String? locale,
}) async => jsonEncode(
  await _requiredClient.helpCenterCategories(
    portalSlug: portalSlug,
    locale: locale,
  ),
);

Future<String> superboardSupportSearchHelpCenterJson({
  required String portalSlug,
  required String query,
  String? locale,
  int limit = 20,
}) async => jsonEncode(
  (await _requiredClient.searchHelpCenter(
    portalSlug: portalSlug,
    query: query,
    locale: locale,
    limit: limit,
  )).map((article) => article.toJson()).toList(growable: false),
);

Future<String> superboardSupportHelpCenterArticleJson({
  required String portalSlug,
  required String articleSlug,
  String? locale,
}) async => jsonEncode(
  (await _requiredClient.helpCenterArticle(
    portalSlug: portalSlug,
    articleSlug: articleSlug,
    locale: locale,
  )).toJson(),
);

Future<String> superboardSupportRecordHelpCenterViewJson({
  required String portalSlug,
  required String articleSlug,
  required String idempotencyKey,
}) async => jsonEncode(
  await _requiredClient.recordHelpCenterView(
    portalSlug: portalSlug,
    articleSlug: articleSlug,
    idempotencyKey: idempotencyKey,
  ),
);

Future<String> superboardSupportJoinMeetingJson({
  required String conversationId,
  String? meetingId,
  required String idempotencyKey,
}) async => jsonEncode(
  await _requiredClient.joinMeeting(
    conversationId,
    meetingId: meetingId,
    idempotencyKey: idempotencyKey,
  ),
);

SuperBoardSupportClient get _requiredClient {
  final value = _client;
  if (value == null) {
    throw const SuperBoardSupportException(
      'not_initialized',
      'Call superboardSupportInitializeAuthenticated first',
    );
  }
  return value;
}

SuperBoardSupportRealtime get _requiredRealtime {
  final value = _realtime;
  if (value == null) {
    throw const SuperBoardSupportException(
      'not_initialized',
      'Call superboardSupportInitializeAuthenticated first',
    );
  }
  return value;
}
