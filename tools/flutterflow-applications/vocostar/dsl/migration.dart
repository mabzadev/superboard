library;

import 'dart:collection';

import 'package:flutterflow_ai/flutterflow_ai.dart';
import 'package:flutterflow_ai/src/helpers/api_helpers.dart' as api_helpers;
import 'package:flutterflow_ai/src/helpers/action_block_helpers.dart'
    as action_block_helpers;
import 'package:flutterflow_ai/src/helpers/app_event_helpers.dart'
    as app_event_helpers;
import 'package:flutterflow_ai/src/helpers/custom_code_helpers.dart'
    as custom_code_helpers;
import 'package:flutterflow_ai/src/helpers/data_schema_helpers.dart'
    as data_schema_helpers;
import 'package:flutterflow_ai/src/helpers/pub_dependency_helpers.dart'
    as pub_dependency_helpers;
import 'package:flutterflow_ai/src/helpers/project_helpers.dart'
    as project_helpers;
import 'package:flutterflow_ai/src/helpers/library_value_helpers.dart'
    as library_value_helpers;
import 'package:flutterflow_ai/src/ui/actions.dart' as ui_actions;

/// Brownfield VocoStar cutover from the historical mobile integrations to the
/// common OpenGrow application SDKs.
///
/// The migration deliberately preserves identifiers when renaming actions and
/// state fields. Existing FlutterFlow action graphs therefore continue to
/// point at the same protobuf entities while generated Dart moves to the new
/// names and implementations.
void migrateVocoStarToOpenGrow(
  App app, {
  required String libraryProjectId,
  required String onboardingPageKey,
}) {
  app.raw(
    (project) => migrateVocoStarProject(
      project,
      libraryProjectId: libraryProjectId,
      onboardingPageKey: onboardingPageKey,
    ),
  );
}

void migrateVocoStarProject(
  FFProject project, {
  required String libraryProjectId,
  required String onboardingPageKey,
}) {
  final normalizedLibraryProjectId = libraryProjectId.trim();
  final normalizedOnboardingPageKey = onboardingPageKey.trim();
  if (normalizedLibraryProjectId.isEmpty) {
    throw ArgumentError.value(
      libraryProjectId,
      'libraryProjectId',
      'must not be empty',
    );
  }
  if (normalizedOnboardingPageKey.isEmpty) {
    throw ArgumentError.value(
      onboardingPageKey,
      'onboardingPageKey',
      'must not be empty',
    );
  }
  _ensureSdkDependencies(project);
  _migrateTransientAuthenticationBridge(project);
  _removeLegacySupportState(project);
  _migrateApplicationBootstrap(project);
  _migrateAuthenticationActions(project);
  _migrateAccountLifecycle(project);
  _migrateRuntimePolicyActions(project);
  _migrateNotifications(project);
  _migrateOnboarding(
    project,
    libraryProjectId: normalizedLibraryProjectId,
    onboardingPageKey: normalizedOnboardingPageKey,
  );
  _migrateFileAndJobActions(project);
  _migrateSupport(project);
  _removeUnusedLegacyMediaAction(project);
  _migrateVoiceCloneEndpoint(project);
  _normalizeApiVariables(project);
  _repairLegacyListStructState(project);
}

void _migrateOnboarding(
  FFProject project, {
  required String libraryProjectId,
  required String onboardingPageKey,
}) {
  const legacyPages = [
    'onboard00',
    'onboard01',
    'onboard02',
    'onboard03',
    'onboard04',
    'onboard05',
  ];
  final legacyPageKeys = <String>{
    for (final name in legacyPages)
      if (project_helpers.findPage(project, name: name) case final page?)
        page.node.key,
  };
  final onboardingEvent = app_event_helpers.findAppEvent(
    project,
    name: 'getAppOnBoarding',
  );
  final eventIdentifiers = <String>{
    if (onboardingEvent != null) onboardingEvent.identifier.name,
    if (onboardingEvent != null) onboardingEvent.identifier.key,
  };

  _rewriteProjectMessages(project, (message) {
    if (message is FFActionNode &&
        message.hasAction() &&
        message.action.hasTriggerAppEventAction()) {
      final identifier =
          message.action.triggerAppEventAction.appEventIdentifier;
      if (eventIdentifiers.contains(identifier.name) ||
          eventIdentifiers.contains(identifier.key)) {
        if (!message.hasFollowUpAction()) {
          throw StateError(
            'The legacy onboarding event has no follow-up navigation and '
            'cannot be removed safely.',
          );
        }
        final replacement = message.followUpAction.deepCopy();
        message
          ..clear()
          ..mergeFromMessage(replacement);
      }
    }
    if (message is FFNavigateAction &&
        message.hasPageNodeKeyRef() &&
        legacyPageKeys.contains(message.pageNodeKeyRef.key)) {
      message.pageNodeKeyRef = FFNodeKeyReference(
        key: onboardingPageKey,
        dependencyProjectId: libraryProjectId,
      );
      if (message.hasPassedParameters()) {
        message.passedParameters.widgetClassNodeKeyRef = FFNodeKeyReference(
          key: onboardingPageKey,
          dependencyProjectId: libraryProjectId,
        );
      }
    }
  });

  if (onboardingEvent != null) {
    app_event_helpers.removeAppEvent(project, name: 'getAppOnBoarding');
  }
  if (action_block_helpers.findActionBlock(project, name: 'getAppOnBording') !=
      null) {
    action_block_helpers.removeActionBlock(project, name: 'getAppOnBording');
  }
  for (final name in legacyPages) {
    if (project_helpers.findPage(project, name: name) != null) {
      project_helpers.removePage(project, name: name);
    }
  }
  for (final name in const ['appBoard', 'appQuestions', 'appReponse']) {
    if (data_schema_helpers.findAppStateField(project, name: name) != null) {
      data_schema_helpers.removeAppStateField(project, name: name);
    }
  }
  for (final name in const ['appBoard', 'appQuestions']) {
    if (custom_code_helpers.findCustomFunction(project, name: name) != null) {
      custom_code_helpers.removeCustomFunction(project, name: name);
    }
    if (data_schema_helpers.findDataStruct(project, name: name) != null) {
      data_schema_helpers.removeDataStruct(project, name: name);
    }
  }
  for (final endpointName in const ['Get App Board', 'get App Questions']) {
    if (api_helpers.findApiEndpoint(
          project,
          name: endpointName,
          groupName: 'Vocostar API Gateway',
        ) !=
        null) {
      api_helpers.removeEndpointFromGroup(
        project,
        groupName: 'Vocostar API Gateway',
        endpointName: endpointName,
      );
    }
  }
  library_value_helpers.setLibraryPageRoute(
    project,
    libraryProjectId: libraryProjectId,
    pageKey: onboardingPageKey,
    routePath: '/opengrow-onboarding',
  );
}

void _rewriteProjectMessages(
  GeneratedMessage message,
  void Function(GeneratedMessage message) rewrite,
) {
  final visited = HashSet<GeneratedMessage>.identity();

  void visit(GeneratedMessage current) {
    if (!visited.add(current)) return;
    rewrite(current);
    for (final field in current.info_.fieldInfo.values) {
      final value = current.getField(field.tagNumber);
      if (value is GeneratedMessage) {
        visit(value);
      } else if (value is Iterable) {
        for (final item in value.toList(growable: false)) {
          if (item is GeneratedMessage) {
            visit(item);
          }
        }
      } else if (value is Map) {
        for (final item in value.values.toList(growable: false)) {
          if (item is GeneratedMessage) {
            visit(item);
          }
        }
      }
    }
  }

  visit(message);
}

void _ensureSdkDependencies(FFProject project) {
  _ensureDependency(
    project,
    name: 'opengrow_flutterflow',
    version:
        r'''
git:
  url: https://github.com/mbzadev/opengrow-platform.git
  ref: sdk-flutterflow-v2.2.5
  path: sdks/flutterflow
'''.trim(),
  );
  _ensureDependency(
    project,
    name: 'opengrow_flutterflow_messaging',
    version:
        r'''
git:
  url: https://github.com/mbzadev/opengrow-platform.git
  ref: sdk-flutterflow-messaging-v1.3.0
  path: sdks/flutterflow_messaging
'''.trim(),
  );
}

void _ensureDependency(
  FFProject project, {
  required String name,
  required String version,
}) {
  if (pub_dependency_helpers.findPubDependency(project, name: name) == null) {
    pub_dependency_helpers.addPubDependency(
      project,
      name: name,
      version: version,
    );
  } else {
    pub_dependency_helpers.updatePubDependency(
      project,
      name: name,
      newVersion: version,
    );
  }
}

void _migrateTransientAuthenticationBridge(FFProject project) {
  _renameTransientState(
    project,
    oldName: 'authAccessToken',
    newName: 'opengrowAccessTokenTransient',
  );
  _renameTransientState(
    project,
    oldName: 'authRefreshToken',
    newName: 'opengrowRefreshTokenUnavailable',
    clearDefault: true,
  );
  _renameTransientState(
    project,
    oldName: 'authExpiresIn',
    newName: 'opengrowTokenExpirationTransient',
  );
  data_schema_helpers.setSecurePersistedValues(project, enabled: true);
}

void _renameTransientState(
  FFProject project, {
  required String oldName,
  required String newName,
  bool clearDefault = false,
}) {
  final existing = data_schema_helpers.findAppStateField(
    project,
    name: oldName,
  );
  final alreadyMigrated = data_schema_helpers.findAppStateField(
    project,
    name: newName,
  );
  final field = existing ?? alreadyMigrated;
  if (field == null) return;
  field.parameter.identifier.name = newName;
  field.persisted = false;
  if (clearDefault) field.serializedDefaultValue.clear();
}

void _removeLegacySupportState(FFProject project) {
  for (final name in const [
    'supportContactId',
    'supportConversationId',
    'supportMessages',
    'supportPubsubToken',
    'supportUnreadCount',
  ]) {
    if (data_schema_helpers.findAppStateField(project, name: name) != null) {
      data_schema_helpers.removeAppStateField(project, name: name);
    }
  }
  for (final name in const ['appSupportMessages', 'supportMessages']) {
    if (data_schema_helpers.findDataStruct(project, name: name) != null) {
      data_schema_helpers.removeDataStruct(project, name: name);
    }
  }
}

void _migrateApplicationBootstrap(FFProject project) {
  _replaceAction(
    project,
    oldName: 'initApp',
    code: _initAppCode,
    description:
        'Initializes OpenGrow, restores its encrypted session and bridges only the ephemeral access token into FlutterFlow custom auth.',
  );
}

void _migrateAuthenticationActions(FFProject project) {
  _replaceAction(
    project,
    oldName: 'userAuthenticate',
    code: _userAuthenticateCode,
    description:
        'Restores or creates the secure OpenGrow application session and refreshes the VocoStar profile.',
  );
  _replaceAction(
    project,
    oldName: 'userRefreshAuth',
    code: _userRefreshAuthCode,
    description:
        'Rotates the refresh token in encrypted SDK storage and updates the ephemeral FlutterFlow bridge.',
  );
  _replaceAction(
    project,
    oldName: 'signlinkWithGoogle',
    code: _googleProviderCode,
    description:
        'Signs in with or links Google through the common OpenGrow Identity authority.',
  );
  _replaceAction(
    project,
    oldName: 'signlinkWithApple',
    code: _appleProviderCode,
    description:
        'Signs in with or links Apple through the common OpenGrow Identity authority.',
  );
}

void _migrateAccountLifecycle(FFProject project) {
  final logoutAction = _upsertAction(
    project,
    name: 'opengrowLogoutSession',
    code: _logoutSessionCode,
    description:
        'Revokes the common OpenGrow session, disconnects Purchases and clears every transient FlutterFlow authentication bridge.',
  );
  _replaceAction(
    project,
    oldName: 'userCleanManager',
    code: _userCleanManagerCode,
    description:
        'Deletes an account through the durable common OpenGrow erasure workflow while temporarily preserving the app-specific media and vocal cleanup adapters.',
  );

  final legacyLogout = api_helpers.findApiEndpoint(
    project,
    name: 'auth Logout',
    groupName: 'Vocostar API Gateway',
  );
  if (legacyLogout == null) return;
  final legacyIdentifiers = <String>{
    legacyLogout.identifier.name,
    legacyLogout.identifier.key,
  };

  _rewriteProjectMessages(project, (message) {
    if (message is! FFActionNode ||
        !message.hasAction() ||
        !message.action.hasDatabase() ||
        !message.action.database.hasApiCall()) {
      return;
    }
    final identifier = message.action.database.apiCall.endpointIdentifier;
    if (!legacyIdentifiers.contains(identifier.name) &&
        !legacyIdentifiers.contains(identifier.key)) {
      return;
    }
    message.action
      ..clearAction()
      ..customCodeCall =
          ui_actions.Actions.callCustomAction(
            identifier: logoutAction.identifier.deepCopy(),
            setStateAfter: true,
          ).customCodeCall;
  });

  var stillReferenced = false;
  _rewriteProjectMessages(project, (message) {
    if (message is FFActionNode &&
        message.hasAction() &&
        message.action.hasDatabase() &&
        message.action.database.hasApiCall()) {
      final identifier = message.action.database.apiCall.endpointIdentifier;
      stillReferenced =
          stillReferenced ||
          legacyIdentifiers.contains(identifier.name) ||
          legacyIdentifiers.contains(identifier.key);
    }
  });
  if (stillReferenced) {
    throw StateError(
      'The legacy auth Logout endpoint is still referenced and cannot be '
      'removed safely.',
    );
  }
  api_helpers.removeEndpointFromGroup(
    project,
    groupName: 'Vocostar API Gateway',
    endpointName: 'auth Logout',
  );
}

void _migrateRuntimePolicyActions(FFProject project) {
  _replaceAction(
    project,
    oldName: 'appCheckMaintenance',
    code: _maintenancePolicyCode,
    description:
        'Reads the target-managed maintenance policy through OpenGrow.',
  );
  _replaceAction(
    project,
    oldName: 'appCheckUpdate',
    code: _updatePolicyCode,
    description:
        'Reads the target-managed minimum-version policy through OpenGrow.',
  );
}

void _migrateNotifications(FFProject project) {
  _renameTransientState(
    project,
    oldName: 'userFcmToken',
    newName: 'opengrowPushTokenTransient',
  );
  _replaceAction(
    project,
    oldName: 'userFCMToken',
    newName: 'opengrowRegisterPushDevice',
    code: _registerPushDeviceCode,
    description:
        'Requests notification permission and registers the device through the authenticated common OpenGrow notification contract.',
  );
}

void _migrateFileAndJobActions(FFProject project) {
  _replaceAction(
    project,
    oldName: 'userMediaUpload',
    newName: 'opengrowApplicationUploadFileJson',
    code: _uploadFileAdapterCode,
    description:
        'Uploads a local file through the common Files authority and returns only its opaque owner-scoped file ID to the legacy page graph.',
  );
  _replaceAction(
    project,
    oldName: 'userMediaConverter',
    newName: 'opengrowApplicationCreateCustomJobJson',
    code: _customJobAdapterCode,
    description:
        'Creates a VocoStar conversion job through the authenticated common Custom Worker gateway.',
  );
}

void _migrateSupport(FFProject project) {
  _replaceAction(
    project,
    oldName: 'supportInit',
    newName: 'opengrowSupportInitializeAuthenticated',
    code: _supportInitializeCode,
    description:
        'Initializes project-scoped Support using the encrypted OpenGrow application session.',
  );
  _replaceAction(
    project,
    oldName: 'supportFetchMessages',
    newName: 'opengrowSupportRefreshMessages',
    code: _supportRefreshCode,
    description:
        'Refreshes the common Support conversation without legacy Chatwoot client state.',
  );
  _replaceAction(
    project,
    oldName: 'supportSendMessage',
    newName: 'opengrowSupportSendMessage',
    code: _supportSendCode,
    description: 'Sends a message through the common Support authority.',
  );
  final widget = custom_code_helpers.findCustomWidget(
    project,
    name: 'SupportChatWidget',
  );
  if (widget != null) {
    custom_code_helpers.updateCustomWidget(
      project,
      name: 'SupportChatWidget',
      newName: 'OpenGrowSupportChatWidget',
      code: _supportWidgetCode,
      description:
          'Authenticated OpenGrow Support inbox with realtime refresh and attachment upload.',
    );
  }
}

void _removeUnusedLegacyMediaAction(FFProject project) {
  if (custom_code_helpers.findCustomAction(project, name: 'userMediaRemove') !=
      null) {
    custom_code_helpers.removeCustomAction(project, name: 'userMediaRemove');
  }
}

void _migrateVoiceCloneEndpoint(FFProject project) {
  final endpoint = api_helpers.findApiEndpoint(
    project,
    name: 'post User Vocals',
    groupName: 'Vocostar API Gateway',
  );
  if (endpoint == null) return;
  endpoint.url = '/api/v1/custom/jobs';
  endpoint.body =
      r'''
{
  "capability": "vocostar.voice.clone",
  "payload": {
    "fileId": "<refs>",
    "language": "<language>"
  }
}
'''.trim();
  endpoint.headers.removeWhere(
    (header) => header.toLowerCase().startsWith('idempotency-key:'),
  );
  endpoint.headers.add('Idempotency-Key: <refs>');
}

void _normalizeApiVariables(FFProject project) {
  final endpoints = <FFApiEndpoint>[
    ...project.backend.apiConfig.endpoints,
    for (final group in project.backend.apiConfig.apiGroups) ...group.endpoints,
  ];
  for (final endpoint in endpoints) {
    for (var index = 0; index < endpoint.headers.length; index += 1) {
      var header = endpoint.headers[index];
      for (final variable in endpoint.variables) {
        final name = variable.identifier.name;
        header = header.replaceAll('[$name]', '<$name>');
      }
      endpoint.headers[index] = header;
    }
    final parameterVariableKeys =
        endpoint.parameters
            .map((parameter) => parameter.variableIdentifier.key)
            .where((key) => key.isNotEmpty)
            .toSet();
    final parameterVariableNames =
        endpoint.parameters
            .map((parameter) => parameter.variableIdentifier.name)
            .where((name) => name.isNotEmpty)
            .toSet();
    final template = [
      endpoint.url,
      endpoint.body,
      ...endpoint.headers,
    ].join('\n');
    endpoint.variables.removeWhere((variable) {
      final name = variable.identifier.name;
      if (parameterVariableKeys.contains(variable.identifier.key) ||
          parameterVariableNames.contains(name)) {
        return false;
      }
      return !template.contains('[$name]') &&
          !template.contains('<$name>') &&
          !template.contains('<${_lowerCamel(name)}>');
    });
  }
}

String _lowerCamel(String value) =>
    value.isEmpty ? value : '${value[0].toLowerCase()}${value.substring(1)}';

void _repairLegacyListStructState(FFProject project) {
  for (final entry
      in const {
        'MenuBottom': 'userVocalsReplay',
        'UserClone': 'userClones',
        'UserPlayerMedia': 'userListVocal',
      }.entries) {
    final field = project_helpers.findStateField(
      project,
      widgetClassName: entry.key,
      fieldName: entry.value,
    );
    if (field == null) continue;
    final dataType = field.parameter.dataType;
    if (dataType.hasListType() &&
        dataType.listType.scalarType == FFBaseDataType.DataStruct) {
      final elementType = dataType.listType.deepCopy();
      if (!elementType.hasSubType() && dataType.hasSubType()) {
        elementType.subType = dataType.subType.deepCopy();
      }
      field.parameter.dataType = elementType;
      field.parameter.isList = true;
    }
  }
}

void _replaceAction(
  FFProject project, {
  required String oldName,
  String? newName,
  required String code,
  required String description,
}) {
  final targetName = newName ?? oldName;
  final action =
      custom_code_helpers.findCustomAction(project, name: oldName) ??
      custom_code_helpers.findCustomAction(project, name: targetName);
  if (action == null) return;
  custom_code_helpers.updateCustomAction(
    project,
    name: action.identifier.name,
    newName: targetName,
    code: code,
    description: description,
  );
}

FFCustomAction _upsertAction(
  FFProject project, {
  required String name,
  required String code,
  required String description,
}) {
  final existing = custom_code_helpers.findCustomAction(project, name: name);
  if (existing == null) {
    custom_code_helpers.addCustomAction(
      project,
      name: name,
      code: code,
      description: description,
    );
  } else {
    custom_code_helpers.updateCustomAction(
      project,
      name: name,
      code: code,
      description: description,
    );
  }
  return custom_code_helpers.findCustomAction(project, name: name)!;
}

const _logoutSessionCode = r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<void> opengrowLogoutSession() async {
  try {
    await opengrow.opengrowApplicationLogoutJson();
  } finally {
    try {
      await opengrow.opengrowPurchaseLogout();
    } finally {
      FFAppState().update(() {
        FFAppState().opengrowAccessTokenTransient = '';
        FFAppState().opengrowRefreshTokenUnavailable = '';
        FFAppState().opengrowTokenExpirationTransient = null;
        FFAppState().opengrowPushTokenTransient = '';
        FFAppState().authUserId = '';
        FFAppState().authUserData = UserStruct();
        FFAppState().userPremium = false;
        FFAppState().opengrowPurchasesReady = false;
      });
    }
  }
}
''';

const _userCleanManagerCode = r'''
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<bool> userCleanManager(
  String bearer,
  String type,
  String id,
) async {
  const validTypes = ['medias', 'vocals', 'user'];
  if (!validTypes.contains(type)) {
    debugPrint('[userClean] Unsupported cleanup type: $type');
    return false;
  }

  if (type == 'user') {
    try {
      await opengrow.opengrowApplicationDeleteAccountJson();
      return true;
    } catch (error) {
      debugPrint('[OpenGrow] Account erasure request failed: $error');
      return false;
    } finally {
      try {
        await opengrow.opengrowPurchaseLogout();
      } finally {
        FFAppState().update(() {
          FFAppState().opengrowAccessTokenTransient = '';
          FFAppState().opengrowRefreshTokenUnavailable = '';
          FFAppState().opengrowTokenExpirationTransient = null;
          FFAppState().opengrowPushTokenTransient = '';
          FFAppState().authUserId = '';
          FFAppState().authUserData = UserStruct();
          FFAppState().userPremium = false;
          FFAppState().opengrowPurchasesReady = false;
        });
      }
    }
  }

  if (bearer.isEmpty || id.isEmpty) {
    debugPrint('[userClean] Missing legacy cleanup credentials');
    return false;
  }
  try {
    final response = await http
        .delete(
          Uri.parse('${FFAppConstants.gatewayUrl}/clean/$type'),
          headers: {
            'Authorization': 'Bearer $bearer',
            'Content-Type': 'application/json',
          },
          body: jsonEncode({'id': id}),
        )
        .timeout(const Duration(seconds: 30));
    return response.statusCode >= 200 && response.statusCode < 300;
  } catch (error) {
    debugPrint('[userClean] Legacy $type cleanup failed: $error');
    return false;
  }
}
''';

const _initAppCode = r'''
import 'dart:async';
import 'dart:convert';
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;
import 'package:open_grow_private_4m5us1/custom_code/actions/opengrow_application_initialize.dart' as application;

StreamSubscription<String>? _verifiedCustomerInfoSubscription;

Future<void> initApp() async {
  await application.opengrowApplicationInitialize();
  final sessionJson = await opengrow.opengrowApplicationRestoreSessionJson();
  final session = (jsonDecode(sessionJson) as Map).cast<String, dynamic>();
  if (session['authenticated'] == true) {
    FFAppState().opengrowAccessTokenTransient =
        session['access_token']?.toString() ?? '';
    FFAppState().opengrowRefreshTokenUnavailable = '';
    FFAppState().authUserId = session['user_id']?.toString() ?? '';
    FFAppState().opengrowTokenExpirationTransient =
        DateTime.tryParse(session['expires_at']?.toString() ?? '');
  }
  _verifiedCustomerInfoSubscription ??=
      opengrow.opengrowVerifiedCustomerInfoJsonStream.listen(
    _applyVerifiedCustomerInfo,
    onError: (Object error) {
      debugPrint('[OpenGrow] Verified CustomerInfo stream failed: $error');
    },
  );
}

void _applyVerifiedCustomerInfo(String customerInfoJson) {
  try {
    final verified =
        (jsonDecode(customerInfoJson) as Map).cast<String, dynamic>();
    final entitlements =
        (verified['entitlements'] as Map?)?.cast<String, dynamic>() ??
            const <String, dynamic>{};
    final premium = entitlements['premium'];
    final isPremium = premium is Map && premium['is_active'] == true;
    final subscriptions = verified['active_subscriptions'];
    FFAppState().update(() {
      FFAppState().authUserData.premium = isPremium;
      FFAppState().authUserData.subscription =
          subscriptions is List && subscriptions.isNotEmpty;
      FFAppState().userPremium = isPremium;
      FFAppState().opengrowPurchasesReady = true;
    });
  } catch (error) {
    debugPrint('[OpenGrow] Invalid CustomerInfo was ignored: $error');
  }
}
''';

const _userAuthenticateCode = r'''
import 'dart:convert';
import 'dart:io';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';
import 'package:http/http.dart' as http;
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;
import 'package:open_grow_private_4m5us1/custom_code/actions/opengrow_application_initialize.dart' as application;
import 'package:open_grow_private_4m5us1/custom_code/actions/opengrow_initialize_authenticated_from_application_session.dart' as purchases;

const _installationKey = 'opengrow.vocostar.installation.v1';

Future<bool> userAuthenticate() async {
  try {
    await application.opengrowApplicationInitialize();
    var session = (jsonDecode(
      await opengrow.opengrowApplicationRestoreSessionJson(),
    ) as Map).cast<String, dynamic>();
    if (session['authenticated'] != true) {
      const storage = FlutterSecureStorage();
      var installationId = await storage.read(key: _installationKey) ?? '';
      if (installationId.isEmpty) {
        installationId = const Uuid().v4();
        await storage.write(key: _installationKey, value: installationId);
      }
      session = (jsonDecode(
        await opengrow.opengrowApplicationSignInAnonymousJson(installationId),
      ) as Map).cast<String, dynamic>();
    }
    await _applyOpenGrowSession(session);
    await _refreshVocoStarProfile();
    FFAppState().opengrowPurchasesReady = false;
    try {
      await purchases.opengrowInitializeAuthenticatedFromApplicationSession();
      FFAppState().opengrowPurchasesReady = true;
    } catch (error) {
      debugPrint('[OpenGrow] Purchases bridge unavailable: $error');
    }
    return true;
  } catch (error) {
    debugPrint('[OpenGrow] Secure authentication failed: $error');
    FFAppState().opengrowAccessTokenTransient = '';
    FFAppState().opengrowRefreshTokenUnavailable = '';
    return false;
  }
}

Future<void> _applyOpenGrowSession(Map<String, dynamic> session) async {
  final token = session['access_token']?.toString() ?? '';
  if (session['authenticated'] != true || token.isEmpty) {
    throw StateError('OpenGrow returned no authenticated application session.');
  }
  FFAppState().opengrowAccessTokenTransient = token;
  FFAppState().opengrowRefreshTokenUnavailable = '';
  FFAppState().opengrowTokenExpirationTransient =
      DateTime.tryParse(session['expires_at']?.toString() ?? '');
  FFAppState().authUserId = session['user_id']?.toString() ?? '';
}

Future<void> _refreshVocoStarProfile() async {
  final token = FFAppState().opengrowAccessTokenTransient;
  if (token.isEmpty) return;
  final response = await http.get(
    Uri.parse('${FFAppConstants.gatewayUrl}/users/me'),
    headers: {'Authorization': 'Bearer $token'},
  ).timeout(const Duration(seconds: 15));
  if (response.statusCode != 200) return;
  final data = (jsonDecode(response.body) as Map).cast<String, dynamic>();
  final userData = data['user'] is Map
      ? (data['user'] as Map).cast<String, dynamic>()
      : data;
  List<String> list(Object? value) {
    if (value is List) return value.map((item) => item.toString()).toList();
    if (value is String && value.isNotEmpty) {
      try {
        final decoded = jsonDecode(value);
        if (decoded is List) {
          return decoded.map((item) => item.toString()).toList();
        }
      } catch (_) {}
    }
    return <String>[];
  }
  String text(Object? value) => value?.toString() ?? '';
  int integer(Object? value) =>
      value is int ? value : int.tryParse(value?.toString() ?? '') ?? 0;
  bool boolean(Object? value) =>
      value == true || value == 1 || value == 'true';
  final profile = UserStruct(
    userId: text(userData['userId'] ?? userData['user_id']),
    email: text(userData['email']),
    isAnonymous: boolean(userData['isAnonymous'] ?? userData['is_anonymous']),
    deviceId: text(userData['deviceId'] ?? userData['device_id']),
    premium: boolean(userData['premium']),
    subscription: boolean(userData['subscription']),
    credits: integer(userData['credits']),
    language: text(userData['language']),
    operatingSystem:
        text(userData['operatingSystem'] ?? userData['operating_system'])
            .isNotEmpty
        ? text(userData['operatingSystem'] ?? userData['operating_system'])
        : (Platform.isAndroid ? 'android' : 'ios'),
    onBoarding: boolean(userData['onBoarding'] ?? userData['on_boarding']),
    fcmToken: text(userData['fcmToken'] ?? userData['fcm_token']),
    createdAt: text(userData['createdAt'] ?? userData['created_at']),
    customVocals:
        list(userData['customVocals'] ?? userData['custom_vocals']),
    customCategories:
        list(userData['customCategories'] ?? userData['custom_categories']),
  );
  FFAppState().authUserData = profile;
  FFAppState().authUserId = profile.userId.isNotEmpty
      ? profile.userId
      : FFAppState().authUserId;
  FFAppState().userBoardingView = profile.onBoarding;
  FFAppState().userVocals = List<String>.from(profile.customVocals);
  FFAppState().userCategories = List<String>.from(profile.customCategories);
  FFAppState().userCredits = profile.credits;
  final prefs = await SharedPreferences.getInstance();
  if (profile.language.isNotEmpty) {
    await prefs.setString('__locale_key__', profile.language);
  }
}
''';

const _userRefreshAuthCode = r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<bool> userRefreshAuth() async {
  try {
    await opengrow.opengrowApplicationRefreshJson();
    return userAuthenticate();
  } catch (error) {
    debugPrint('[OpenGrow] Secure session refresh failed: $error');
    return false;
  }
}
''';

const _googleProviderCode = r'''
import 'dart:convert';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;
import 'package:open_grow_private_4m5us1/custom_code/actions/opengrow_application_initialize.dart' as application;

Future<String> signlinkWithGoogle(String mode, String bearer) async {
  if (mode != 'link' && mode != 'signin') return 'invalid_mode';
  try {
    await application.opengrowApplicationInitialize();
    final account = await GoogleSignIn(scopes: const ['email', 'profile']).signIn();
    if (account == null) return 'cancelled';
    final authentication = await account.authentication;
    final idToken = authentication.idToken ?? '';
    if (idToken.isEmpty) return 'google_id_token_missing';
    if (mode == 'link') {
      await opengrow.opengrowApplicationLinkProviderJson(
        provider: 'google',
        idToken: idToken,
      );
      return '';
    }
    final result = await opengrow.opengrowApplicationSignInProviderJson(
      provider: 'google',
      idToken: idToken,
      name: account.displayName ?? '',
    );
    final session = (jsonDecode(result) as Map).cast<String, dynamic>();
    if (session['authenticated'] != true) return 'identity_rejected';
    return await userAuthenticate() ? '' : 'session_bridge_failed';
  } catch (error) {
    debugPrint('[OpenGrow] Google identity failed: $error');
    return 'google_identity_failed';
  }
}
''';

const _appleProviderCode = r'''
import 'dart:io';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;
import 'package:open_grow_private_4m5us1/custom_code/actions/opengrow_application_initialize.dart' as application;

Future<String> signlinkWithApple(String mode, String bearer) async {
  if (mode != 'link' && mode != 'signin') return 'invalid_mode';
  if (!Platform.isIOS && !Platform.isMacOS) return 'platform_unsupported';
  try {
    await application.opengrowApplicationInitialize();
    final credential = await SignInWithApple.getAppleIDCredential(
      scopes: const [
        AppleIDAuthorizationScopes.email,
        AppleIDAuthorizationScopes.fullName,
      ],
    );
    final idToken = credential.identityToken ?? '';
    if (idToken.isEmpty) return 'apple_id_token_missing';
    if (mode == 'link') {
      await opengrow.opengrowApplicationLinkProviderJson(
        provider: 'apple',
        idToken: idToken,
      );
      return '';
    }
    final name = [credential.givenName, credential.familyName]
        .whereType<String>()
        .where((value) => value.trim().isNotEmpty)
        .join(' ');
    await opengrow.opengrowApplicationSignInProviderJson(
      provider: 'apple',
      idToken: idToken,
      name: name,
    );
    return await userAuthenticate() ? '' : 'session_bridge_failed';
  } on SignInWithAppleAuthorizationException catch (error) {
    return error.code == AuthorizationErrorCode.canceled
        ? 'cancelled'
        : 'apple_identity_failed';
  } catch (error) {
    debugPrint('[OpenGrow] Apple identity failed: $error');
    return 'apple_identity_failed';
  }
}
''';

const _maintenancePolicyCode = r'''
import 'dart:convert';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<bool> appCheckMaintenance(String bearerAuth) async {
  final info = await PackageInfo.fromPlatform();
  final policy = (jsonDecode(
    await opengrow.opengrowApplicationRuntimePolicyJson(
      appVersion: info.version,
      build: info.buildNumber,
    ),
  ) as Map).cast<String, dynamic>();
  final maintenance = policy['maintenance'];
  return maintenance is Map && maintenance['enabled'] == true;
}
''';

const _updatePolicyCode = r'''
import 'dart:convert';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<bool> appCheckUpdate(String bearerAuth) async {
  final info = await PackageInfo.fromPlatform();
  final policy = (jsonDecode(
    await opengrow.opengrowApplicationRuntimePolicyJson(
      appVersion: info.version,
      build: info.buildNumber,
    ),
  ) as Map).cast<String, dynamic>();
  return policy['update_required'] == true ||
      policy['minimum_version_satisfied'] == false;
}
''';

const _registerPushDeviceCode = r'''
import 'dart:io';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<void> opengrowRegisterPushDevice(String bearer) async {
  if (bearer.trim().isEmpty) {
    throw StateError(
      'Notification registration requires an authenticated OpenGrow session.',
    );
  }
  if (Firebase.apps.isEmpty) await Firebase.initializeApp();
  final messaging = FirebaseMessaging.instance;
  final settings = await messaging.requestPermission(
    alert: true,
    badge: true,
    sound: true,
  );
  FFAppState().opengrowPushTokenTransient = '';
  if (settings.authorizationStatus != AuthorizationStatus.authorized &&
      settings.authorizationStatus != AuthorizationStatus.provisional) {
    return;
  }
  if (Platform.isIOS) {
    String? apnsToken;
    for (var attempt = 0; attempt < 5; attempt += 1) {
      apnsToken = await messaging.getAPNSToken();
      if (apnsToken?.isNotEmpty == true) break;
      await Future<void>.delayed(const Duration(seconds: 1));
    }
    if (apnsToken?.isNotEmpty != true) {
      throw StateError('APNs did not provide a device token.');
    }
  }
  final token = await messaging.getToken() ?? '';
  if (token.isEmpty) throw StateError('FCM returned an empty device token.');
  if (!await opengrow.opengrowSetPushToken(token)) {
    throw StateError('OpenGrow rejected the notification device token.');
  }
  FFAppState().opengrowPushTokenTransient = token;
}
''';

const _uploadFileAdapterCode = r'''
import 'dart:convert';
import 'dart:io';
import 'package:path/path.dart' as path;
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String?> opengrowApplicationUploadFileJson(
  String? userMediaPath,
  String? userId,
  String? bearerToken,
) async {
  final source = userMediaPath?.trim() ?? '';
  if (source.isEmpty) return null;
  final file = File(source);
  final bytes = await file.readAsBytes();
  if (bytes.isEmpty) return null;
  final filename = path.basename(source);
  final extension = path.extension(filename).toLowerCase();
  final contentType = const {
        '.aac': 'audio/aac',
        '.m4a': 'audio/mp4',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.mp4': 'video/mp4',
        '.mov': 'video/quicktime',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
      }[extension] ??
      'application/octet-stream';
  final response = (jsonDecode(
    await opengrow.opengrowApplicationUploadFileJson(
      bytes: bytes,
      filename: filename,
      contentType: contentType,
    ),
  ) as Map).cast<String, dynamic>();
  final nested = response['file'];
  final id = nested is Map
      ? nested['id']?.toString() ?? ''
      : response['id']?.toString() ?? '';
  if (id.isEmpty) throw StateError('Files authority returned no file ID.');
  return id;
}
''';

const _customJobAdapterCode = r'''
import 'dart:convert';
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String?> opengrowApplicationCreateCustomJobJson(
  String bearer,
  String vocalId,
  String mediaType,
  String vocalType,
  dynamic input,
  int credits,
) async {
  final rawInput = input is Map
      ? input.map((key, value) => MapEntry(key.toString(), value))
      : <String, dynamic>{};
  final normalized = <String, dynamic>{};
  if (mediaType == 'audio' || mediaType == 'video') {
    final candidate = rawInput['fileId'] ??
        rawInput['file_id'] ??
        rawInput['audio_src'] ??
        rawInput['video_src'];
    var fileId = candidate?.toString() ?? '';
    if (fileId.startsWith('{')) {
      final decoded = jsonDecode(fileId);
      if (decoded is Map) {
        final nested = decoded['file'];
        fileId = nested is Map
            ? nested['id']?.toString() ?? ''
            : decoded['id']?.toString() ?? '';
      }
    }
    normalized['fileId'] = fileId;
  } else {
    normalized['text'] =
        (rawInput['text'] ?? rawInput['text_src'])?.toString() ?? '';
    normalized['language'] = rawInput['language']?.toString() ?? 'en';
  }
  final payload = jsonEncode({
    'vocalId': vocalId,
    'mediaType': mediaType,
    'vocalType': vocalType,
    'input': normalized,
    'creditCost': credits,
  });
  final result = await opengrow.opengrowApplicationCreateCustomJobJson(
    capability: 'vocostar.media.convert',
    payloadJson: payload,
    idempotencyKey:
        'media:$vocalId:$mediaType:${DateTime.now().microsecondsSinceEpoch}',
  );
  final decoded = jsonDecode(result);
  if (decoded is Map) {
    return decoded['job_id']?.toString() ??
        decoded['id']?.toString() ??
        result;
  }
  return result;
}
''';

const _supportInitializeCode = r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;
import 'package:opengrow_flutterflow_messaging/opengrow_flutterflow_messaging.dart' as support;
import 'package:open_grow_private_4m5us1/library_values.dart' as library;

Future<void> opengrowSupportInitializeAuthenticated() async {
  final values = library.FFLibraryValues();
  final token = await opengrow.opengrowApplicationAccessToken();
  if (token.isEmpty) throw StateError('Application authentication is required.');
  final authUrl = values.authGatewayBaseUrl?.trim() ?? '';
  final supportUrl = values.supportBaseUrl?.trim() ?? '';
  final projectId = values.supportProjectId ?? 0;
  if (authUrl.isEmpty || supportUrl.isEmpty || projectId <= 0) {
    throw StateError('OpenGrow Support configuration is incomplete.');
  }
  await support.opengrowSupportInitializeAuthenticated(
    applicationAccessToken: token,
    projectId: projectId,
    authGatewayUrl: authUrl,
    supportUrl: supportUrl,
  );
}
''';

const _supportRefreshCode = r'''
import 'package:opengrow_flutterflow_messaging/opengrow_flutterflow_messaging.dart' as support;

Future<void> opengrowSupportRefreshMessages() async {
  await support.opengrowSupportListConversationsJson();
}
''';

const _supportSendCode = r'''
import 'dart:convert';
import 'package:opengrow_flutterflow_messaging/opengrow_flutterflow_messaging.dart' as support;

Future<bool> opengrowSupportSendMessage(String message) async {
  final body = message.trim();
  if (body.isEmpty) return false;
  final decoded = jsonDecode(await support.opengrowSupportListConversationsJson());
  if (decoded is! List || decoded.isEmpty || decoded.first is! Map) return false;
  final conversationId = (decoded.first as Map)['id']?.toString() ?? '';
  if (conversationId.isEmpty) return false;
  await support.opengrowSupportSend(
    conversationId: conversationId,
    body: body,
    clientMessageId: 'mobile-${DateTime.now().microsecondsSinceEpoch}',
  );
  return true;
}
''';

const _supportWidgetCode = r'''
import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:opengrow_flutterflow_messaging/opengrow_flutterflow_messaging.dart' as support;

class OpenGrowSupportChatWidget extends StatefulWidget {
  const OpenGrowSupportChatWidget({
    super.key,
    this.width,
    this.height,
    this.welcomeMessage = '',
    this.inputHintText = '',
    this.agentTypingText = '',
    this.onlineText = '',
    this.resolveText = '',
    this.todayText = '',
    this.yesterdayText = '',
    this.galleryText = '',
    this.cameraText = '',
  });

  final double? width;
  final double? height;
  final String welcomeMessage;
  final String inputHintText;
  final String agentTypingText;
  final String onlineText;
  final String resolveText;
  final String todayText;
  final String yesterdayText;
  final String galleryText;
  final String cameraText;

  @override
  State<OpenGrowSupportChatWidget> createState() =>
      _OpenGrowSupportChatWidgetState();
}

class _OpenGrowSupportChatWidgetState
    extends State<OpenGrowSupportChatWidget> {
  final _controller = TextEditingController();
  final _scroll = ScrollController();
  final _picker = ImagePicker();
  final List<Map<String, dynamic>> _messages = [];
  StreamSubscription<String>? _events;
  Timer? _poll;
  String _conversationId = '';
  bool _loading = true;
  bool _sending = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _initialize();
  }

  Future<void> _initialize() async {
    try {
      await opengrowSupportInitializeAuthenticated();
      final conversations =
          jsonDecode(await support.opengrowSupportListConversationsJson());
      if (conversations is List && conversations.isNotEmpty) {
        _conversationId =
            (conversations.first as Map)['id']?.toString() ?? '';
      }
      if (_conversationId.isEmpty) {
        _conversationId = await support.opengrowSupportOpenConversation(
          clientConversationId: 'primary',
          subject: widget.welcomeMessage.isEmpty
              ? 'Support'
              : widget.welcomeMessage,
        );
      }
      await _refresh();
      await support.opengrowSupportConnectRealtime(_conversationId);
      _events = support.opengrowSupportEventJsonStream.listen((_) => _refresh());
      _poll = Timer.periodic(const Duration(seconds: 20), (_) => _refresh());
    } catch (error) {
      _error = error.toString();
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _refresh() async {
    if (_conversationId.isEmpty) return;
    try {
      final decoded = jsonDecode(
        await support.opengrowSupportMessagesJson(
          _conversationId,
          limit: 100,
        ),
      );
      if (decoded is List && mounted) {
        setState(() {
          _messages
            ..clear()
            ..addAll(decoded
                .whereType<Map>()
                .map((item) => item.cast<String, dynamic>()));
          _error = null;
        });
        await support.opengrowSupportMarkRead(_conversationId);
        _scrollToBottom();
      }
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    }
  }

  Future<void> _send() async {
    final body = _controller.text.trim();
    if (body.isEmpty || _sending || _conversationId.isEmpty) return;
    setState(() => _sending = true);
    _controller.clear();
    try {
      await support.opengrowSupportSend(
        conversationId: _conversationId,
        body: body,
        clientMessageId: 'mobile-${DateTime.now().microsecondsSinceEpoch}',
      );
      await _refresh();
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _pick(ImageSource source) async {
    if (_sending || _conversationId.isEmpty) return;
    final file = await _picker.pickImage(source: source, imageQuality: 85);
    if (file == null) return;
    setState(() => _sending = true);
    try {
      final bytes = await file.readAsBytes();
      final attachment = await support.opengrowSupportUploadAttachmentJson(
        conversationId: _conversationId,
        bytes: bytes,
        filename: file.name,
        contentType: 'image/jpeg',
      );
      await support.opengrowSupportSendAttachment(
        conversationId: _conversationId,
        attachmentJson: attachment,
        clientMessageId: 'mobile-file-${DateTime.now().microsecondsSinceEpoch}',
      );
      await _refresh();
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(
          _scroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    _events?.cancel();
    support.opengrowSupportDisconnectRealtime();
    _controller.dispose();
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SizedBox(
      width: widget.width,
      height: widget.height,
      child: Column(
        children: [
          if (_loading) const LinearProgressIndicator(),
          if (_error != null)
            MaterialBanner(
              content: Text(_error!),
              actions: [
                TextButton(onPressed: _refresh, child: const Text('Retry')),
              ],
            ),
          Expanded(
            child: ListView.builder(
              controller: _scroll,
              padding: const EdgeInsets.all(16),
              itemCount: _messages.length,
              itemBuilder: (context, index) {
                final message = _messages[index];
                final mine = message['sender_kind'] == 'customer';
                final body = message['body']?.toString() ?? '';
                final attachments = message['attachments'];
                final attachmentName = attachments is List && attachments.isNotEmpty
                    ? (attachments.first as Map)['file_name']?.toString()
                    : null;
                return Align(
                  alignment:
                      mine ? Alignment.centerRight : Alignment.centerLeft,
                  child: Container(
                    constraints: const BoxConstraints(maxWidth: 320),
                    margin: const EdgeInsets.only(bottom: 10),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 10,
                    ),
                    decoration: BoxDecoration(
                      color: mine
                          ? theme.colorScheme.primary
                          : theme.colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Text(
                      body.isNotEmpty ? body : attachmentName ?? 'Attachment',
                      style: TextStyle(
                        color: mine
                            ? theme.colorScheme.onPrimary
                            : theme.colorScheme.onSurface,
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(8, 6, 8, 8),
              child: Row(
                children: [
                  IconButton(
                    onPressed: _sending
                        ? null
                        : () => _pick(ImageSource.gallery),
                    tooltip: widget.galleryText,
                    icon: const Icon(Icons.photo_library_outlined),
                  ),
                  Expanded(
                    child: TextField(
                      controller: _controller,
                      enabled: !_sending,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _send(),
                      decoration: InputDecoration(
                        hintText: widget.inputHintText,
                        border: const OutlineInputBorder(),
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: _sending ? null : _send,
                    icon: _sending
                        ? const SizedBox.square(
                            dimension: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.send),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
''';
