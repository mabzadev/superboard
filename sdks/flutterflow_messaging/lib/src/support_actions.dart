import 'dart:typed_data';

import 'actions.dart';

/// Canonical Support names for the FlutterFlow API. The historical Messaging
/// names remain available as compatibility aliases during application cutover.
Stream<String> get opengrowSupportEventJsonStream =>
    opengrowMessagingEventJsonStream;

Future<bool> opengrowSupportInitializeAuthenticated({
  required String applicationAccessToken,
  required int projectId,
  required String authGatewayUrl,
  required String supportUrl,
}) => opengrowMessagingInitializeAuthenticated(
  applicationAccessToken: applicationAccessToken,
  projectId: projectId,
  authGatewayUrl: authGatewayUrl,
  messagingUrl: supportUrl,
);

Future<String> opengrowSupportOpenConversation({
  required String clientConversationId,
  String? subject,
  String? inboxId,
  String customAttributesJson = '{}',
}) => opengrowMessagingOpenConversation(
  clientConversationId: clientConversationId,
  subject: subject,
  inboxId: inboxId,
  customAttributesJson: customAttributesJson,
);

Future<String> opengrowSupportGetConfigurationJson() =>
    opengrowMessagingGetConfigurationJson();

Future<String> opengrowSupportListConversationsJson() =>
    opengrowMessagingListConversationsJson();

Future<String> opengrowSupportUpdateConversationJson({
  required String conversationId,
  String? status,
  String? customAttributesJson,
}) => opengrowMessagingUpdateConversationJson(
  conversationId: conversationId,
  status: status,
  customAttributesJson: customAttributesJson,
);

Future<String> opengrowSupportMessagesJson(
  String conversationId, {
  int? beforeSequence,
  int limit = 50,
}) => opengrowMessagingMessagesJson(
  conversationId,
  beforeSequence: beforeSequence,
  limit: limit,
);

Future<String> opengrowSupportSend({
  required String conversationId,
  required String body,
  required String clientMessageId,
}) => opengrowMessagingSend(
  conversationId: conversationId,
  body: body,
  clientMessageId: clientMessageId,
);

Future<String> opengrowSupportSendAdvanced({
  required String conversationId,
  required String body,
  required String clientMessageId,
  String contentType = 'text',
  String? replyToMessageId,
  String metadataJson = '{}',
}) => opengrowMessagingSendAdvanced(
  conversationId: conversationId,
  body: body,
  clientMessageId: clientMessageId,
  contentType: contentType,
  replyToMessageId: replyToMessageId,
  metadataJson: metadataJson,
);

Future<String> opengrowSupportSubmitCsatJson({
  required String conversationId,
  required int rating,
  String? feedback,
}) => opengrowMessagingSubmitCsatJson(
  conversationId: conversationId,
  rating: rating,
  feedback: feedback,
);

Future<String> opengrowSupportUploadAttachmentJson({
  required String conversationId,
  required Uint8List bytes,
  required String filename,
  required String contentType,
}) => opengrowMessagingUploadAttachmentJson(
  conversationId: conversationId,
  bytes: bytes,
  filename: filename,
  contentType: contentType,
);

Future<Uint8List> opengrowSupportDownloadAttachment({
  required String conversationId,
  required String messageId,
  String? attachmentId,
}) => opengrowMessagingDownloadAttachment(
  conversationId: conversationId,
  messageId: messageId,
  attachmentId: attachmentId,
);

Future<String> opengrowSupportSendAttachment({
  required String conversationId,
  required String attachmentJson,
  required String clientMessageId,
  String body = '',
}) => opengrowMessagingSendAttachment(
  conversationId: conversationId,
  attachmentJson: attachmentJson,
  clientMessageId: clientMessageId,
  body: body,
);

Future<String> opengrowSupportMarkRead(String conversationId) =>
    opengrowMessagingMarkRead(conversationId);

Future<bool> opengrowSupportSetTyping(String conversationId, bool active) =>
    opengrowMessagingSetTyping(conversationId, active);

Future<bool> opengrowSupportConnectRealtime(String conversationId) =>
    opengrowMessagingConnectRealtime(conversationId);

Future<bool> opengrowSupportDisconnectRealtime() =>
    opengrowMessagingDisconnectRealtime();

Future<String> opengrowSupportGetLastRealtimeEventJson() =>
    opengrowMessagingGetLastRealtimeEventJson();

Future<bool> opengrowSupportDispose() => opengrowMessagingDispose();
