import 'dart:convert';
import 'dart:typed_data';

import 'application_client.dart';
import 'application_session.dart';

SuperBoardApplicationClient? _applicationClient;
SuperBoardApplicationSessionManager? _applicationSessionManager;
SuperBoardApplicationSessionStorage _applicationSessionStorage =
    const FlutterSuperBoardApplicationSessionStorage();

SuperBoardApplicationClient get _client {
  final value = _applicationClient;
  if (value == null) {
    throw const SuperBoardApplicationException(
      'not_initialized',
      'Call superboardApplicationInitialize first.',
    );
  }
  return value;
}

SuperBoardApplicationSessionManager get _sessionManager {
  final value = _applicationSessionManager;
  if (value == null) {
    throw const SuperBoardApplicationException(
      'not_initialized',
      'Call superboardApplicationInitialize first.',
    );
  }
  return value;
}

/// Shares the application client's cached, single-flight SuperBoard identity
/// token with the Purchases and Support no-code actions.
///
/// The source only binds when the application client is initialized against
/// the same authentication gateway and currently holds the access token the
/// action received, so a host passing a token from another session keeps its
/// previous behaviour. Once bound, the token tracks session rotations instead
/// of the access token captured at initialization time.
///
/// Internal: hidden from the public `superboard_flutterflow` library.
class SuperBoardSharedIdentityTokenSource {
  SuperBoardSharedIdentityTokenSource({
    required String authGatewayBaseUrl,
    required String applicationAccessToken,
  }) : _client = _bindableClient(authGatewayBaseUrl, applicationAccessToken);

  final SuperBoardApplicationClient? _client;
  String _lastIssued = '';

  bool get isBound => _client != null;

  /// Returns `null` when no compatible application session is available and
  /// the caller should use its own gateway exchange.
  Future<String?> token() async {
    final client = _client;
    if (client == null ||
        !identical(_applicationClient, client) ||
        client.applicationAccessToken.isEmpty) {
      return null;
    }
    var token = await client.customIdentityToken();
    // The caller only asks again when its current token is expiring or was
    // rejected, so never hand the same token back twice.
    if (token == _lastIssued) {
      token = await client.customIdentityToken(rejectedToken: token);
    }
    _lastIssued = token;
    return token;
  }

  static SuperBoardApplicationClient? _bindableClient(
    String authGatewayBaseUrl,
    String applicationAccessToken,
  ) {
    final client = _applicationClient;
    final accessToken = applicationAccessToken.trim();
    if (client == null ||
        accessToken.isEmpty ||
        client.applicationAccessToken != accessToken) {
      return null;
    }
    final gateway = Uri.tryParse(authGatewayBaseUrl.trim());
    if (gateway == null ||
        !{'http', 'https'}.contains(gateway.scheme) ||
        gateway.host.isEmpty ||
        gateway.origin != client.apiBaseUri.origin) {
      return null;
    }
    return client;
  }
}

Future<bool> superboardApplicationInitialize({
  required String apiBaseUrl,
  required String filesBaseUrl,
  String? customApiBaseUrl,
  String applicationAccessToken = '',
  String projectKey = '',
  String platform = '',
  String identifier = '',
  String environment = 'production',
  bool restoreSession = true,
}) async {
  _applicationClient?.close();
  final client = SuperBoardApplicationClient(
    apiBaseUrl: apiBaseUrl,
    filesBaseUrl: filesBaseUrl,
    customApiBaseUrl: customApiBaseUrl,
    applicationAccessToken: applicationAccessToken,
    projectKey: projectKey,
    platform: platform,
    identifier: identifier,
    environment: environment,
  );
  _applicationClient = client;
  final storageKey = SuperBoardApplicationSessionManager.scopedStorageKey(
    apiBaseUri: client.apiBaseUri,
    projectKey: projectKey,
    environment: environment,
  );
  final legacyStorageKey =
      SuperBoardApplicationSessionManager.legacyScopedStorageKey(
        apiBaseUri: client.apiBaseUri,
        projectKey: projectKey,
        environment: environment,
      );
  _applicationSessionManager = SuperBoardApplicationSessionManager(
    client: client,
    storage: _applicationSessionStorage,
    storageKey: storageKey,
    // The legacy key is only mirrored while its format differs from the
    // current one; identical keys would double every secure-storage write.
    legacyStorageKeys: [if (legacyStorageKey != storageKey) legacyStorageKey],
  );
  if (restoreSession && applicationAccessToken.trim().isEmpty) {
    await _applicationSessionManager!.restore();
  }
  return true;
}

Future<bool> superboardApplicationSetAccessToken(
  String applicationAccessToken,
) async {
  _sessionManager.setTransientAccessToken(applicationAccessToken);
  return true;
}

Future<String> superboardApplicationRegisterJson({
  required String email,
  required String password,
  String name = '',
}) async => jsonEncode(
  (await _sessionManager.register(
    email: email,
    password: password,
    name: name,
  )).toClientJson(),
);

Future<String> superboardApplicationSignInPasswordJson({
  required String email,
  required String password,
}) async => jsonEncode(
  (await _sessionManager.signInPassword(
    email: email,
    password: password,
  )).toClientJson(),
);

Future<String> superboardApplicationSignInProviderJson({
  required String provider,
  required String idToken,
  String name = '',
}) async => jsonEncode(
  (await _sessionManager.signInProvider(
    provider: provider,
    idToken: idToken,
    name: name,
  )).toClientJson(),
);

Future<String> superboardApplicationLinkProviderJson({
  required String provider,
  required String idToken,
}) async => jsonEncode(
  await _client.linkProvider(provider: provider, idToken: idToken),
);

Future<String> superboardApplicationSignInAnonymousJson(
  String installationId,
) async => jsonEncode(
  (await _sessionManager.signInAnonymous(installationId)).toClientJson(),
);

Future<String> superboardApplicationRefreshJson([
  String refreshToken = '',
]) async =>
    jsonEncode((await _sessionManager.refresh(refreshToken)).toClientJson());

Future<String> superboardApplicationRestoreSessionJson() async {
  final session = await _sessionManager.restore();
  return jsonEncode(session?.toClientJson() ?? {'authenticated': false});
}

Future<String> superboardApplicationCurrentSessionJson() async {
  final session = _sessionManager.currentSession;
  return jsonEncode(session?.toClientJson() ?? {'authenticated': false});
}

Future<String> superboardApplicationAccessToken() async =>
    _sessionManager.currentSession?.accessToken ??
    _client.applicationAccessToken;

Future<String> superboardApplicationRequestPasswordResetJson(
  String email,
) async => jsonEncode(await _client.requestPasswordReset(email));

Future<String> superboardApplicationResetPasswordJson({
  required String token,
  required String password,
}) async =>
    jsonEncode(await _client.resetPassword(token: token, password: password));

Future<String> superboardApplicationProfileJson() async =>
    jsonEncode(await _client.profile());
Future<String> superboardApplicationUpdateProfileJson(String name) async =>
    jsonEncode(await _client.updateProfile(name: name));
Future<String> superboardApplicationLogoutJson() async =>
    jsonEncode(await _sessionManager.logout());
Future<String> superboardApplicationDeleteAccountJson() async =>
    jsonEncode(await _sessionManager.deleteAccount());
Future<String> superboardApplicationMarketingPreferencesJson() async =>
    jsonEncode(await _client.marketingPreferences());
Future<String> superboardApplicationUpdateMarketingConsentJson({
  required bool consented,
  required String idempotencyKey,
  String attributesJson = '{}',
  String listIdsJson = '[]',
}) async {
  final attributes = jsonDecode(attributesJson);
  final listIds = jsonDecode(listIdsJson);
  if (attributes is! Map) {
    throw const FormatException('Marketing attributes must be a JSON object.');
  }
  if (listIds is! List) {
    throw const FormatException('Marketing list IDs must be a JSON array.');
  }
  return jsonEncode(
    await _client.updateMarketingConsent(
      consented: consented,
      idempotencyKey: idempotencyKey,
      attributes: attributes.cast<String, dynamic>(),
      listIds: listIds.map((value) => value.toString()).toList(),
    ),
  );
}

Future<String> superboardApplicationRuntimePolicyJson({
  required String appVersion,
  String build = '',
}) async => jsonEncode(
  await _client.runtimePolicy(appVersion: appVersion, build: build),
);
Future<String> superboardApplicationListFilesJson({
  int limit = 50,
  int offset = 0,
}) async => jsonEncode(await _client.listFiles(limit: limit, offset: offset));
Future<String> superboardApplicationUploadFileJson({
  required Uint8List bytes,
  required String filename,
  required String contentType,
}) async => jsonEncode(
  await _client.uploadFile(
    bytes: bytes,
    filename: filename,
    contentType: contentType,
  ),
);
Future<Uint8List> superboardApplicationDownloadFile(String fileId) =>
    _client.downloadFile(fileId);
Future<String> superboardApplicationDeleteFileJson(String fileId) async =>
    jsonEncode(await _client.deleteFile(fileId));

Future<String> superboardApplicationCreateCustomJobJson({
  required String capability,
  required String payloadJson,
  required String idempotencyKey,
}) async {
  final decoded = jsonDecode(payloadJson);
  if (decoded is! Map) {
    throw const FormatException('Custom job payload must be a JSON object.');
  }
  return jsonEncode(
    await _client.createCustomJob(
      capability: capability,
      payload: decoded.cast<String, dynamic>(),
      idempotencyKey: idempotencyKey,
    ),
  );
}

Future<String> superboardApplicationListCustomJobsJson({
  int limit = 25,
  String status = '',
  String capability = '',
  String cursor = '',
}) async => jsonEncode(
  await _client.listCustomJobs(
    limit: limit,
    status: status,
    capability: capability,
    cursor: cursor,
  ),
);

Future<String> superboardApplicationGetCustomJobJson(String jobId) async =>
    jsonEncode(await _client.customJob(jobId));

Future<String> superboardApplicationCancelCustomJobJson(String jobId) async =>
    jsonEncode(await _client.cancelCustomJob(jobId));

Future<bool> superboardApplicationDispose() async {
  _applicationClient?.close();
  _applicationClient = null;
  _applicationSessionManager = null;
  return true;
}
