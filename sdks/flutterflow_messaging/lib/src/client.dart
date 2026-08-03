import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'models.dart';

class OpenGrowMessagingException implements Exception {
  const OpenGrowMessagingException(this.code, this.message, {this.retryable = false, this.statusCode});

  final String code;
  final String message;
  final bool retryable;
  final int? statusCode;

  @override
  String toString() => 'OpenGrowMessagingException($code, $message)';
}

class OpenGrowMessagingClient {
  OpenGrowMessagingClient({
    required Uri baseUri,
    required int projectId,
    required String identityToken,
    http.Client? httpClient,
  })  : _baseUri = baseUri,
        _projectId = projectId,
        _identityToken = identityToken,
        _http = httpClient ?? http.Client();

  final Uri _baseUri;
  final int _projectId;
  String _identityToken;
  final http.Client _http;

  void updateIdentityToken(String value) {
    if (value.trim().isEmpty) throw ArgumentError.value(value, 'value', 'Identity token cannot be empty');
    _identityToken = value.trim();
  }

  Map<String, String> get _headers => {
        'Authorization': 'Bearer $_identityToken',
        'X-OpenGrow-Project-Id': '$_projectId',
        'Content-Type': 'application/json',
      };

  Future<OpenGrowConversation> createConversation({required String clientConversationId, String? subject}) async {
    final response = await _http.post(_url('/v1/conversations'), headers: _headers, body: jsonEncode({
      'client_conversation_id': clientConversationId,
      if (subject != null) 'subject': subject,
    }));
    final payload = _payload(response);
    return OpenGrowConversation.fromJson(payload['data'] as Map<String, dynamic>);
  }

  Future<List<OpenGrowConversation>> conversations() async {
    final payload = _payload(await _http.get(_url('/v1/conversations'), headers: _headers));
    return (payload['data'] as List<dynamic>? ?? const [])
        .map((item) => OpenGrowConversation.fromJson(item as Map<String, dynamic>)).toList(growable: false);
  }

  Future<List<OpenGrowMessage>> messages(String conversationId, {int? beforeSequence}) async {
    final query = beforeSequence == null ? '' : '?before_sequence=$beforeSequence';
    final payload = _payload(await _http.get(_url('/v1/conversations/$conversationId/messages$query'), headers: _headers));
    return (payload['data'] as List<dynamic>? ?? const [])
        .map((item) => OpenGrowMessage.fromJson(item as Map<String, dynamic>)).toList(growable: false);
  }

  Future<OpenGrowMessage> sendMessage(String conversationId, {required String body, required String clientMessageId}) async {
    final response = await _http.post(_url('/v1/conversations/$conversationId/messages'), headers: _headers, body: jsonEncode({
      'body': body,
      'client_message_id': clientMessageId,
    }));
    final payload = _payload(response);
    return OpenGrowMessage.fromJson(payload['data'] as Map<String, dynamic>);
  }

  Future<Map<String, dynamic>> uploadAttachment(
    String conversationId, {
    required Uint8List bytes,
    required String filename,
    required String contentType,
  }) async {
    final headers = Map<String, String>.from(_headers)
      ..['Content-Type'] = contentType
      ..['X-Filename'] = filename;
    return _payload(await _http.post(_url('/v1/conversations/$conversationId/attachments'), headers: headers, body: bytes));
  }

  WebSocketChannel connect(String conversationId) {
    final uri = _url('/v1/conversations/$conversationId/ws').replace(scheme: _baseUri.scheme == 'https' ? 'wss' : 'ws');
    return IOWebSocketChannel.connect(uri, headers: {
      'Authorization': 'Bearer $_identityToken',
      'X-OpenGrow-Project-Id': '$_projectId',
    });
  }

  Uri _url(String path) => _baseUri.resolve(path);

  Map<String, dynamic> _payload(http.Response response) {
    final decoded = response.body.isEmpty ? <String, dynamic>{} : decodeObject(response.body);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw OpenGrowMessagingException(
        decoded['code'] as String? ?? 'request_failed',
        decoded['message'] as String? ?? 'Messaging request failed',
        retryable: decoded['retryable'] == true,
        statusCode: response.statusCode,
      );
    }
    return decoded;
  }
}
