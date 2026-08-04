import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import 'client.dart';
import 'models.dart';

OpenGrowMessagingClient? _client;

Future<bool> opengrowMessagingInitializeAuthenticated({
  required String applicationAccessToken,
  required int projectId,
  String authGatewayUrl = 'https://api.vocostar.com',
  String messagingUrl = 'https://messages.vocostar.com',
}) async {
  if (applicationAccessToken.trim().isEmpty) {
    throw const OpenGrowMessagingException(
      'identity_required',
      'Application authentication is required before Messaging initialization',
    );
  }
  if (projectId <= 0) {
    throw const OpenGrowMessagingException(
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
      if (error is OpenGrowMessagingException) rethrow;
      throw const OpenGrowMessagingException(
        'identity_gateway_unavailable',
        'The authentication gateway is temporarily unavailable',
        retryable: true,
      );
    }
    Map<String, dynamic> payload;
    try {
      payload = response.body.isEmpty
          ? <String, dynamic>{}
          : decodeObject(response.body);
    } catch (_) {
      throw OpenGrowMessagingException(
        'identity_response_invalid',
        'The authentication gateway returned an invalid response',
        retryable: response.statusCode >= 500,
        statusCode: response.statusCode,
      );
    }
    final identityToken = payload['access_token']?.toString() ?? '';
    if (response.statusCode != 200 || identityToken.isEmpty) {
      throw OpenGrowMessagingException(
        payload['code']?.toString() ?? 'identity_sync_failed',
        payload['message']?.toString() ?? 'Identity synchronization failed',
        retryable: payload['retryable'] == true || response.statusCode >= 500,
        statusCode: response.statusCode,
      );
    }
    return identityToken;
  }

  final initialToken = await tokenProvider();
  _client?.close();
  _client = OpenGrowMessagingClient(
    baseUri: Uri.parse(messagingUrl),
    projectId: projectId,
    identityToken: initialToken,
    identityTokenProvider: tokenProvider,
  );
  return true;
}

Future<String> opengrowMessagingOpenConversation({
  required String clientConversationId,
  String? subject,
}) async {
  final conversation = await _requiredClient.createConversation(
    clientConversationId: clientConversationId,
    subject: subject,
  );
  return conversation.id;
}

Future<String> opengrowMessagingListConversationsJson() async => jsonEncode(
  (await _requiredClient.conversations())
      .map(
        (item) => {
          'id': item.id,
          'status': item.status,
          'priority': item.priority,
          'subject': item.subject,
          'last_message_preview': item.lastMessagePreview,
          'last_message_at': item.lastMessageAt,
        },
      )
      .toList(growable: false),
);

Future<String> opengrowMessagingMessagesJson(
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

Future<String> opengrowMessagingSend({
  required String conversationId,
  required String body,
  required String clientMessageId,
}) async => (await _requiredClient.sendMessage(
  conversationId,
  body: body,
  clientMessageId: clientMessageId,
)).id;

Future<String> opengrowMessagingUploadAttachmentJson({
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

Future<String> opengrowMessagingSendAttachment({
  required String conversationId,
  required String attachmentJson,
  required String clientMessageId,
  String body = '',
}) async {
  final attachment = decodeObject(attachmentJson);
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

Future<String> opengrowMessagingMarkRead(String conversationId) =>
    _requiredClient.markRead(conversationId);

Future<bool> opengrowMessagingSetTyping(
  String conversationId,
  bool active,
) async {
  await _requiredClient.setTyping(conversationId, active);
  return true;
}

OpenGrowMessagingClient get _requiredClient {
  final value = _client;
  if (value == null) {
    throw const OpenGrowMessagingException(
      'not_initialized',
      'Call opengrowMessagingInitializeAuthenticated first',
    );
  }
  return value;
}
