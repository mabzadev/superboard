import 'dart:convert';

import 'package:http/http.dart' as http;

import 'client.dart';

OpenGrowMessagingClient? _client;

Future<bool> opengrowMessagingInitializeAuthenticated({
  required String applicationAccessToken,
  int projectId = 11,
  String authGatewayUrl = 'https://api.vocostar.com',
  String messagingUrl = 'https://messages.vocostar.com',
}) async {
  if (applicationAccessToken.trim().isEmpty) return false;
  final response = await http.post(
    Uri.parse('$authGatewayUrl/auth/opengrow-token'),
    headers: {'Authorization': 'Bearer ${applicationAccessToken.trim()}'},
  );
  if (response.statusCode != 200) return false;
  final payload = jsonDecode(response.body) as Map<String, dynamic>;
  final identityToken = payload['access_token'] as String?;
  if (identityToken == null || identityToken.isEmpty) return false;
  _client = OpenGrowMessagingClient(
    baseUri: Uri.parse(messagingUrl),
    projectId: projectId,
    identityToken: identityToken,
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

Future<String> opengrowMessagingMessagesJson(String conversationId) async =>
    jsonEncode(
      (await _requiredClient.messages(conversationId))
          .map(
            (item) => {
              'id': item.id,
              'conversation_id': item.conversationId,
              'sender_kind': item.senderKind,
              'sequence': item.sequence,
              'created_at': item.createdAt,
              'body': item.body,
              'attachment_name': item.attachmentName,
            },
          )
          .toList(growable: false),
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
