import 'dart:async';
import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'application_client.dart';

abstract interface class OpenGrowApplicationSessionStorage {
  Future<String?> read({required String key});

  Future<void> write({required String key, required String value});

  Future<void> delete({required String key});
}

class FlutterOpenGrowApplicationSessionStorage
    implements OpenGrowApplicationSessionStorage {
  const FlutterOpenGrowApplicationSessionStorage([
    this._storage = const FlutterSecureStorage(),
  ]);

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read({required String key}) => _storage.read(key: key);

  @override
  Future<void> write({required String key, required String value}) =>
      _storage.write(key: key, value: value);

  @override
  Future<void> delete({required String key}) => _storage.delete(key: key);
}

class OpenGrowApplicationSession {
  const OpenGrowApplicationSession({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresAt,
    required this.userId,
    required this.user,
  });

  final String accessToken;
  final String refreshToken;
  final DateTime expiresAt;
  final String userId;
  final Map<String, dynamic> user;

  bool isUsableAt(DateTime instant, Duration refreshLeeway) =>
      accessToken.isNotEmpty && expiresAt.isAfter(instant.add(refreshLeeway));

  Map<String, dynamic> toJson() => {
    'version': 1,
    'access_token': accessToken,
    'refresh_token': refreshToken,
    'expires_at': expiresAt.toUtc().toIso8601String(),
    'user_id': userId,
    'user': user,
  };

  Map<String, dynamic> toClientJson() => {
    'authenticated': true,
    'access_token': accessToken,
    'expires_at': expiresAt.toUtc().toIso8601String(),
    'expires_in': expiresAt.difference(DateTime.now().toUtc()).inSeconds,
    'user_id': userId,
    'user': user,
  };

  static OpenGrowApplicationSession? fromStoredJson(Object? value) {
    if (value is! Map || value['version'] != 1) return null;
    final accessToken = value['access_token']?.toString().trim() ?? '';
    final refreshToken = value['refresh_token']?.toString().trim() ?? '';
    final expiresAt = DateTime.tryParse(value['expires_at']?.toString() ?? '');
    final rawUser = value['user'];
    if (accessToken.isEmpty || refreshToken.isEmpty || expiresAt == null) {
      return null;
    }
    return OpenGrowApplicationSession(
      accessToken: accessToken,
      refreshToken: refreshToken,
      expiresAt: expiresAt.toUtc(),
      userId: value['user_id']?.toString() ?? '',
      user: rawUser is Map ? rawUser.cast<String, dynamic>() : const {},
    );
  }

  static OpenGrowApplicationSession fromResponse(
    Map<String, dynamic> response,
    DateTime instant,
  ) {
    final accessToken = response['access_token']?.toString().trim() ?? '';
    final refreshToken = response['refresh_token']?.toString().trim() ?? '';
    final expiresIn = (response['expires_in'] as num?)?.toInt() ?? 0;
    if (accessToken.isEmpty || refreshToken.isEmpty || expiresIn <= 0) {
      throw const OpenGrowApplicationException(
        'session_invalid',
        'Identity returned an incomplete application session.',
      );
    }
    final rawUser = response['user'];
    return OpenGrowApplicationSession(
      accessToken: accessToken,
      refreshToken: refreshToken,
      expiresAt: instant.toUtc().add(Duration(seconds: expiresIn)),
      userId: response['user_id']?.toString() ?? '',
      user: rawUser is Map ? rawUser.cast<String, dynamic>() : const {},
    );
  }
}

class OpenGrowApplicationSessionManager {
  OpenGrowApplicationSessionManager({
    required this.client,
    required this.storage,
    required this.storageKey,
    DateTime Function()? clock,
    this.refreshLeeway = const Duration(seconds: 30),
  }) : _clock = clock ?? DateTime.now;

  final OpenGrowApplicationClient client;
  final OpenGrowApplicationSessionStorage storage;
  final String storageKey;
  final Duration refreshLeeway;
  final DateTime Function() _clock;
  OpenGrowApplicationSession? _session;
  Future<OpenGrowApplicationSession?>? _restoring;

  OpenGrowApplicationSession? get currentSession => _session;

  static String scopedStorageKey({
    required Uri apiBaseUri,
    required String projectKey,
    required String environment,
  }) {
    final scope = base64Url
        .encode(
          utf8.encode(
            '${apiBaseUri.origin}\u0000${projectKey.trim()}\u0000${environment.trim()}',
          ),
        )
        .replaceAll('=', '');
    return 'opengrow.application_session.v1.$scope';
  }

  Future<OpenGrowApplicationSession?> restore() {
    final inFlight = _restoring;
    if (inFlight != null) return inFlight;
    final operation = _restore();
    _restoring = operation;
    return operation.whenComplete(() {
      if (identical(_restoring, operation)) _restoring = null;
    });
  }

  Future<OpenGrowApplicationSession?> _restore() async {
    final serialized = await storage.read(key: storageKey);
    if (serialized == null || serialized.trim().isEmpty) return null;

    OpenGrowApplicationSession? stored;
    try {
      stored = OpenGrowApplicationSession.fromStoredJson(
        jsonDecode(serialized),
      );
    } on FormatException {
      stored = null;
    }
    if (stored == null) {
      await clear();
      return null;
    }

    _session = stored;
    client.setApplicationAccessToken(stored.accessToken);
    if (stored.isUsableAt(_clock().toUtc(), refreshLeeway)) return stored;

    try {
      return await refresh();
    } on OpenGrowApplicationException catch (error) {
      if (error.statusCode == 401 || error.statusCode == 403) {
        await clear();
        return null;
      }
      rethrow;
    }
  }

  Future<OpenGrowApplicationSession> register({
    required String email,
    required String password,
    String name = '',
  }) async => _adopt(
    await client.register(email: email, password: password, name: name),
  );

  Future<OpenGrowApplicationSession> signInPassword({
    required String email,
    required String password,
  }) async =>
      _adopt(await client.signInPassword(email: email, password: password));

  Future<OpenGrowApplicationSession> signInProvider({
    required String provider,
    required String idToken,
    String name = '',
  }) async => _adopt(
    await client.signInProvider(
      provider: provider,
      idToken: idToken,
      name: name,
    ),
  );

  Future<OpenGrowApplicationSession> signInAnonymous(
    String installationId,
  ) async => _adopt(await client.signInAnonymous(installationId));

  Future<OpenGrowApplicationSession> refresh([String refreshToken = '']) async {
    final token = refreshToken.trim().isNotEmpty
        ? refreshToken.trim()
        : _session?.refreshToken ?? '';
    if (token.isEmpty) {
      throw const OpenGrowApplicationException(
        'refresh_token_missing',
        'No secure application refresh token is available.',
      );
    }
    return _adopt(await client.refresh(token));
  }

  Future<Map<String, dynamic>> logout() async {
    try {
      return await client.logout();
    } finally {
      await clear();
    }
  }

  Future<Map<String, dynamic>> deleteAccount() async {
    try {
      return await client.deleteAccount();
    } finally {
      await clear();
    }
  }

  void setTransientAccessToken(String accessToken) {
    client.setApplicationAccessToken(accessToken);
  }

  Future<void> clear() async {
    _session = null;
    client.setApplicationAccessToken('');
    await storage.delete(key: storageKey);
  }

  Future<OpenGrowApplicationSession> _adopt(
    Map<String, dynamic> response,
  ) async {
    final session = OpenGrowApplicationSession.fromResponse(
      response,
      _clock().toUtc(),
    );
    await storage.write(key: storageKey, value: jsonEncode(session.toJson()));
    _session = session;
    client.setApplicationAccessToken(session.accessToken);
    return session;
  }
}
