import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'models.dart';

typedef SuperBoardIdentityTokenProvider = Future<String> Function();

class SuperBoardMessagingException implements Exception {
  const SuperBoardMessagingException(
    this.code,
    this.message, {
    this.retryable = false,
    this.statusCode,
  });

  final String code;
  final String message;
  final bool retryable;
  final int? statusCode;

  @override
  String toString() => 'SuperBoardMessagingException($code, $message)';
}

class SuperBoardMessagingClient {
  SuperBoardMessagingClient({
    required Uri baseUri,
    required int projectId,
    required String identityToken,
    SuperBoardIdentityTokenProvider? identityTokenProvider,
    http.Client? httpClient,
    Duration requestTimeout = const Duration(seconds: 15),
  }) : _baseUri = baseUri,
       _projectId = projectId,
       _identityToken = identityToken,
       _identityTokenProvider = identityTokenProvider,
       _requestTimeout = requestTimeout,
       _http = httpClient ?? http.Client() {
    if (projectId <= 0) {
      throw ArgumentError.value(
        projectId,
        'projectId',
        'Project ID must be positive',
      );
    }
    if (identityToken.trim().isEmpty) {
      throw ArgumentError.value(
        identityToken,
        'identityToken',
        'Identity token cannot be empty',
      );
    }
    if (requestTimeout <= Duration.zero) {
      throw ArgumentError.value(
        requestTimeout,
        'requestTimeout',
        'Request timeout must be positive',
      );
    }
    _identityToken = identityToken.trim();
  }

  final Uri _baseUri;
  final int _projectId;
  String _identityToken;
  final SuperBoardIdentityTokenProvider? _identityTokenProvider;
  final Duration _requestTimeout;
  final http.Client _http;
  Future<String>? _refreshFuture;

  void updateIdentityToken(String value) {
    if (value.trim().isEmpty) {
      throw ArgumentError.value(
        value,
        'value',
        'Identity token cannot be empty',
      );
    }
    _identityToken = value.trim();
  }

  Map<String, String> get _headers => {
    'Authorization': 'Bearer $_identityToken',
    'X-OpenGrow-Project-Id': '$_projectId',
    'Content-Type': 'application/json',
  };

  Future<Map<String, dynamic>> configuration() async {
    final response = await _authorized(
      (headers) => _http.get(_url('/v1/configuration'), headers: headers),
    );
    final payload = _payload(response);
    final data = payload['data'];
    if (data is! Map<String, dynamic>) {
      throw const SuperBoardMessagingException(
        'configuration_response_invalid',
        'Messaging returned an invalid configuration response',
      );
    }
    return data;
  }

  Future<SuperBoardConversation> createConversation({
    required String clientConversationId,
    String? subject,
    String? inboxId,
    Map<String, dynamic>? customAttributes,
  }) async {
    final response = await _authorized(
      (headers) => _http.post(
        _url('/v1/conversations'),
        headers: headers,
        body: jsonEncode({
          'client_conversation_id': clientConversationId,
          if (subject != null) 'subject': subject,
          if (inboxId != null) 'inbox_id': inboxId,
          if (customAttributes != null) 'custom_attributes': customAttributes,
        }),
      ),
    );
    final payload = _payload(response);
    return SuperBoardConversation.fromJson(
      payload['data'] as Map<String, dynamic>,
    );
  }

  Future<List<SuperBoardConversation>> conversations() async {
    final response = await _authorized(
      (headers) => _http.get(_url('/v1/conversations'), headers: headers),
    );
    final payload = _payload(response);
    return (payload['data'] as List<dynamic>? ?? const [])
        .map(
          (item) =>
              SuperBoardConversation.fromJson(item as Map<String, dynamic>),
        )
        .toList(growable: false);
  }

  Future<SuperBoardConversation> updateConversation(
    String conversationId, {
    String? status,
    Map<String, dynamic>? customAttributes,
  }) async {
    final response = await _authorized(
      (headers) => _http.patch(
        _url('/v1/conversations/${Uri.encodeComponent(conversationId)}'),
        headers: headers,
        body: jsonEncode({
          if (status != null) 'status': status,
          if (customAttributes != null) 'custom_attributes': customAttributes,
        }),
      ),
    );
    final payload = _payload(response);
    return SuperBoardConversation.fromJson(
      payload['data'] as Map<String, dynamic>,
    );
  }

  Future<List<SuperBoardMessage>> messages(
    String conversationId, {
    int? beforeSequence,
    int limit = 50,
  }) async {
    final query = <String, String>{'limit': '${limit.clamp(1, 100)}'};
    if (beforeSequence != null) {
      query['before_sequence'] = '$beforeSequence';
    }
    final uri = _url(
      '/v1/conversations/${Uri.encodeComponent(conversationId)}/messages',
    ).replace(queryParameters: query);
    final response = await _authorized(
      (headers) => _http.get(uri, headers: headers),
    );
    final payload = _payload(response);
    return (payload['data'] as List<dynamic>? ?? const [])
        .map((item) => SuperBoardMessage.fromJson(item as Map<String, dynamic>))
        .toList(growable: false);
  }

  Future<SuperBoardMessage> sendMessage(
    String conversationId, {
    required String body,
    required String clientMessageId,
    String contentType = 'text',
    String? replyToMessageId,
    Map<String, dynamic>? metadata,
  }) => _sendMessage(
    conversationId,
    clientMessageId: clientMessageId,
    body: body,
    contentType: contentType,
    replyToMessageId: replyToMessageId,
    metadata: metadata,
  );

  Future<SuperBoardMessage> sendAttachment(
    String conversationId, {
    required String attachmentKey,
    required String attachmentName,
    required String attachmentContentType,
    required String clientMessageId,
    String? body,
  }) => _sendMessage(
    conversationId,
    clientMessageId: clientMessageId,
    body: body,
    attachmentKey: attachmentKey,
    attachmentName: attachmentName,
    attachmentContentType: attachmentContentType,
  );

  Future<SuperBoardMessage> _sendMessage(
    String conversationId, {
    required String clientMessageId,
    String? body,
    String? attachmentKey,
    String? attachmentName,
    String? attachmentContentType,
    String contentType = 'text',
    String? replyToMessageId,
    Map<String, dynamic>? metadata,
  }) async {
    final response = await _authorized(
      (headers) => _http.post(
        _url(
          '/v1/conversations/${Uri.encodeComponent(conversationId)}/messages',
        ),
        headers: headers,
        body: jsonEncode({
          if (body != null && body.isNotEmpty) 'body': body,
          if (attachmentKey != null) 'attachment_key': attachmentKey,
          if (attachmentName != null) 'attachment_name': attachmentName,
          if (attachmentContentType != null)
            'attachment_content_type': attachmentContentType,
          'client_message_id': clientMessageId,
          'content_type': contentType,
          if (replyToMessageId != null) 'reply_to_message_id': replyToMessageId,
          if (metadata != null) 'metadata': metadata,
        }),
      ),
    );
    final payload = _payload(response);
    return SuperBoardMessage.fromJson(payload['data'] as Map<String, dynamic>);
  }

  Future<Map<String, dynamic>> submitCsat(
    String conversationId, {
    required int rating,
    String? feedback,
  }) async {
    final response = await _authorized(
      (headers) => _http.post(
        _url('/v1/conversations/${Uri.encodeComponent(conversationId)}/csat'),
        headers: headers,
        body: jsonEncode({
          'rating': rating,
          if (feedback != null && feedback.trim().isNotEmpty)
            'feedback': feedback.trim(),
        }),
      ),
    );
    return _payload(response)['data'] as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> uploadAttachment(
    String conversationId, {
    required Uint8List bytes,
    required String filename,
    required String contentType,
  }) async {
    if (bytes.isEmpty || bytes.length > maxAttachmentBytes) {
      throw const SuperBoardMessagingException(
        'attachment_invalid',
        'Attachment must contain between 1 byte and 10 MB',
      );
    }
    final response = await _authorized((headers) {
      final attachmentHeaders = Map<String, String>.from(headers)
        ..['Content-Type'] = contentType
        ..['X-Filename'] = filename;
      return _http.post(
        _url(
          '/v1/conversations/${Uri.encodeComponent(conversationId)}/attachments',
        ),
        headers: attachmentHeaders,
        body: bytes,
      );
    });
    return _payload(response);
  }

  Future<Uint8List> downloadAttachment(
    String conversationId,
    String messageId, {
    String? attachmentId,
  }) async {
    final base = _url(
      '/v1/conversations/${Uri.encodeComponent(conversationId)}/attachments/${Uri.encodeComponent(messageId)}',
    );
    final uri = attachmentId == null
        ? base
        : base.replace(queryParameters: {'attachment_id': attachmentId});
    final response = await _authorized(
      (headers) => _http.get(uri, headers: headers),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      _payload(response);
    }
    if (response.bodyBytes.length > maxAttachmentBytes) {
      throw const SuperBoardMessagingException(
        'attachment_response_too_large',
        'Attachment response exceeds 10 MB',
      );
    }
    return response.bodyBytes;
  }

  Future<String> markRead(String conversationId) async {
    final response = await _authorized(
      (headers) => _http.post(
        _url('/v1/conversations/${Uri.encodeComponent(conversationId)}/read'),
        headers: headers,
        body: '{}',
      ),
    );
    return _payload(response)['read_at']?.toString() ?? '';
  }

  Future<void> setTyping(String conversationId, bool active) async {
    final response = await _authorized(
      (headers) => _http.post(
        _url('/v1/conversations/${Uri.encodeComponent(conversationId)}/typing'),
        headers: headers,
        body: jsonEncode({'active': active}),
      ),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      _payload(response);
    }
  }

  Future<WebSocketChannel> connect(String conversationId) async {
    await _refreshIfExpiring();
    try {
      return await _connectWebSocket(conversationId);
    } catch (_) {
      if (_identityTokenProvider == null) rethrow;
      await _refreshIdentityToken();
      return _connectWebSocket(conversationId);
    }
  }

  Future<WebSocketChannel> _connectWebSocket(String conversationId) async {
    final uri = _url(
      '/v1/conversations/${Uri.encodeComponent(conversationId)}/ws',
    ).replace(scheme: _baseUri.scheme == 'https' ? 'wss' : 'ws');
    final channel = IOWebSocketChannel.connect(
      uri,
      headers: {
        'Authorization': 'Bearer $_identityToken',
        'X-OpenGrow-Project-Id': '$_projectId',
      },
      pingInterval: const Duration(seconds: 30),
      connectTimeout: const Duration(seconds: 10),
    );
    try {
      await channel.ready;
      return channel;
    } catch (_) {
      await channel.sink.close();
      rethrow;
    }
  }

  void close() => _http.close();

  Future<http.Response> _authorized(
    Future<http.Response> Function(Map<String, String> headers) request,
  ) async {
    await _refreshIfExpiring();
    var response = await _timedRequest(request);
    if (response.statusCode == 401 && _identityTokenProvider != null) {
      await _refreshIdentityToken();
      response = await _timedRequest(request);
    }
    return response;
  }

  Future<http.Response> _timedRequest(
    Future<http.Response> Function(Map<String, String> headers) request,
  ) async {
    try {
      return await request(_headers).timeout(_requestTimeout);
    } on TimeoutException {
      throw const SuperBoardMessagingException(
        'request_timeout',
        'Messaging request timed out',
        retryable: true,
      );
    } on SuperBoardMessagingException {
      rethrow;
    } catch (_) {
      throw const SuperBoardMessagingException(
        'request_unavailable',
        'Messaging is temporarily unavailable',
        retryable: true,
      );
    }
  }

  Future<void> _refreshIfExpiring() async {
    if (_identityTokenProvider == null) return;
    final expiresAt = _tokenExpiration(_identityToken);
    if (expiresAt != null &&
        expiresAt.isBefore(
          DateTime.now().toUtc().add(const Duration(minutes: 1)),
        )) {
      await _refreshIdentityToken();
    }
  }

  Future<void> _refreshIdentityToken() async {
    final provider = _identityTokenProvider;
    if (provider == null) {
      throw const SuperBoardMessagingException(
        'identity_refresh_unavailable',
        'Identity token refresh is not configured',
      );
    }
    final refresh = _refreshFuture ??= provider();
    try {
      updateIdentityToken(await refresh);
    } finally {
      if (identical(_refreshFuture, refresh)) _refreshFuture = null;
    }
  }

  Uri _url(String path) {
    final base = _baseUri.toString().replaceFirst(RegExp(r'/+$'), '');
    final suffix = path.replaceFirst(RegExp(r'^/+'), '');
    return Uri.parse('$base/$suffix');
  }

  Map<String, dynamic> _payload(http.Response response) {
    Map<String, dynamic> decoded;
    try {
      decoded = response.body.isEmpty
          ? <String, dynamic>{}
          : decodeObject(response.body);
    } catch (_) {
      throw SuperBoardMessagingException(
        'response_invalid',
        'Messaging returned an invalid response',
        retryable: response.statusCode >= 500,
        statusCode: response.statusCode,
      );
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw SuperBoardMessagingException(
        decoded['code'] as String? ?? 'request_failed',
        decoded['message'] as String? ?? 'Messaging request failed',
        retryable: decoded['retryable'] == true,
        statusCode: response.statusCode,
      );
    }
    return decoded;
  }
}

const int maxAttachmentBytes = 10 * 1024 * 1024;

DateTime? _tokenExpiration(String token) {
  final segments = token.split('.');
  if (segments.length != 3) return null;
  try {
    final payload = jsonDecode(
      utf8.decode(base64Url.decode(base64Url.normalize(segments[1]))),
    );
    final seconds = payload is Map ? payload['exp'] : null;
    if (seconds is! num) return null;
    return DateTime.fromMillisecondsSinceEpoch(
      seconds.toInt() * 1000,
      isUtc: true,
    );
  } catch (_) {
    return null;
  }
}
