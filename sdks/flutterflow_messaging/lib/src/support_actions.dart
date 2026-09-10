import 'dart:typed_data';

import 'actions.dart';

/// Canonical Support names for the FlutterFlow API. The historical Messaging
/// names remain available as compatibility aliases during application cutover.
Stream<String> get superboardSupportEventJsonStream =>
    superboardMessagingEventJsonStream;

Future<bool> superboardSupportInitializeAuthenticated({
  required String applicationAccessToken,
  required int projectId,
  required String authGatewayUrl,
  required String supportUrl,
}) => superboardMessagingInitializeAuthenticated(
  applicationAccessToken: applicationAccessToken,
  projectId: projectId,
  authGatewayUrl: authGatewayUrl,
  messagingUrl: supportUrl,
);

Future<String> superboardSupportOpenConversation({
  required String clientConversationId,
  String? subject,
  String? inboxId,
  String customAttributesJson = '{}',
}) => superboardMessagingOpenConversation(
  clientConversationId: clientConversationId,
  subject: subject,
  inboxId: inboxId,
  customAttributesJson: customAttributesJson,
);

Future<String> superboardSupportGetConfigurationJson() =>
    superboardMessagingGetConfigurationJson();

Future<String> superboardSupportListConversationsJson() =>
    superboardMessagingListConversationsJson();

Future<String> superboardSupportUpdateConversationJson({
  required String conversationId,
  String? status,
  String? customAttributesJson,
}) => superboardMessagingUpdateConversationJson(
  conversationId: conversationId,
  status: status,
  customAttributesJson: customAttributesJson,
);

Future<String> superboardSupportMessagesJson(
  String conversationId, {
  int? beforeSequence,
  int limit = 50,
}) => superboardMessagingMessagesJson(
  conversationId,
  beforeSequence: beforeSequence,
  limit: limit,
);

Future<String> superboardSupportSend({
  required String conversationId,
  required String body,
  required String clientMessageId,
}) => superboardMessagingSend(
  conversationId: conversationId,
  body: body,
  clientMessageId: clientMessageId,
);

Future<String> superboardSupportSendAdvanced({
  required String conversationId,
  required String body,
  required String clientMessageId,
  String contentType = 'text',
  String? replyToMessageId,
  String metadataJson = '{}',
}) => superboardMessagingSendAdvanced(
  conversationId: conversationId,
  body: body,
  clientMessageId: clientMessageId,
  contentType: contentType,
  replyToMessageId: replyToMessageId,
  metadataJson: metadataJson,
);

Future<String> superboardSupportSubmitCsatJson({
  required String conversationId,
  required int rating,
  String? feedback,
}) => superboardMessagingSubmitCsatJson(
  conversationId: conversationId,
  rating: rating,
  feedback: feedback,
);

Future<String> superboardSupportUploadAttachmentJson({
  required String conversationId,
  required Uint8List bytes,
  required String filename,
  required String contentType,
}) => superboardMessagingUploadAttachmentJson(
  conversationId: conversationId,
  bytes: bytes,
  filename: filename,
  contentType: contentType,
);

Future<Uint8List> superboardSupportDownloadAttachment({
  required String conversationId,
  required String messageId,
  String? attachmentId,
}) => superboardMessagingDownloadAttachment(
  conversationId: conversationId,
  messageId: messageId,
  attachmentId: attachmentId,
);

Future<String> superboardSupportSendAttachment({
  required String conversationId,
  required String attachmentJson,
  required String clientMessageId,
  String body = '',
}) => superboardMessagingSendAttachment(
  conversationId: conversationId,
  attachmentJson: attachmentJson,
  clientMessageId: clientMessageId,
  body: body,
);

Future<String> superboardSupportMarkRead(String conversationId) =>
    superboardMessagingMarkRead(conversationId);

Future<bool> superboardSupportSetTyping(String conversationId, bool active) =>
    superboardMessagingSetTyping(conversationId, active);

Future<bool> superboardSupportConnectRealtime(String conversationId) =>
    superboardMessagingConnectRealtime(conversationId);

Future<bool> superboardSupportDisconnectRealtime() =>
    superboardMessagingDisconnectRealtime();

Future<String> superboardSupportGetLastRealtimeEventJson() =>
    superboardMessagingGetLastRealtimeEventJson();

Future<bool> superboardSupportDispose() => superboardMessagingDispose();
