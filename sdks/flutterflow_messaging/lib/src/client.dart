import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'models.dart';

typedef OpenGrowIdentityTokenProvider = Future<String> Function();

class OpenGrowMessagingException implements Exception {
  const OpenGrowMessagingException(
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
  String toString() => 'OpenGrowMessagingException($code, $message)';
}

class OpenGrowMessagingClient {
  OpenGrowMessagingClient({
    required Uri baseUri,
    required int projectId,
    required String identityToken,
    OpenGrowIdentityTokenProvider? identityTokenProvider,
    http.Client? httpClient,
  }) : _baseUri = baseUri,
       _projectId = projectId,
       _identityToken = identityToken,
       _identityTokenProvider = identityTokenProvider,
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
    _identityToken = identityToken.trim();
  }

  final Uri _baseUri;
  final int _projectId;
  String _identityToken;
  final OpenGrowIdentityTokenProvider? _identityTokenProvider;
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

  Future<OpenGrowConversation> createConversation({
    required String clientConversationId,
    String? subject,
  }) async {
    final response = await _authorized(
      (headers) => _http.post(
        _url('/v1/conversations'),
        headers: headers,
        body: jsonEncode({
          'client_conversation_id': clientConversationId,
          if (subject != null) 'subject': subject,
        }),
      ),
    );
    final payload = _payload(response);
    return OpenGrowConversation.fromJson(
      payload['data'] as Map<String, dynamic>,
    );
  }

  Future<List<OpenGrowConversation>> conversations() async {
    final response = await _authorized(
      (headers) => _http.get(_url('/v1/conversations'), headers: headers),
    );
    final payload = _payload(response);
    return (payload['data'] as List<dynamic>? ?? const [])
        .map(
          (item) => OpenGrowConversation.fromJson(item as Map<String, dynamic>),
        )
        .toList(growable: false);
  }

  Future<List<OpenGrowMessage>> messages(
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
        .map((item) => OpenGrowMessage.fromJson(item as Map<String, dynamic>))
        .toList(growable: false);
  }

  Future<OpenGrowMessage> sendMessage(
    String conversationId, {
    required String body,
    required String clientMessageId,
  }) => _sendMessage(
    conversationId,
    clientMessageId: clientMessageId,
    body: body,
  );

  Future<OpenGrowMessage> sendAttachment(
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

  Future<OpenGrowMessage> _sendMessage(
    String conversationId, {
    required String clientMessageId,
    String? body,
    String? attachmentKey,
    String? attachmentName,
    String? attachmentContentType,
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
        }),
      ),
    );
    final payload = _payload(response);
    return OpenGrowMessage.fromJson(payload['data'] as Map<String, dynamic>);
  }

  Future<Map<String, dynamic>> uploadAttachment(
    String conversationId, {
    required Uint8List bytes,
    required String filename,
    required String contentType,
  }) async {
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
    String messageId,
  ) async {
    final response = await _authorized(
      (headers) => _http.get(
        _url(
          '/v1/conversations/${Uri.encodeComponent(conversationId)}/attachments/${Uri.encodeComponent(messageId)}',
        ),
        headers: headers,
      ),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      _payload(response);
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
    final uri = _url(
      '/v1/conversations/${Uri.encodeComponent(conversationId)}/ws',
    ).replace(scheme: _baseUri.scheme == 'https' ? 'wss' : 'ws');
    return IOWebSocketChannel.connect(
      uri,
      headers: {
        'Authorization': 'Bearer $_identityToken',
        'X-OpenGrow-Project-Id': '$_projectId',
      },
    );
  }

  void close() => _http.close();

  Future<http.Response> _authorized(
    Future<http.Response> Function(Map<String, String> headers) request,
  ) async {
    await _refreshIfExpiring();
    var response = await request(_headers);
    if (response.statusCode == 401 && _identityTokenProvider != null) {
      await _refreshIdentityToken();
      response = await request(_headers);
    }
    return response;
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
      throw const OpenGrowMessagingException(
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

  Uri _url(String path) => _baseUri.resolve(path);

  Map<String, dynamic> _payload(http.Response response) {
    Map<String, dynamic> decoded;
    try {
      decoded = response.body.isEmpty
          ? <String, dynamic>{}
          : decodeObject(response.body);
    } catch (_) {
      throw OpenGrowMessagingException(
        'response_invalid',
        'Messaging returned an invalid response',
        retryable: response.statusCode >= 500,
        statusCode: response.statusCode,
      );
    }
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
