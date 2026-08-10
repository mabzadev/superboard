import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

class OpenGrowApplicationException implements Exception {
  const OpenGrowApplicationException(
    this.code,
    this.message, {
    this.statusCode,
    this.retryable = false,
  });

  final String code;
  final String message;
  final int? statusCode;
  final bool retryable;

  @override
  String toString() => 'OpenGrowApplicationException($code): $message';
}

class OpenGrowApplicationClient {
  OpenGrowApplicationClient({
    required String apiBaseUrl,
    required String filesBaseUrl,
    String applicationAccessToken = '',
    this.projectKey = '',
    this.platform = '',
    this.identifier = '',
    this.environment = 'production',
    http.Client? httpClient,
    this.timeout = const Duration(seconds: 15),
  }) : apiBaseUri = _httpsBase(apiBaseUrl, 'apiBaseUrl'),
       filesBaseUri = _httpsBase(filesBaseUrl, 'filesBaseUrl'),
       _applicationAccessToken = applicationAccessToken.trim(),
       _http = httpClient ?? http.Client();

  final Uri apiBaseUri;
  final Uri filesBaseUri;
  final Duration timeout;
  final String projectKey;
  final String platform;
  final String identifier;
  final String environment;
  final http.Client _http;
  String _applicationAccessToken;
  String _customIdentityToken = '';
  DateTime? _customIdentityTokenExpiresAt;
  Future<String>? _customIdentityRefresh;
  int _identityGeneration = 0;

  String get applicationAccessToken => _applicationAccessToken;
  void setApplicationAccessToken(String value) {
    _applicationAccessToken = value.trim();
    _clearCustomIdentityToken();
  }

  Future<Map<String, dynamic>> register({
    required String email,
    required String password,
    String name = '',
  }) => _session('/auth/register', {
    'email': email,
    'password': password,
    if (name.trim().isNotEmpty) 'name': name.trim(),
  });

  Future<Map<String, dynamic>> signInPassword({
    required String email,
    required String password,
  }) =>
      _session('/auth/signin/password', {'email': email, 'password': password});

  Future<Map<String, dynamic>> signInProvider({
    required String provider,
    required String idToken,
    String name = '',
  }) {
    if (!{'google', 'apple'}.contains(provider)) {
      throw const OpenGrowApplicationException(
        'provider_invalid',
        'Provider must be google or apple.',
      );
    }
    return _session('/auth/signin/$provider', {
      'token': idToken,
      if (name.trim().isNotEmpty) 'name': name.trim(),
    });
  }

  Future<Map<String, dynamic>> linkProvider({
    required String provider,
    required String idToken,
  }) {
    if (!{'google', 'apple'}.contains(provider)) {
      throw const OpenGrowApplicationException(
        'provider_invalid',
        'Provider must be google or apple.',
      );
    }
    return _json(
      'POST',
      apiBaseUri.resolve('/auth/link/$provider'),
      authenticated: true,
      body: {'token': idToken},
    );
  }

  Future<Map<String, dynamic>> signInAnonymous(String installationId) =>
      _session('/auth/anonymous', {'installation_id': installationId});

  Future<Map<String, dynamic>> refresh(String refreshToken) =>
      _session('/auth/refresh', {'refresh_token': refreshToken});

  Future<Map<String, dynamic>> requestPasswordReset(String email) => _json(
    'POST',
    apiBaseUri.resolve('/auth/request-password-reset'),
    body: {'email': email},
  );

  Future<Map<String, dynamic>> resetPassword({
    required String token,
    required String password,
  }) => _json(
    'POST',
    apiBaseUri.resolve('/auth/reset-password'),
    body: {'token': token, 'password': password},
  );

  Future<Map<String, dynamic>> profile() =>
      _json('GET', apiBaseUri.resolve('/auth/me'), authenticated: true);

  Future<Map<String, dynamic>> updateProfile({required String name}) => _json(
    'PATCH',
    apiBaseUri.resolve('/auth/me'),
    authenticated: true,
    body: {'name': name},
  );

  Future<Map<String, dynamic>> logout() async {
    final result = await _json(
      'POST',
      apiBaseUri.resolve('/auth/logout'),
      authenticated: true,
    );
    _applicationAccessToken = '';
    _clearCustomIdentityToken();
    return result;
  }

  Future<Map<String, dynamic>> deleteAccount() async {
    final result = await _json(
      'DELETE',
      apiBaseUri.resolve('/api/v1/sdk/account/v1'),
      authenticated: true,
      headers: _sdkHeaders(),
    );
    _applicationAccessToken = '';
    _clearCustomIdentityToken();
    return result;
  }

  Future<Map<String, dynamic>> marketingPreferences() => _json(
    'GET',
    apiBaseUri.resolve('/api/v1/sdk/marketing/v1/preferences'),
    authenticated: true,
    headers: _sdkHeaders(),
  );

  Future<Map<String, dynamic>> updateMarketingConsent({
    required bool consented,
    required String idempotencyKey,
    Map<String, dynamic> attributes = const {},
    List<String> listIds = const [],
  }) {
    final key = idempotencyKey.trim();
    if (key.isEmpty || key.length > 255) {
      throw const OpenGrowApplicationException(
        'idempotency_key_invalid',
        'A stable Idempotency-Key of at most 255 characters is required.',
      );
    }
    if (listIds.length > 50 || listIds.any((value) => value.trim().isEmpty)) {
      throw const OpenGrowApplicationException(
        'list_ids_invalid',
        'At most 50 non-empty Marketing list identifiers are allowed.',
      );
    }
    return _json(
      'PUT',
      apiBaseUri.resolve('/api/v1/sdk/marketing/v1/preferences'),
      authenticated: true,
      headers: _sdkHeaders()..['idempotency-key'] = key,
      body: {
        'consented': consented,
        'attributes': attributes,
        'list_ids': listIds.map((value) => value.trim()).toSet().toList(),
      },
    );
  }

  Future<Map<String, dynamic>> runtimePolicy({
    required String appVersion,
    String build = '',
  }) {
    final sdkHeaders = _sdkHeaders();
    return _json(
      'POST',
      apiBaseUri.resolve('/api/v1/app/runtime-policy'),
      body: {
        'app_version': appVersion,
        if (build.trim().isNotEmpty) 'build': build.trim(),
      },
      headers: sdkHeaders,
    );
  }

  Future<Map<String, dynamic>> createCustomJob({
    required String capability,
    required Map<String, dynamic> payload,
    required String idempotencyKey,
  }) async {
    final key = idempotencyKey.trim();
    if (key.isEmpty || key.length > 255) {
      throw const OpenGrowApplicationException(
        'idempotency_key_invalid',
        'A stable Idempotency-Key of at most 255 characters is required.',
      );
    }
    final headers = _sdkHeaders()
      ..['idempotency-key'] = key
      ..['authorization'] = 'Bearer ${await _customIdentity()}';
    return _json(
      'POST',
      apiBaseUri.resolve('/api/v1/sdk/custom/v1/jobs'),
      authenticated: true,
      headers: headers,
      body: {'capability': capability.trim(), 'payload': payload},
    );
  }

  Future<Map<String, dynamic>> listCustomJobs({
    int limit = 25,
    String status = '',
    String capability = '',
    String cursor = '',
  }) async {
    if (limit < 1 || limit > 100) {
      throw const OpenGrowApplicationException(
        'limit_invalid',
        'Custom job limit must be between 1 and 100.',
      );
    }
    final uri = apiBaseUri
        .resolve('/api/v1/sdk/custom/v1/jobs')
        .replace(
          queryParameters: {
            'limit': '$limit',
            if (status.trim().isNotEmpty) 'status': status.trim(),
            if (capability.trim().isNotEmpty) 'capability': capability.trim(),
            if (cursor.trim().isNotEmpty) 'cursor': cursor.trim(),
          },
        );
    final headers = _sdkHeaders()
      ..['authorization'] = 'Bearer ${await _customIdentity()}';
    return _json('GET', uri, authenticated: true, headers: headers);
  }

  Future<Map<String, dynamic>> customJob(String jobId) async {
    final id = _customJobId(jobId);
    final headers = _sdkHeaders()
      ..['authorization'] = 'Bearer ${await _customIdentity()}';
    return _json(
      'GET',
      apiBaseUri.resolve(
        '/api/v1/sdk/custom/v1/jobs/${Uri.encodeComponent(id)}',
      ),
      authenticated: true,
      headers: headers,
    );
  }

  Future<Map<String, dynamic>> cancelCustomJob(String jobId) async {
    final id = _customJobId(jobId);
    final headers = _sdkHeaders()
      ..['authorization'] = 'Bearer ${await _customIdentity()}';
    return _json(
      'POST',
      apiBaseUri.resolve(
        '/api/v1/sdk/custom/v1/jobs/${Uri.encodeComponent(id)}/cancel',
      ),
      authenticated: true,
      headers: headers,
    );
  }

  String _customJobId(String value) {
    final id = value.trim();
    if (!RegExp(r'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$').hasMatch(id)) {
      throw const OpenGrowApplicationException(
        'job_id_invalid',
        'The custom job identifier is invalid.',
      );
    }
    return id;
  }

  Future<Map<String, dynamic>> listFiles({int limit = 50, int offset = 0}) =>
      _json(
        'GET',
        filesBaseUri.resolve('/v1/files?limit=$limit&offset=$offset'),
        authenticated: true,
      );

  Future<Map<String, dynamic>> uploadFile({
    required Uint8List bytes,
    required String filename,
    required String contentType,
  }) async {
    final request = http.Request('POST', filesBaseUri.resolve('/v1/files'))
      ..headers.addAll(_headers(authenticated: true))
      ..headers['content-type'] = contentType
      ..headers['x-filename'] = filename
      ..bodyBytes = bytes;
    return _decode(await _http.send(request).timeout(timeout));
  }

  Future<Uint8List> downloadFile(
    String fileId, {
    int maximumBytes = 100 * 1024 * 1024,
  }) async {
    final request = http.Request(
      'GET',
      filesBaseUri.resolve('/v1/files/${Uri.encodeComponent(fileId)}/content'),
    )..headers.addAll(_headers(authenticated: true));
    final response = await _http.send(request).timeout(timeout);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      await _decode(response);
      throw const OpenGrowApplicationException(
        'download_failed',
        'File download failed.',
      );
    }
    final bytes = BytesBuilder(copy: false);
    var total = 0;
    await for (final chunk in response.stream.timeout(timeout)) {
      total += chunk.length;
      if (total > maximumBytes) {
        throw const OpenGrowApplicationException(
          'download_too_large',
          'File download exceeded the configured limit.',
        );
      }
      bytes.add(chunk);
    }
    return bytes.takeBytes();
  }

  Future<Map<String, dynamic>> deleteFile(String fileId) => _json(
    'DELETE',
    filesBaseUri.resolve('/v1/files/${Uri.encodeComponent(fileId)}'),
    authenticated: true,
  );

  Future<Map<String, dynamic>> _session(
    String path,
    Map<String, dynamic> body,
  ) async {
    final result = await _json('POST', apiBaseUri.resolve(path), body: body);
    final accessToken = result['access_token']?.toString() ?? '';
    if (accessToken.isEmpty) {
      throw const OpenGrowApplicationException(
        'identity_response_invalid',
        'Identity response has no access token.',
      );
    }
    _applicationAccessToken = accessToken;
    _clearCustomIdentityToken();
    return result;
  }

  Future<String> _customIdentity() async {
    final now = DateTime.now().toUtc();
    final expiresAt = _customIdentityTokenExpiresAt;
    if (_customIdentityToken.isNotEmpty &&
        expiresAt != null &&
        expiresAt.isAfter(now.add(const Duration(seconds: 10)))) {
      return _customIdentityToken;
    }
    final pending = _customIdentityRefresh;
    if (pending != null) return pending;
    final generation = _identityGeneration;
    late final Future<String> refresh;
    refresh = _refreshCustomIdentity(now, generation).whenComplete(() {
      if (identical(_customIdentityRefresh, refresh)) {
        _customIdentityRefresh = null;
      }
    });
    _customIdentityRefresh = refresh;
    return refresh;
  }

  Future<String> _refreshCustomIdentity(
    DateTime requestedAt,
    int generation,
  ) async {
    final result = await _json(
      'POST',
      apiBaseUri.resolve('/auth/opengrow-token'),
      authenticated: true,
    );
    final token = result['access_token']?.toString() ?? '';
    final expiresIn =
        int.tryParse(result['expires_in']?.toString() ?? '') ?? 300;
    if (token.isEmpty || expiresIn < 1 || expiresIn > 3600) {
      throw const OpenGrowApplicationException(
        'identity_response_invalid',
        'OpenGrow identity exchange returned an invalid token.',
      );
    }
    if (generation != _identityGeneration) {
      throw const OpenGrowApplicationException(
        'identity_session_changed',
        'The application session changed during identity exchange.',
        retryable: true,
      );
    }
    _customIdentityToken = token;
    _customIdentityTokenExpiresAt = requestedAt.add(
      Duration(seconds: expiresIn),
    );
    return token;
  }

  Map<String, String> _sdkHeaders() {
    final normalizedPlatform = platform.trim().toLowerCase();
    final normalizedEnvironment = environment.trim().toLowerCase();
    if (projectKey.trim().isEmpty ||
        identifier.trim().isEmpty ||
        !{'ios', 'android', 'web', 'desktop'}.contains(normalizedPlatform) ||
        !{'production', 'test'}.contains(normalizedEnvironment)) {
      throw const OpenGrowApplicationException(
        'sdk_configuration_required',
        'This operation requires projectKey, platform, identifier and environment.',
      );
    }
    return {
      'PROJECT-KEY': projectKey.trim(),
      'PLATFORM': normalizedPlatform,
      'IDENTIFIER': identifier.trim(),
      'ENVIRONMENT': normalizedEnvironment,
    };
  }

  void _clearCustomIdentityToken() {
    _identityGeneration += 1;
    _customIdentityToken = '';
    _customIdentityTokenExpiresAt = null;
    _customIdentityRefresh = null;
  }

  Future<Map<String, dynamic>> _json(
    String method,
    Uri uri, {
    bool authenticated = false,
    Map<String, dynamic>? body,
    Map<String, String> headers = const {},
  }) async {
    final request = http.Request(method, uri)
      ..headers.addAll(_headers(authenticated: authenticated))
      ..headers.addAll(headers);
    if (body != null) {
      request.headers['content-type'] = 'application/json; charset=utf-8';
      request.body = jsonEncode(body);
    }
    return _decode(await _http.send(request).timeout(timeout));
  }

  Map<String, String> _headers({required bool authenticated}) {
    if (authenticated && _applicationAccessToken.isEmpty) {
      throw const OpenGrowApplicationException(
        'identity_required',
        'Application authentication is required.',
      );
    }
    return {
      'accept': 'application/json',
      if (authenticated) 'authorization': 'Bearer $_applicationAccessToken',
    };
  }

  Future<Map<String, dynamic>> _decode(http.StreamedResponse response) async {
    final bytes = BytesBuilder(copy: false);
    var total = 0;
    await for (final chunk in response.stream.timeout(timeout)) {
      total += chunk.length;
      if (total > 1024 * 1024) {
        throw const OpenGrowApplicationException(
          'response_too_large',
          'OpenGrow response exceeded 1 MiB.',
        );
      }
      bytes.add(chunk);
    }
    final text = utf8.decode(bytes.takeBytes());
    Map<String, dynamic> payload;
    try {
      final decoded = text.isEmpty ? <String, dynamic>{} : jsonDecode(text);
      payload = decoded is Map
          ? decoded.cast<String, dynamic>()
          : {'data': decoded};
    } catch (_) {
      throw OpenGrowApplicationException(
        'response_invalid',
        'OpenGrow returned an invalid response.',
        statusCode: response.statusCode,
        retryable: response.statusCode >= 500,
      );
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final error = payload['error'];
      final details = error is Map
          ? error.cast<Object?, Object?>()
          : const <Object?, Object?>{};
      throw OpenGrowApplicationException(
        details['code']?.toString() ?? 'request_failed',
        details['message']?.toString() ?? 'OpenGrow request failed.',
        statusCode: response.statusCode,
        retryable: details['retryable'] == true || response.statusCode >= 500,
      );
    }
    return payload;
  }

  void close() => _http.close();
}

Uri _httpsBase(String value, String name) {
  final uri = Uri.tryParse(value.trim());
  if (uri == null ||
      uri.scheme != 'https' ||
      uri.host.isEmpty ||
      uri.hasQuery ||
      uri.hasFragment) {
    throw ArgumentError.value(value, name, 'must be an absolute HTTPS origin');
  }
  return uri;
}
