import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:uuid/uuid.dart';

import 'models.dart';

typedef SuperBoardSupportIdentityTokenProvider = Future<String> Function();

class SuperBoardSupportException implements Exception {
  const SuperBoardSupportException(
    this.code,
    this.message, {
    this.retryable = false,
    this.statusCode,
    this.requestId,
    this.details,
  });

  final String code;
  final String message;
  final bool retryable;
  final int? statusCode;
  final String? requestId;
  final Map<String, dynamic>? details;

  @override
  String toString() => 'SuperBoardSupportException($code, $message)';
}

class SuperBoardSupportClient {
  SuperBoardSupportClient({
    required Uri baseUri,
    required int projectId,
    required String identityToken,
    SuperBoardSupportIdentityTokenProvider? identityTokenProvider,
    http.Client? httpClient,
    Duration requestTimeout = const Duration(seconds: 15),
  }) : this._(
         baseUri: baseUri,
         projectId: projectId,
         identityToken: identityToken,
         identityTokenProvider: identityTokenProvider,
         httpClient: httpClient,
         requestTimeout: requestTimeout,
         pathPrefix: '',
         projectHeader: 'X-SuperBoard-Project-Id',
       );

  SuperBoardSupportClient._({
    required Uri baseUri,
    required int projectId,
    required String identityToken,
    required String pathPrefix,
    required String projectHeader,
    SuperBoardSupportIdentityTokenProvider? identityTokenProvider,
    http.Client? httpClient,
    Duration requestTimeout = const Duration(seconds: 15),
  }) : _baseUri = baseUri,
       _projectId = projectId,
       _identityToken = identityToken,
       _identityTokenProvider = identityTokenProvider,
       _requestTimeout = requestTimeout,
       _pathPrefix = pathPrefix,
       _projectHeader = projectHeader,
       _http = httpClient ?? http.Client() {
    if (!baseUri.hasScheme || !{'http', 'https'}.contains(baseUri.scheme)) {
      throw ArgumentError.value(
        baseUri,
        'baseUri',
        'Support URL must use HTTP or HTTPS',
      );
    }
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
  final SuperBoardSupportIdentityTokenProvider? _identityTokenProvider;
  final Duration _requestTimeout;
  final String _pathPrefix;
  final String _projectHeader;
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

  Map<String, String> _headers({String? idempotencyKey}) => {
    'Authorization': 'Bearer $_identityToken',
    _projectHeader: '$_projectId',
    'Content-Type': 'application/json',
    if (idempotencyKey != null)
      'Idempotency-Key': _boundedIdempotencyKey(idempotencyKey),
  };

  Future<Map<String, dynamic>> configuration() async {
    final response = await _authorized(
      (headers) => _http.get(_url('/configuration'), headers: headers),
    );
    return _dataMap(response, 'configuration_response_invalid');
  }

  Future<SuperBoardConversation> createConversation({
    required String clientConversationId,
    String? subject,
    String? inboxId,
    Map<String, dynamic>? customAttributes,
  }) async {
    final idempotencyKey = _boundedIdempotencyKey(clientConversationId);
    final response = await _authorized(
      (headers) => _http.post(
        _url('/conversations'),
        headers: headers,
        body: jsonEncode({
          'client_conversation_id': clientConversationId,
          if (subject != null) 'subject': subject,
          if (inboxId != null) 'inbox_id': inboxId,
          if (customAttributes != null) 'custom_attributes': customAttributes,
        }),
      ),
      idempotencyKey: idempotencyKey,
    );
    return SuperBoardConversation.fromJson(
      _dataMap(response, 'conversation_response_invalid'),
    );
  }

  Future<List<SuperBoardConversation>> conversations({
    String? cursor,
    int limit = 50,
  }) async {
    final query = <String, String>{'limit': '${limit.clamp(1, 100)}'};
    if (cursor != null && cursor.trim().isNotEmpty) {
      query['cursor'] = _boundedValue(cursor, 'cursor', 512);
    }
    final response = await _authorized(
      (headers) => _http.get(
        _url('/conversations').replace(queryParameters: query),
        headers: headers,
      ),
    );
    return _dataList(
      response,
      'conversations_response_invalid',
    ).map(SuperBoardConversation.fromJson).toList(growable: false);
  }

  Future<SuperBoardConversation> updateConversation(
    String conversationId, {
    String? status,
    Map<String, dynamic>? customAttributes,
    String? idempotencyKey,
  }) async {
    idempotencyKey ??= const Uuid().v4();
    final response = await _authorized(
      (headers) => _http.patch(
        _url('/conversations/${_segment(conversationId)}'),
        headers: headers,
        body: jsonEncode({
          if (status != null) 'status': status,
          if (customAttributes != null) 'custom_attributes': customAttributes,
        }),
      ),
      idempotencyKey: idempotencyKey,
    );
    return SuperBoardConversation.fromJson(
      _dataMap(response, 'conversation_response_invalid'),
    );
  }

  Future<List<SuperBoardMessage>> messages(
    String conversationId, {
    int? beforeSequence,
    String? cursor,
    int limit = 50,
  }) async {
    final query = <String, String>{'limit': '${limit.clamp(1, 100)}'};
    if (beforeSequence != null) query['before_sequence'] = '$beforeSequence';
    if (cursor != null && cursor.trim().isNotEmpty) {
      query['cursor'] = _boundedValue(cursor, 'cursor', 512);
    }
    final uri = _url(
      '/conversations/${_segment(conversationId)}/messages',
    ).replace(queryParameters: query);
    final response = await _authorized(
      (headers) => _http.get(uri, headers: headers),
    );
    return _dataList(
      response,
      'messages_response_invalid',
    ).map(SuperBoardMessage.fromJson).toList(growable: false);
  }

  Future<SuperBoardMessage> sendMessage(
    String conversationId, {
    required String body,
    required String clientMessageId,
    String contentType = 'text',
    String? replyToMessageId,
    Map<String, dynamic>? metadata,
  }) {
    if (utf8.encode(body).length > maxSupportMessageBodyBytes) {
      throw const SuperBoardSupportException(
        'message_body_too_large',
        'Message body exceeds 64 KB',
      );
    }
    return _sendMessage(
      conversationId,
      clientMessageId: clientMessageId,
      body: body,
      contentType: contentType,
      replyToMessageId: replyToMessageId,
      metadata: metadata,
    );
  }

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
    final idempotencyKey = _boundedIdempotencyKey(clientMessageId);
    final response = await _authorized(
      (headers) => _http.post(
        _url('/conversations/${_segment(conversationId)}/messages'),
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
      idempotencyKey: idempotencyKey,
    );
    return SuperBoardMessage.fromJson(
      _dataMap(response, 'message_response_invalid'),
    );
  }

  Future<Map<String, dynamic>> submitCsat(
    String conversationId, {
    required int rating,
    String? feedback,
    String? idempotencyKey,
  }) async {
    if (rating < 1 || rating > 5) {
      throw const SuperBoardSupportException(
        'csat_rating_invalid',
        'CSAT rating must be between 1 and 5',
      );
    }
    idempotencyKey ??= const Uuid().v4();
    final response = await _authorized(
      (headers) => _http.post(
        _url('/conversations/${_segment(conversationId)}/csat'),
        headers: headers,
        body: jsonEncode({
          'rating': rating,
          if (feedback != null && feedback.trim().isNotEmpty)
            'feedback': feedback.trim(),
        }),
      ),
      idempotencyKey: idempotencyKey,
    );
    return _dataMap(response, 'csat_response_invalid');
  }

  Future<Map<String, dynamic>> uploadAttachment(
    String conversationId, {
    required Uint8List bytes,
    required String filename,
    required String contentType,
    String? idempotencyKey,
  }) async {
    if (bytes.isEmpty || bytes.length > maxSupportAttachmentBytes) {
      throw const SuperBoardSupportException(
        'attachment_invalid',
        'Attachment must contain between 1 byte and 10 MB',
      );
    }
    idempotencyKey ??= const Uuid().v4();
    final response = await _authorized((headers) {
      final attachmentHeaders = Map<String, String>.from(headers)
        ..['Content-Type'] = _boundedValue(contentType, 'contentType', 255)
        ..['X-Filename'] = _boundedValue(filename, 'filename', 255);
      return _http.post(
        _url('/conversations/${_segment(conversationId)}/attachments'),
        headers: attachmentHeaders,
        body: bytes,
      );
    }, idempotencyKey: idempotencyKey);
    final payload = _payload(response);
    final data = payload['data'];
    if (data is Map) {
      return data.map((key, value) => MapEntry(key.toString(), value));
    }
    if (payload.containsKey('key') && payload.containsKey('filename')) {
      return payload;
    }
    throw SuperBoardSupportException(
      'attachment_response_invalid',
      'Support returned an invalid attachment response',
      statusCode: response.statusCode,
      requestId: _responseRequestId(response),
    );
  }

  Future<Uint8List> downloadAttachment(
    String conversationId,
    String messageId, {
    String? attachmentId,
  }) async {
    final base = _url(
      '/conversations/${_segment(conversationId)}/attachments/${_segment(messageId)}',
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
    if (response.bodyBytes.length > maxSupportAttachmentBytes) {
      throw const SuperBoardSupportException(
        'attachment_response_too_large',
        'Attachment response exceeds 10 MB',
      );
    }
    return response.bodyBytes;
  }

  Future<String> markRead(String conversationId) async {
    final idempotencyKey = const Uuid().v4();
    final response = await _authorized(
      (headers) => _http.post(
        _url('/conversations/${_segment(conversationId)}/read'),
        headers: headers,
        body: '{}',
      ),
      idempotencyKey: idempotencyKey,
    );
    final payload = _payload(response);
    final data = payload['data'];
    final source = data is Map ? data : payload;
    return source['read_at']?.toString() ?? '';
  }

  Future<void> setTyping(String conversationId, bool active) async {
    final idempotencyKey = const Uuid().v4();
    final response = await _authorized(
      (headers) => _http.post(
        _url('/conversations/${_segment(conversationId)}/typing'),
        headers: headers,
        body: jsonEncode({'active': active}),
      ),
      idempotencyKey: idempotencyKey,
    );
    _payload(response);
  }

  Future<SuperBoardSupportContact> contact() async {
    final response = await _authorized(
      (headers) => _http.get(_url('/contact'), headers: headers),
    );
    return SuperBoardSupportContact.fromJson(
      _dataMap(response, 'contact_response_invalid'),
    );
  }

  Future<SuperBoardSupportContact> updateContact({
    String? name,
    String? email,
    String? phone,
    Map<String, dynamic>? customAttributes,
    required String idempotencyKey,
  }) async {
    final response = await _authorized(
      (headers) => _http.patch(
        _url('/contact'),
        headers: headers,
        body: jsonEncode({
          if (name != null) 'name': name,
          if (email != null) 'email': email,
          if (phone != null) 'phone': phone,
          if (customAttributes != null) 'custom_attributes': customAttributes,
        }),
      ),
      idempotencyKey: idempotencyKey,
    );
    return SuperBoardSupportContact.fromJson(
      _dataMap(response, 'contact_response_invalid'),
    );
  }

  Future<Map<String, dynamic>> trackEvent({
    required String name,
    Map<String, dynamic> properties = const {},
    required String idempotencyKey,
  }) async {
    final response = await _authorized(
      (headers) => _http.post(
        _url('/events'),
        headers: headers,
        body: jsonEncode({
          'name': _boundedValue(name, 'name', 128),
          'properties': properties,
        }),
      ),
      idempotencyKey: idempotencyKey,
    );
    return _dataMap(response, 'event_response_invalid');
  }

  Future<List<Map<String, dynamic>>> inboxMembers(String inboxId) async {
    final response = await _authorized(
      (headers) => _http.get(
        _url('/inboxes/${_segment(inboxId)}/members'),
        headers: headers,
      ),
    );
    return _dataList(response, 'inbox_members_response_invalid');
  }

  Future<List<Map<String, dynamic>>> proactiveSupport({
    String? cursor,
    int limit = 50,
  }) async {
    final query = <String, String>{'limit': '${limit.clamp(1, 100)}'};
    if (cursor != null && cursor.trim().isNotEmpty) query['cursor'] = cursor;
    final response = await _authorized(
      (headers) => _http.get(
        _url('/proactive-support').replace(queryParameters: query),
        headers: headers,
      ),
    );
    return _dataList(response, 'proactive_support_response_invalid');
  }

  Future<List<Map<String, dynamic>>> conversationLabels(
    String conversationId,
  ) async {
    final response = await _authorized(
      (headers) => _http.get(
        _url('/conversations/${_segment(conversationId)}/labels'),
        headers: headers,
      ),
    );
    return _dataList(response, 'labels_response_invalid');
  }

  Future<Map<String, dynamic>> requestTranscript(
    String conversationId, {
    required String idempotencyKey,
  }) async {
    final response = await _authorized(
      (headers) => _http.post(
        _url('/conversations/${_segment(conversationId)}/transcript'),
        headers: headers,
        body: '{}',
      ),
      idempotencyKey: idempotencyKey,
    );
    return _dataMap(response, 'transcript_response_invalid');
  }

  Future<List<Map<String, dynamic>>> helpCenterCategories({
    required String portalSlug,
    String? locale,
  }) async {
    final response = await _authorized(
      (headers) => _http.get(
        _url('/help-center/${_segment(portalSlug)}/categories').replace(
          queryParameters: {
            if (locale != null && locale.trim().isNotEmpty) 'locale': locale,
          },
        ),
        headers: headers,
      ),
    );
    return _dataList(response, 'help_categories_response_invalid');
  }

  Future<List<SuperBoardSupportHelpArticle>> searchHelpCenter({
    required String portalSlug,
    required String query,
    String? locale,
    int limit = 20,
  }) async {
    final response = await _authorized(
      (headers) => _http.get(
        _url('/help-center/${_segment(portalSlug)}/search').replace(
          queryParameters: {
            'q': _boundedValue(query, 'query', 500),
            'limit': '${limit.clamp(1, 100)}',
            if (locale != null && locale.trim().isNotEmpty) 'locale': locale,
          },
        ),
        headers: headers,
      ),
    );
    return _dataList(
      response,
      'help_search_response_invalid',
    ).map(SuperBoardSupportHelpArticle.fromJson).toList(growable: false);
  }

  Future<SuperBoardSupportHelpArticle> helpCenterArticle({
    required String portalSlug,
    required String articleSlug,
    String? locale,
  }) async {
    final response = await _authorized(
      (headers) => _http.get(
        _url(
          '/help-center/${_segment(portalSlug)}/articles/${_segment(articleSlug)}',
        ).replace(
          queryParameters: {
            if (locale != null && locale.trim().isNotEmpty) 'locale': locale,
          },
        ),
        headers: headers,
      ),
    );
    return SuperBoardSupportHelpArticle.fromJson(
      _dataMap(response, 'help_article_response_invalid'),
    );
  }

  Future<Map<String, dynamic>> recordHelpCenterView({
    required String portalSlug,
    required String articleSlug,
    required String idempotencyKey,
  }) async {
    final response = await _authorized(
      (headers) => _http.post(
        _url(
          '/help-center/${_segment(portalSlug)}/articles/${_segment(articleSlug)}/views',
        ),
        headers: headers,
        body: '{}',
      ),
      idempotencyKey: idempotencyKey,
    );
    return _dataMap(response, 'help_view_response_invalid');
  }

  Future<Map<String, dynamic>> joinMeeting(
    String conversationId, {
    String? meetingId,
    required String idempotencyKey,
  }) async {
    final response = await _authorized(
      (headers) => _http.post(
        _url('/conversations/${_segment(conversationId)}/meetings'),
        headers: headers,
        body: jsonEncode({if (meetingId != null) 'meeting_id': meetingId}),
      ),
      idempotencyKey: idempotencyKey,
    );
    return _dataMap(response, 'meeting_response_invalid');
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
    final ticketResponse = await _authorized(
      (headers) => _http.post(
        _url('/conversations/${_segment(conversationId)}/realtime-ticket'),
        headers: headers,
        body: '{}',
      ),
      idempotencyKey: const Uuid().v4(),
    );
    final ticketPayload = _dataMap(
      ticketResponse,
      'realtime_ticket_response_invalid',
    );
    final ticket = _boundedValue(
      ticketPayload['ticket']?.toString() ?? '',
      'realtimeTicket',
      1024,
    );
    final uri = _baseUri.replace(
      scheme: _baseUri.scheme == 'https' ? 'wss' : 'ws',
      path: '/api/v1/support/realtime/${Uri.encodeComponent(ticket)}',
      query: null,
      fragment: null,
    );
    final channel = IOWebSocketChannel.connect(
      uri,
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
    Future<http.Response> Function(Map<String, String> headers) request, {
    String? idempotencyKey,
  }) async {
    await _refreshIfExpiring();
    var response = await _timedRequest(request, idempotencyKey);
    if (response.statusCode == 401 && _identityTokenProvider != null) {
      await _refreshIdentityToken();
      response = await _timedRequest(request, idempotencyKey);
    }
    return response;
  }

  Future<http.Response> _timedRequest(
    Future<http.Response> Function(Map<String, String> headers) request,
    String? idempotencyKey,
  ) async {
    try {
      return await request(
        _headers(idempotencyKey: idempotencyKey),
      ).timeout(_requestTimeout);
    } on TimeoutException {
      throw const SuperBoardSupportException(
        'request_timeout',
        'Support request timed out',
        retryable: true,
      );
    } on SuperBoardSupportException {
      rethrow;
    } catch (_) {
      throw const SuperBoardSupportException(
        'request_unavailable',
        'Support is temporarily unavailable',
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
      throw const SuperBoardSupportException(
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
    final normalizedPrefix = _pathPrefix.replaceAll(RegExp(r'^/+|/+$'), '');
    final suffix = path.replaceFirst(RegExp(r'^/+'), '');
    return Uri.parse(
      [
        base,
        if (normalizedPrefix.isNotEmpty) normalizedPrefix,
        suffix,
      ].join('/'),
    );
  }

  Map<String, dynamic> _payload(http.Response response) {
    Map<String, dynamic> decoded;
    try {
      decoded = response.body.isEmpty
          ? <String, dynamic>{}
          : decodeSupportObject(response.body);
    } catch (_) {
      throw SuperBoardSupportException(
        'response_invalid',
        'Support returned an invalid response',
        retryable: response.statusCode >= 500,
        statusCode: response.statusCode,
        requestId: _responseRequestId(response),
      );
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final nested = decoded['error'];
      final error = nested is Map
          ? nested.map((key, value) => MapEntry(key.toString(), value))
          : decoded;
      final details = error['details'];
      throw SuperBoardSupportException(
        error['code']?.toString() ?? 'request_failed',
        error['message']?.toString() ?? 'Support request failed',
        retryable: error['retryable'] == true || response.statusCode >= 500,
        statusCode: response.statusCode,
        requestId:
            error['request_id']?.toString() ?? _responseRequestId(response),
        details: details is Map
            ? details.map((key, value) => MapEntry(key.toString(), value))
            : null,
      );
    }
    return decoded;
  }

  Map<String, dynamic> _dataMap(http.Response response, String errorCode) {
    final payload = _payload(response);
    final data = payload['data'];
    if (data is Map) {
      return data.map((key, value) => MapEntry(key.toString(), value));
    }
    throw SuperBoardSupportException(
      errorCode,
      'Support returned an invalid response',
      statusCode: response.statusCode,
      requestId:
          (payload['meta'] is Map
                  ? (payload['meta'] as Map)['request_id']
                  : null)
              ?.toString() ??
          _responseRequestId(response),
    );
  }

  List<Map<String, dynamic>> _dataList(
    http.Response response,
    String errorCode,
  ) {
    final payload = _payload(response);
    final data = payload['data'];
    if (data is List) {
      try {
        return data
            .map(
              (item) => (item as Map).map(
                (key, value) => MapEntry(key.toString(), value),
              ),
            )
            .toList(growable: false);
      } catch (_) {
        // The stable error below is more useful than a cast error.
      }
    }
    throw SuperBoardSupportException(
      errorCode,
      'Support returned an invalid response',
      statusCode: response.statusCode,
      requestId: _responseRequestId(response),
    );
  }
}

@Deprecated('Use SuperBoardSupportException.')
typedef SuperBoardMessagingException = SuperBoardSupportException;

@Deprecated(
  'Use SuperBoardSupportClient with the /api/v1/support-client gateway URL.',
)
class SuperBoardMessagingClient extends SuperBoardSupportClient {
  SuperBoardMessagingClient({
    required super.baseUri,
    required super.projectId,
    required super.identityToken,
    super.identityTokenProvider,
    super.httpClient,
    super.requestTimeout = const Duration(seconds: 15),
  }) : super._(pathPrefix: '/v1', projectHeader: 'X-OpenGrow-Project-Id');
}

const int maxSupportAttachmentBytes = 10 * 1024 * 1024;
const int maxSupportMessageBodyBytes = 64 * 1024;

@Deprecated('Use maxSupportAttachmentBytes.')
const int maxAttachmentBytes = maxSupportAttachmentBytes;

String _segment(String value) =>
    Uri.encodeComponent(_boundedValue(value, 'identifier', 255));

String _boundedIdempotencyKey(String value) {
  final normalized = _boundedValue(value, 'idempotencyKey', 200);
  if (!RegExp(r'^[A-Za-z0-9][A-Za-z0-9._:@/-]*$').hasMatch(normalized)) {
    throw const SuperBoardSupportException(
      'idempotency_key_invalid',
      'Idempotency key must contain 1 to 200 supported characters',
    );
  }
  return normalized;
}

String _boundedValue(String value, String field, int maximum) {
  final normalized = value.trim();
  if (normalized.isEmpty || normalized.length > maximum) {
    throw SuperBoardSupportException(
      '${field}_invalid',
      '$field must contain between 1 and $maximum characters',
    );
  }
  return normalized;
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

String? _responseRequestId(http.Response response) {
  for (final entry in response.headers.entries) {
    if (entry.key.toLowerCase() == 'x-request-id') return entry.value;
  }
  return null;
}
