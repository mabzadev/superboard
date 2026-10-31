import 'dart:async';
import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'application_client.dart';

abstract interface class SuperBoardApplicationSessionStorage {
  Future<String?> read({required String key});

  Future<void> write({required String key, required String value});

  Future<void> delete({required String key});
}

class FlutterSuperBoardApplicationSessionStorage
    implements SuperBoardApplicationSessionStorage {
  const FlutterSuperBoardApplicationSessionStorage([
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

class SuperBoardApplicationSession {
  const SuperBoardApplicationSession({
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

  static SuperBoardApplicationSession? fromStoredJson(Object? value) {
    if (value is! Map || value['version'] != 1) return null;
    final accessToken = value['access_token']?.toString().trim() ?? '';
    final refreshToken = value['refresh_token']?.toString().trim() ?? '';
    final expiresAt = DateTime.tryParse(value['expires_at']?.toString() ?? '');
    final rawUser = value['user'];
    if (accessToken.isEmpty || refreshToken.isEmpty || expiresAt == null) {
      return null;
    }
    return SuperBoardApplicationSession(
      accessToken: accessToken,
      refreshToken: refreshToken,
      expiresAt: expiresAt.toUtc(),
      userId: value['user_id']?.toString() ?? '',
      user: rawUser is Map ? rawUser.cast<String, dynamic>() : const {},
    );
  }

  static SuperBoardApplicationSession fromResponse(
    Map<String, dynamic> response,
    DateTime instant,
  ) {
    final accessToken = response['access_token']?.toString().trim() ?? '';
    final refreshToken = response['refresh_token']?.toString().trim() ?? '';
    final expiresIn = (response['expires_in'] as num?)?.toInt() ?? 0;
    if (accessToken.isEmpty || refreshToken.isEmpty || expiresIn <= 0) {
      throw const SuperBoardApplicationException(
        'session_invalid',
        'Identity returned an incomplete application session.',
      );
    }
    final rawUser = response['user'];
    return SuperBoardApplicationSession(
      accessToken: accessToken,
      refreshToken: refreshToken,
      expiresAt: instant.toUtc().add(Duration(seconds: expiresIn)),
      userId: response['user_id']?.toString() ?? '',
      user: rawUser is Map ? rawUser.cast<String, dynamic>() : const {},
    );
  }
}

class SuperBoardApplicationSessionManager {
  SuperBoardApplicationSessionManager({
    required this.client,
    required this.storage,
    required this.storageKey,
    this.legacyStorageKeys = const [],
    DateTime Function()? clock,
    this.refreshLeeway = const Duration(seconds: 30),
  }) : _clock = clock ?? DateTime.now;

  final SuperBoardApplicationClient client;
  final SuperBoardApplicationSessionStorage storage;
  final String storageKey;
  final List<String> legacyStorageKeys;
  final Duration refreshLeeway;
  final DateTime Function() _clock;
  SuperBoardApplicationSession? _session;
  Future<SuperBoardApplicationSession?>? _restoring;
  Future<SuperBoardApplicationSession>? _refreshing;
  String _refreshingToken = '';

  SuperBoardApplicationSession? get currentSession => _session;

  /// Legacy keys that actually differ from [storageKey], deduplicated.
  Iterable<String> get _distinctLegacyKeys =>
      legacyStorageKeys.where((key) => key != storageKey).toSet();

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
    return 'superboard.application_session.v1.$scope';
  }

  /// Previous secure-storage key retained during the v2 -> v3 rollback window.
  ///
  /// The v2 and v3 key formats are identical, so this currently returns the
  /// same value as [scopedStorageKey]. The session manager ignores legacy keys
  /// equal to [storageKey], so passing it in [legacyStorageKeys] never causes
  /// duplicate secure-storage reads, writes or deletes.
  static String legacyScopedStorageKey({
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
    return 'superboard.application_session.v1.$scope';
  }

  Future<SuperBoardApplicationSession?> restore() {
    final inFlight = _restoring;
    if (inFlight != null) return inFlight;
    final operation = _restore();
    _restoring = operation;
    return operation.whenComplete(() {
      if (identical(_restoring, operation)) _restoring = null;
    });
  }

  Future<SuperBoardApplicationSession?> _restore() async {
    var sourceKey = storageKey;
    var serialized = await storage.read(key: sourceKey);
    if (serialized == null || serialized.trim().isEmpty) {
      for (final legacyKey in _distinctLegacyKeys) {
        serialized = await storage.read(key: legacyKey);
        if (serialized != null && serialized.trim().isNotEmpty) {
          sourceKey = legacyKey;
          break;
        }
      }
    }
    if (serialized == null || serialized.trim().isEmpty) return null;

    SuperBoardApplicationSession? stored;
    try {
      stored = SuperBoardApplicationSession.fromStoredJson(
        jsonDecode(serialized),
      );
    } on FormatException {
      stored = null;
    }
    if (stored == null) {
      await storage.delete(key: sourceKey);
      return null;
    }

    if (sourceKey != storageKey) {
      await storage.write(key: storageKey, value: serialized);
    }

    _session = stored;
    client.setApplicationAccessToken(stored.accessToken);
    if (stored.isUsableAt(_clock().toUtc(), refreshLeeway)) return stored;

    try {
      return await refresh();
    } on SuperBoardApplicationException catch (error) {
      if (error.statusCode == 401 || error.statusCode == 403) {
        await clear();
        return null;
      }
      rethrow;
    }
  }

  Future<SuperBoardApplicationSession> register({
    required String email,
    required String password,
    String name = '',
  }) async => _adopt(
    await client.register(email: email, password: password, name: name),
  );

  Future<SuperBoardApplicationSession> signInPassword({
    required String email,
    required String password,
  }) async =>
      _adopt(await client.signInPassword(email: email, password: password));

  Future<SuperBoardApplicationSession> signInProvider({
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

  Future<SuperBoardApplicationSession> signInAnonymous(
    String installationId,
  ) async => _adopt(await client.signInAnonymous(installationId));

  /// Rotates the application session. Concurrent callers refreshing the same
  /// refresh token share one request: refresh tokens are single-use, so a
  /// second parallel rotation would be rejected and could revoke the session.
  Future<SuperBoardApplicationSession> refresh([String refreshToken = '']) {
    final token = refreshToken.trim().isNotEmpty
        ? refreshToken.trim()
        : _session?.refreshToken ?? '';
    if (token.isEmpty) {
      return Future.error(
        const SuperBoardApplicationException(
          'refresh_token_missing',
          'No secure application refresh token is available.',
        ),
      );
    }
    final inFlight = _refreshing;
    if (inFlight != null && _refreshingToken == token) return inFlight;
    late final Future<SuperBoardApplicationSession> operation;
    operation = Future.sync(() async => _adopt(await client.refresh(token)))
        .whenComplete(() {
          if (identical(_refreshing, operation)) {
            _refreshing = null;
            _refreshingToken = '';
          }
        });
    _refreshing = operation;
    _refreshingToken = token;
    return operation;
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
    for (final legacyKey in _distinctLegacyKeys) {
      await storage.delete(key: legacyKey);
    }
  }

  Future<SuperBoardApplicationSession> _adopt(
    Map<String, dynamic> response,
  ) async {
    final session = SuperBoardApplicationSession.fromResponse(
      response,
      _clock().toUtc(),
    );
    final serialized = jsonEncode(session.toJson());
    await storage.write(key: storageKey, value: serialized);
    for (final legacyKey in _distinctLegacyKeys) {
      await storage.write(key: legacyKey, value: serialized);
    }
    _session = session;
    client.setApplicationAccessToken(session.accessToken);
    return session;
  }
}
