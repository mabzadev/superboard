import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

typedef SuperBoardDataAccessTokenProvider = Future<String?> Function();

class SuperBoardDataException implements Exception {
  const SuperBoardDataException(
    this.code,
    this.message, {
    this.statusCode,
    this.retryable = false,
    this.requestId,
    this.details,
  });

  final String code;
  final String message;
  final int? statusCode;
  final bool retryable;
  final String? requestId;
  final Map<String, dynamic>? details;

  @override
  String toString() => 'SuperBoardDataException($code, $message)';
}

class SuperBoardDataTransport {
  SuperBoardDataTransport({
    required Uri baseUri,
    required Map<String, String> sdkHeaders,
    required http.Client httpClient,
    required Duration requestTimeout,
    String? accessToken,
    SuperBoardDataAccessTokenProvider? accessTokenProvider,
  }) : _baseUri = baseUri,
       _sdkHeaders = Map.unmodifiable(sdkHeaders),
       _http = httpClient,
       _requestTimeout = requestTimeout,
       _tokens = _AccessTokens(accessToken, accessTokenProvider);

  final Uri _baseUri;
  final Map<String, String> _sdkHeaders;
  final http.Client _http;
  final Duration _requestTimeout;
  final _AccessTokens _tokens;

  void setAccessToken(String? token) => _tokens.set(token);

  Uri uri(Iterable<String> segments, [Map<String, Object>? query]) {
    final path = [
      ..._baseUri.pathSegments.where((segment) => segment.isNotEmpty),
      'v1',
      'data',
      ...segments,
    ];
    return _baseUri.replace(
      pathSegments: path,
      queryParameters: query == null || query.isEmpty ? null : query,
    );
  }

  Future<http.Response> send(
    String method,
    Uri uri, {
    Object? json,
    Uint8List? bytes,
    Map<String, String> headers = const {},
  }) async {
    final token = await _tokens.current();
    var response = await _sendOnce(method, uri, token, json, bytes, headers);
    if (response.statusCode == 401 && token != null && _tokens.refreshable) {
      final refreshed = await _tokens.refresh();
      if (refreshed != null && refreshed != token) {
        response = await _sendOnce(
          method,
          uri,
          refreshed,
          json,
          bytes,
          headers,
        );
      }
    }
    return response;
  }

  Future<Object?> sendJson(
    String method,
    Uri uri, {
    Object? json,
    Uint8List? bytes,
    Map<String, String> headers = const {},
  }) async {
    final response = await send(
      method,
      uri,
      json: json,
      bytes: bytes,
      headers: headers,
    );
    throwIfFailed(response);
    return decodeBody(response);
  }

  Future<http.Response> _sendOnce(
    String method,
    Uri uri,
    String? token,
    Object? json,
    Uint8List? bytes,
    Map<String, String> headers,
  ) async {
    final request = http.Request(method, uri)
      ..headers.addAll(headers)
      ..headers.addAll(_sdkHeaders)
      ..headers['Accept'] = 'application/json';
    if (token != null && token.isNotEmpty) {
      request.headers['Authorization'] = 'Bearer $token';
    }
    if (json != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(json);
    } else if (bytes != null) {
      request.bodyBytes = bytes;
    }
    final sending = _http.send(request);
    try {
      final streamed = await sending.timeout(_requestTimeout);
      return await http.Response.fromStream(streamed).timeout(_requestTimeout);
    } on TimeoutException {
      unawaited(
        sending
            .then((response) => response.stream.drain<void>())
            .catchError((Object _) {}),
      );
      throw const SuperBoardDataException(
        'network_timeout',
        'The SuperBoard request timed out',
        retryable: true,
      );
    } on http.ClientException catch (error) {
      throw SuperBoardDataException(
        'network_error',
        error.message,
        retryable: true,
      );
    }
  }
}

void throwIfFailed(http.Response response) {
  if (response.statusCode >= 200 && response.statusCode < 300) return;
  throw errorFromResponse(response);
}

SuperBoardDataException errorFromResponse(http.Response response) {
  final status = response.statusCode;
  final requestId = response.headers['x-request-id'];
  Object? decoded;
  try {
    decoded = response.body.isEmpty ? null : jsonDecode(response.body);
  } on FormatException {
    decoded = null;
  }
  final error = decoded is Map ? decoded['error'] : null;
  if (error is Map) {
    final details = error['details'];
    return SuperBoardDataException(
      error['code']?.toString() ?? 'http_$status',
      error['message']?.toString() ?? 'HTTP $status',
      statusCode: status,
      retryable: error['retryable'] is bool
          ? error['retryable'] as bool
          : status >= 500,
      requestId: error['request_id']?.toString() ?? requestId,
      details: details is Map ? details.cast<String, dynamic>() : null,
    );
  }
  return SuperBoardDataException(
    'http_$status',
    error is String && error.isNotEmpty ? error : 'HTTP $status',
    statusCode: status,
    retryable: status >= 500 || status == 429,
    requestId: requestId,
  );
}

Object? decodeBody(http.Response response) {
  if (response.body.isEmpty) return null;
  try {
    return jsonDecode(response.body);
  } on FormatException {
    throw SuperBoardDataException(
      'server_response_invalid',
      'SuperBoard returned an invalid response',
      statusCode: response.statusCode,
      retryable: true,
    );
  }
}

Map<String, dynamic> asObject(Object? value) {
  if (value is Map) return value.cast<String, dynamic>();
  throw const SuperBoardDataException(
    'server_response_invalid',
    'SuperBoard returned an unexpected response',
  );
}

List<Map<String, dynamic>> asObjectList(Object? value) {
  if (value is! List) {
    throw const SuperBoardDataException(
      'server_response_invalid',
      'SuperBoard returned an unexpected response',
    );
  }
  return value.map(asObject).toList(growable: false);
}

List<Map<String, dynamic>> itemsOf(Object? value) =>
    asObjectList(asObject(value)['items']);

String? optionalString(Object? value) => value?.toString();

DateTime? optionalDate(Object? value) =>
    value is String ? DateTime.tryParse(value) : null;

class _AccessTokens {
  _AccessTokens(String? token, this._provider) {
    set(token);
  }

  final SuperBoardDataAccessTokenProvider? _provider;
  String? _token;
  DateTime? _expiresAt;
  Future<String?>? _refreshing;

  bool get refreshable => _provider != null;

  void set(String? token) {
    final trimmed = token?.trim();
    _token = trimmed == null || trimmed.isEmpty ? null : trimmed;
    _expiresAt = _jwtExpiration(_token);
  }

  Future<String?> current() async {
    final token = _token;
    final expiresAt = _expiresAt;
    final fresh =
        expiresAt == null ||
        expiresAt.isAfter(
          DateTime.now().toUtc().add(const Duration(seconds: 30)),
        );
    if (_provider == null || (token != null && fresh)) return token;
    return refresh();
  }

  Future<String?> refresh() {
    final provider = _provider;
    if (provider == null) return Future.value(_token);
    final active = _refreshing;
    if (active != null) return active;
    final refreshing = provider().then((value) {
      set(value);
      return _token;
    });
    _refreshing = refreshing;
    return refreshing.whenComplete(() {
      if (identical(_refreshing, refreshing)) _refreshing = null;
    });
  }

  static DateTime? _jwtExpiration(String? token) {
    if (token == null) return null;
    final parts = token.split('.');
    if (parts.length != 3) return null;
    try {
      final payload = jsonDecode(
        utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))),
      );
      final exp = payload is Map ? payload['exp'] : null;
      if (exp is! num || exp <= 0) return null;
      return DateTime.fromMillisecondsSinceEpoch(
        exp.toInt() * 1000,
        isUtc: true,
      );
    } on FormatException {
      return null;
    }
  }
}
