import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import 'client.dart';
import 'models.dart';
import 'realtime.dart';

OpenGrowMessagingClient? _client;
OpenGrowMessagingRealtime? _realtime;
StreamSubscription<String>? _realtimeSubscription;
final _realtimeEvents = StreamController<String>.broadcast();
String _lastRealtimeEventJson = '';

Stream<String> get opengrowMessagingEventJsonStream => _realtimeEvents.stream;

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
  await _realtimeSubscription?.cancel();
  await _realtime?.dispose();
  _client?.close();
  _client = OpenGrowMessagingClient(
    baseUri: Uri.parse(messagingUrl),
    projectId: projectId,
    identityToken: initialToken,
    identityTokenProvider: tokenProvider,
  );
  _realtime = OpenGrowMessagingRealtime(_client!);
  _realtimeSubscription = _realtime!.events.listen((event) {
    _lastRealtimeEventJson = event;
    _realtimeEvents.add(event);
  });
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
          'unread_count': item.unreadCount,
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

Future<Uint8List> opengrowMessagingDownloadAttachment({
  required String conversationId,
  required String messageId,
}) => _requiredClient.downloadAttachment(conversationId, messageId);

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

Future<bool> opengrowMessagingConnectRealtime(String conversationId) async {
  await _requiredRealtime.connect(conversationId);
  return true;
}

Future<bool> opengrowMessagingDisconnectRealtime() async {
  await _requiredRealtime.disconnect();
  return true;
}

Future<String> opengrowMessagingGetLastRealtimeEventJson() async =>
    _lastRealtimeEventJson;

Future<bool> opengrowMessagingDispose() async {
  await _realtimeSubscription?.cancel();
  _realtimeSubscription = null;
  await _realtime?.dispose();
  _realtime = null;
  _client?.close();
  _client = null;
  _lastRealtimeEventJson = '';
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

OpenGrowMessagingRealtime get _requiredRealtime {
  final value = _realtime;
  if (value == null) {
    throw const OpenGrowMessagingException(
      'not_initialized',
      'Call opengrowMessagingInitializeAuthenticated first',
    );
  }
  return value;
}
