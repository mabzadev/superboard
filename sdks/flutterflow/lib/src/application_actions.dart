import 'dart:convert';
import 'dart:typed_data';

import 'application_client.dart';
import 'application_session.dart';

OpenGrowApplicationClient? _applicationClient;
OpenGrowApplicationSessionManager? _applicationSessionManager;
OpenGrowApplicationSessionStorage _applicationSessionStorage =
    const FlutterOpenGrowApplicationSessionStorage();

OpenGrowApplicationClient get _client {
  final value = _applicationClient;
  if (value == null) {
    throw const OpenGrowApplicationException(
      'not_initialized',
      'Call opengrowApplicationInitialize first.',
    );
  }
  return value;
}

OpenGrowApplicationSessionManager get _sessionManager {
  final value = _applicationSessionManager;
  if (value == null) {
    throw const OpenGrowApplicationException(
      'not_initialized',
      'Call opengrowApplicationInitialize first.',
    );
  }
  return value;
}

Future<bool> opengrowApplicationInitialize({
  required String apiBaseUrl,
  required String filesBaseUrl,
  String applicationAccessToken = '',
  String projectKey = '',
  String platform = '',
  String identifier = '',
  String environment = 'production',
  bool restoreSession = true,
}) async {
  _applicationClient?.close();
  final client = OpenGrowApplicationClient(
    apiBaseUrl: apiBaseUrl,
    filesBaseUrl: filesBaseUrl,
    applicationAccessToken: applicationAccessToken,
    projectKey: projectKey,
    platform: platform,
    identifier: identifier,
    environment: environment,
  );
  _applicationClient = client;
  _applicationSessionManager = OpenGrowApplicationSessionManager(
    client: client,
    storage: _applicationSessionStorage,
    storageKey: OpenGrowApplicationSessionManager.scopedStorageKey(
      apiBaseUri: client.apiBaseUri,
      projectKey: projectKey,
      environment: environment,
    ),
  );
  if (restoreSession && applicationAccessToken.trim().isEmpty) {
    await _applicationSessionManager!.restore();
  }
  return true;
}

Future<bool> opengrowApplicationSetAccessToken(
  String applicationAccessToken,
) async {
  _sessionManager.setTransientAccessToken(applicationAccessToken);
  return true;
}

Future<String> opengrowApplicationRegisterJson({
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

Future<String> opengrowApplicationSignInPasswordJson({
  required String email,
  required String password,
}) async => jsonEncode(
  (await _sessionManager.signInPassword(
    email: email,
    password: password,
  )).toClientJson(),
);

Future<String> opengrowApplicationSignInProviderJson({
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

Future<String> opengrowApplicationLinkProviderJson({
  required String provider,
  required String idToken,
}) async => jsonEncode(
  await _client.linkProvider(provider: provider, idToken: idToken),
);

Future<String> opengrowApplicationSignInAnonymousJson(
  String installationId,
) async => jsonEncode(
  (await _sessionManager.signInAnonymous(installationId)).toClientJson(),
);

Future<String> opengrowApplicationRefreshJson([
  String refreshToken = '',
]) async =>
    jsonEncode((await _sessionManager.refresh(refreshToken)).toClientJson());

Future<String> opengrowApplicationRestoreSessionJson() async {
  final session = await _sessionManager.restore();
  return jsonEncode(session?.toClientJson() ?? {'authenticated': false});
}

Future<String> opengrowApplicationCurrentSessionJson() async {
  final session = _sessionManager.currentSession;
  return jsonEncode(session?.toClientJson() ?? {'authenticated': false});
}

Future<String> opengrowApplicationAccessToken() async =>
    _sessionManager.currentSession?.accessToken ??
    _client.applicationAccessToken;

Future<String> opengrowApplicationRequestPasswordResetJson(
  String email,
) async => jsonEncode(await _client.requestPasswordReset(email));

Future<String> opengrowApplicationResetPasswordJson({
  required String token,
  required String password,
}) async =>
    jsonEncode(await _client.resetPassword(token: token, password: password));

Future<String> opengrowApplicationProfileJson() async =>
    jsonEncode(await _client.profile());
Future<String> opengrowApplicationUpdateProfileJson(String name) async =>
    jsonEncode(await _client.updateProfile(name: name));
Future<String> opengrowApplicationLogoutJson() async =>
    jsonEncode(await _sessionManager.logout());
Future<String> opengrowApplicationDeleteAccountJson() async =>
    jsonEncode(await _sessionManager.deleteAccount());
Future<String> opengrowApplicationMarketingPreferencesJson() async =>
    jsonEncode(await _client.marketingPreferences());
Future<String> opengrowApplicationUpdateMarketingConsentJson({
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

Future<String> opengrowApplicationRuntimePolicyJson({
  required String appVersion,
  String build = '',
}) async => jsonEncode(
  await _client.runtimePolicy(appVersion: appVersion, build: build),
);
Future<String> opengrowApplicationListFilesJson({
  int limit = 50,
  int offset = 0,
}) async => jsonEncode(await _client.listFiles(limit: limit, offset: offset));
Future<String> opengrowApplicationUploadFileJson({
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
Future<Uint8List> opengrowApplicationDownloadFile(String fileId) =>
    _client.downloadFile(fileId);
Future<String> opengrowApplicationDeleteFileJson(String fileId) async =>
    jsonEncode(await _client.deleteFile(fileId));

Future<String> opengrowApplicationCreateCustomJobJson({
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

Future<String> opengrowApplicationListCustomJobsJson({
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

Future<String> opengrowApplicationGetCustomJobJson(String jobId) async =>
    jsonEncode(await _client.customJob(jobId));

Future<String> opengrowApplicationCancelCustomJobJson(String jobId) async =>
    jsonEncode(await _client.cancelCustomJob(jobId));

Future<bool> opengrowApplicationDispose() async {
  _applicationClient?.close();
  _applicationClient = null;
  _applicationSessionManager = null;
  return true;
}
