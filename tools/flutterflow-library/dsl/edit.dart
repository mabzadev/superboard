library;

import 'dart:io';

import 'package:flutterflow_ai/flutterflow_ai.dart';
import 'package:flutterflow_ai/src/helpers/action_block_helpers.dart'
    as action_block_helpers;
import 'package:flutterflow_ai/src/helpers/custom_code_helpers.dart'
    as custom_code_helpers;
import 'package:flutterflow_ai/src/helpers/data_type_helpers.dart';
import 'package:flutterflow_ai/src/helpers/data_schema_helpers.dart'
    as data_schema_helpers;
import 'package:flutterflow_ai/src/helpers/library_value_helpers.dart';
import 'package:flutterflow_ai/src/helpers/pub_dependency_helpers.dart'
    as pub_dependency_helpers;
import 'package:flutterflow_ai/src/helpers/variable_helpers.dart';

Future<void> main(List<String> args) async {
  final options = _parseCliOptions(args);
  try {
    await flutterFlowAI(
      buildStarterEditFlow,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      projectName: options.projectName,
      projectId: options.projectId,
      findOrCreate: options.findOrCreate,
      allowNewProject: options.allowNewProject,
      dryRun: options.dryRun,
      commitMessage: options.commitMessage,
    );
  } catch (error) {
    stderr.writeln('Error: ${formatFlutterFlowAIError(error)}');
    exit(1);
  }
}

final class _CliOptions {
  const _CliOptions({
    this.apiKey,
    this.baseUrl,
    this.projectName,
    this.projectId,
    this.findOrCreate = false,
    this.allowNewProject = false,
    this.dryRun = false,
    this.commitMessage,
  });

  final String? apiKey;
  final String? baseUrl;
  final String? projectName;
  final String? projectId;
  final bool findOrCreate;
  final bool allowNewProject;
  final bool dryRun;
  final String? commitMessage;
}

_CliOptions _parseCliOptions(List<String> args) {
  String? apiKey;
  String? baseUrl;
  String? projectName;
  String? projectId;
  String? commitMessage;
  var findOrCreate = false;
  var allowNewProject = false;
  var dryRun = false;

  for (var i = 0; i < args.length; i++) {
    final arg = args[i];
    switch (arg) {
      case '--help':
      case '-h':
        _printUsage();
        exit(0);
      case '--api-key':
        apiKey = _requireValue(args, ++i, '--api-key');
      case '--base-url':
        baseUrl = _requireValue(args, ++i, '--base-url');
      case '--project-name':
        projectName = _requireValue(args, ++i, '--project-name');
      case '--project-id':
        projectId = _requireValue(args, ++i, '--project-id');
      case '--commit-message':
        commitMessage = _requireValue(args, ++i, '--commit-message');
      case '--find-or-create':
        findOrCreate = true;
      case '--allow-new-project':
        allowNewProject = true;
      case '--dry-run':
        dryRun = true;
      default:
        stderr.writeln('Unknown option: $arg');
        _printUsage();
        exit(64);
    }
  }

  return _CliOptions(
    apiKey: apiKey,
    baseUrl: baseUrl,
    projectName: projectName,
    projectId: projectId,
    findOrCreate: findOrCreate,
    allowNewProject: allowNewProject,
    dryRun: dryRun,
    commitMessage: commitMessage,
  );
}

String _requireValue(List<String> args, int index, String flag) {
  if (index >= args.length) {
    stderr.writeln('Missing value for $flag.');
    _printUsage();
    exit(64);
  }
  return args[index];
}

void _printUsage() {
  stdout.writeln('''
Run the starter FlutterFlow AI edit flow.

Usage:
  dart run dsl/edit.dart [options]

Options:
  --api-key <key>           FlutterFlow API key. Defaults to FF_API_KEY.
  --base-url <url>          Override the FlutterFlow API base URL.
  --project-name <name>     Create a new project with this name.
  --project-id <id>         Push into an existing project by ID.
  --find-or-create          Retry by reusing a same-name project before creating.
  --allow-new-project       Bypass the workspace binding guard and create a different project.
  --commit-message <text>   Commit message for the push.
  --dry-run                 Compile and validate without pushing.
  --help, -h                Show this help.
''');
}

void buildStarterEditFlow(App app) {
  final projectKeyId = FFIdentifier(
    name: 'projectKey',
    key: 'superboard_project_key',
  );
  final uriSchemeId = FFIdentifier(
    name: 'uriScheme',
    key: 'superboard_uri_scheme',
  );
  final useTestEnvironmentId = FFIdentifier(
    name: 'useTestEnvironment',
    key: 'superboard_use_test_environment',
  );
  final sdkBaseUrlId = FFIdentifier(
    name: 'sdkBaseUrl',
    key: 'superboard_sdk_base_url',
  );
  final authGatewayBaseUrlId = FFIdentifier(
    name: 'authGatewayBaseUrl',
    key: 'superboard_auth_gateway_base_url',
  );
  final filesBaseUrlId = FFIdentifier(
    name: 'filesBaseUrl',
    key: 'superboard_files_base_url',
  );
  final applicationIdentifierId = FFIdentifier(
    name: 'applicationIdentifier',
    key: 'superboard_application_identifier',
  );
  final applicationEnvironmentId = FFIdentifier(
    name: 'applicationEnvironment',
    key: 'superboard_application_environment',
  );
  final supportBaseUrlId = FFIdentifier(
    name: 'supportBaseUrl',
    key: 'superboard_support_base_url',
  );
  final supportProjectIdId = FFIdentifier(
    name: 'supportProjectId',
    key: 'superboard_support_project_id',
  );
  final shortLinkHostId = FFIdentifier(
    name: 'shortLinkHost',
    key: 'superboard_short_link_host',
  );

  void ensureLibraryParameter(
    FFProject project,
    FFIdentifier identifier,
    FFDataTypeV2 dataType, {
    String? defaultValue,
  }) {
    var parameter = findLibraryParameter(project, name: identifier.name);
    if (parameter == null) {
      addLibraryParameter(
        project,
        name: identifier.name,
        dataType: dataType,
        defaultValue: defaultValue,
      );
      parameter = findLibraryParameter(project, name: identifier.name)!;
    }
    parameter.identifier = identifier;
    parameter.dataType = dataType;
    if (defaultValue != null) {
      parameter.defaultValue = FFParameterValue(serializedValue: defaultValue);
    } else if (parameter.hasDefaultValue()) {
      parameter.clearDefaultValue();
    }
  }

  app.raw((project) {
    ensureLibraryParameter(project, projectKeyId, stringType);
    ensureLibraryParameter(project, uriSchemeId, stringType);
    ensureLibraryParameter(
      project,
      useTestEnvironmentId,
      boolType,
      defaultValue: 'false',
    );
    ensureLibraryParameter(project, sdkBaseUrlId, stringType);
    ensureLibraryParameter(project, authGatewayBaseUrlId, stringType);
    ensureLibraryParameter(project, filesBaseUrlId, stringType);
    ensureLibraryParameter(project, applicationIdentifierId, stringType);
    ensureLibraryParameter(
      project,
      applicationEnvironmentId,
      stringType,
      defaultValue: 'production',
    );
    ensureLibraryParameter(project, supportBaseUrlId, stringType);
    ensureLibraryParameter(project, supportProjectIdId, intType);
    ensureLibraryParameter(project, shortLinkHostId, stringType);

    FFCustomFile ensureConfigurationFile(
      FFCustomFile_Type type,
      String fileName,
    ) {
      for (final file in project.ensureCustomCode().ensureCustomFiles().files) {
        if (file.type == type) return file;
      }
      final file = FFCustomFile(
        identifier: FFIdentifier(name: fileName),
        type: type,
        isUnlocked: false,
        fullContent: '',
      );
      project.customCode.customFiles.files.add(file);
      return file;
    }

    void bindFileVariable(
      FFCustomFile file, {
      required String key,
      required FFIdentifier libraryValue,
      required FFDataTypeV2 dataType,
    }) {
      file.parameters.removeWhere(
        (_, parameter) => parameter.parameter.identifier.name == key,
      );
      file.parameters['superboard_${file.type.value}_$key'] =
          FFCustomFile_Parameter(
            parameter: FFParameter(
              identifier: FFIdentifier(name: key),
              dataType: dataType,
            ),
            value: FFValue(variable: varFromLibraryValue(libraryValue)),
          );
    }

    void upsertHook(
      FFCustomFile file, {
      required String name,
      required String key,
      required FFCustomFile_Hook_Type type,
      required String content,
    }) {
      file.hooks.removeWhere((hook) => hook.identifier.name == name);
      file.hooks.add(
        FFCustomFile_Hook(
          identifier: FFIdentifier(name: name, key: key),
          type: type,
          content: content,
        ),
      );
    }

    final androidManifest = ensureConfigurationFile(
      FFCustomFile_Type.ANDROID_MANIFEST,
      'AndroidManifest.xml',
    );
    upsertHook(
      androidManifest,
      name: 'SuperBoard Deep Links',
      key: 'superboard_android_deep_links',
      type: FFCustomFile_Hook_Type.MANIFEST_ACTIVITY_TAG,
      content: r'''
<intent-filter android:autoVerify="true">
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="{{uriScheme}}" />
  <data android:scheme="https" android:host="{{shortLinkHost}}" />
</intent-filter>
''',
    );
    upsertHook(
      androidManifest,
      name: 'SuperBoard Native Configuration',
      key: 'superboard_android_native_configuration',
      type: FFCustomFile_Hook_Type.MANIFEST_APP_COMPONENT_TAG,
      content: r'''
<meta-data
  android:name="superboard_api_key"
  android:value="{{projectKey}}" />
<meta-data
  android:name="superboard_base_url"
  android:value="{{sdkBaseUrl}}" />
<meta-data
  android:name="superboard_use_test_environment"
  android:value="{{useTestEnvironment}}" />
''',
    );
    bindFileVariable(
      androidManifest,
      key: 'projectKey',
      libraryValue: projectKeyId,
      dataType: stringType,
    );
    bindFileVariable(
      androidManifest,
      key: 'uriScheme',
      libraryValue: uriSchemeId,
      dataType: stringType,
    );
    bindFileVariable(
      androidManifest,
      key: 'useTestEnvironment',
      libraryValue: useTestEnvironmentId,
      dataType: boolType,
    );
    bindFileVariable(
      androidManifest,
      key: 'sdkBaseUrl',
      libraryValue: sdkBaseUrlId,
      dataType: stringType,
    );
    bindFileVariable(
      androidManifest,
      key: 'shortLinkHost',
      libraryValue: shortLinkHostId,
      dataType: stringType,
    );

    final infoPlist = ensureConfigurationFile(
      FFCustomFile_Type.INFO_PLIST,
      'Info.plist',
    );
    upsertHook(
      infoPlist,
      name: 'SuperBoard Native Configuration',
      key: 'superboard_ios_native_configuration',
      type: FFCustomFile_Hook_Type.INFO_PLIST_PROPERTY,
      content: r'''
<key>SuperBoardApiKey</key>
<string>{{projectKey}}</string>
<key>SuperBoardUseTestEnvironment</key>
<{{useTestEnvironment}}/>
<key>SuperBoardBaseURL</key>
<string>{{sdkBaseUrl}}</string>
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleTypeRole</key>
    <string>Editor</string>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>{{uriScheme}}</string>
    </array>
  </dict>
</array>
''',
    );
    bindFileVariable(
      infoPlist,
      key: 'projectKey',
      libraryValue: projectKeyId,
      dataType: stringType,
    );
    bindFileVariable(
      infoPlist,
      key: 'uriScheme',
      libraryValue: uriSchemeId,
      dataType: stringType,
    );
    bindFileVariable(
      infoPlist,
      key: 'useTestEnvironment',
      libraryValue: useTestEnvironmentId,
      dataType: boolType,
    );
    bindFileVariable(
      infoPlist,
      key: 'sdkBaseUrl',
      libraryValue: sdkBaseUrlId,
      dataType: stringType,
    );

    final entitlements = ensureConfigurationFile(
      FFCustomFile_Type.ENTITLEMENTS,
      'Runner.entitlements',
    );
    upsertHook(
      entitlements,
      name: 'SuperBoard Associated Domain',
      key: 'superboard_ios_associated_domain',
      type: FFCustomFile_Hook_Type.ENTITLEMENT,
      content: r'''
<key>com.apple.developer.associated-domains</key>
<array>
  <string>applinks:{{shortLinkHost}}</string>
</array>
''',
    );
    bindFileVariable(
      entitlements,
      key: 'shortLinkHost',
      libraryValue: shortLinkHostId,
      dataType: stringType,
    );
  });

  app.state('superboardIdentityUserIdentifier', string.withDefault(''));
  app.state('superboardPackageIdentifier', string.withDefault(''));
  app.state('superboardOfferingIdentifier', string.withDefault('default'));

  app.raw((project) {
    if (data_schema_helpers.findAppStateField(
          project,
          name: 'superboardIdentityToken',
        ) !=
        null) {
      data_schema_helpers.removeAppStateField(
        project,
        name: 'superboardIdentityToken',
      );
    }
    if (data_schema_helpers.findAppStateField(
          project,
          name: 'superboardVocostarAccessToken',
        ) !=
        null) {
      data_schema_helpers.removeAppStateField(
        project,
        name: 'superboardVocostarAccessToken',
      );
    }
    if (data_schema_helpers.findAppStateField(
          project,
          name: 'superboardApplicationAccessToken',
        ) !=
        null) {
      data_schema_helpers.removeAppStateField(
        project,
        name: 'superboardApplicationAccessToken',
      );
    }
    if (data_schema_helpers.findAppStateField(
          project,
          name: 'opengrowIdentityToken',
        ) !=
        null) {
      data_schema_helpers.removeAppStateField(
        project,
        name: 'opengrowIdentityToken',
      );
    }
    if (data_schema_helpers.findAppStateField(
          project,
          name: 'opengrowVocostarAccessToken',
        ) !=
        null) {
      data_schema_helpers.removeAppStateField(
        project,
        name: 'opengrowVocostarAccessToken',
      );
    }
    if (data_schema_helpers.findAppStateField(
          project,
          name: 'opengrowApplicationAccessToken',
        ) !=
        null) {
      data_schema_helpers.removeAppStateField(
        project,
        name: 'opengrowApplicationAccessToken',
      );
    }
    for (final legacyAction in [
      'opengrowInitializeAuto',
      'opengrowPurchaseLogin',
      'opengrowIdentify',
      'opengrowIdentifyFromLibraryState',
      'opengrowInitializeAuthenticatedFromLibraryState',
    ]) {
      if (custom_code_helpers.findCustomAction(project, name: legacyAction) !=
          null) {
        custom_code_helpers.removeCustomAction(project, name: legacyAction);
      }
    }
    project.customCode.pubspecPackageInfo.pubspecDependencies.removeWhere(
      (dependency) => const {
        'opengrow_flutterflow',
        'opengrow_flutterflow_messaging',
      }.contains(dependency.name),
    );
    final sdkDependency =
        r'''
git:
  url: https://github.com/mabzadev/superboard.git
  ref: sdk-flutterflow-v3.0.0
  path: sdks/flutterflow
'''
            .trim();
    if (pub_dependency_helpers.findPubDependency(
          project,
          name: 'superboard_flutterflow',
        ) ==
        null) {
      pub_dependency_helpers.addPubDependency(
        project,
        name: 'superboard_flutterflow',
        version: sdkDependency,
      );
    } else {
      pub_dependency_helpers.updatePubDependency(
        project,
        name: 'superboard_flutterflow',
        newVersion: sdkDependency,
      );
    }
    if (action_block_helpers.findActionBlock(
          project,
          name: 'SuperBoardIdentifyUser',
        ) !=
        null) {
      action_block_helpers.removeActionBlock(
        project,
        name: 'SuperBoardIdentifyUser',
      );
    }
  });

  final initializeAuthenticated = app.customAction(
    'superboardInitializeAuthenticated',
    args: {'applicationAccessToken': string},
    returns: bool_,
    description:
        'Initializes Purchases through the configured application authentication gateway.',
    code: r'''
import '/library_values.dart';
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<bool> superboardInitializeAuthenticated(String applicationAccessToken) {
  final values = FFLibraryValues();
  final projectKey = values.projectKey?.trim() ?? '';
  if (projectKey.isEmpty) {
    throw StateError('SuperBoard projectKey library value is required.');
  }
  final sdkBaseUrl = values.sdkBaseUrl?.trim() ?? '';
  if (sdkBaseUrl.isEmpty) {
    throw StateError('SuperBoard sdkBaseUrl library value is required.');
  }
  final authGatewayBaseUrl = values.authGatewayBaseUrl?.trim() ?? '';
  if (authGatewayBaseUrl.isEmpty) {
    throw StateError('SuperBoard authGatewayBaseUrl library value is required.');
  }
  return superboard.superboardInitializeAuthenticated(
    projectKey: projectKey,
    applicationAccessToken: applicationAccessToken,
    sdkBaseUrl: sdkBaseUrl,
    authGatewayBaseUrl: authGatewayBaseUrl,
  );
}
''',
  );

  final initializeApplication = app.customAction(
    'superboardApplicationInitialize',
    returns: bool_,
    description:
        'Initializes the common application gateway and restores its encrypted native session.',
    code: r'''
import '/library_values.dart';
import 'package:flutter/foundation.dart';
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<bool> superboardApplicationInitialize() {
  final values = FFLibraryValues();
  final projectKey = values.projectKey?.trim() ?? '';
  if (projectKey.isEmpty) {
    throw StateError('SuperBoard projectKey library value is required.');
  }
  final apiBaseUrl = values.authGatewayBaseUrl?.trim() ?? '';
  if (apiBaseUrl.isEmpty) {
    throw StateError('SuperBoard authGatewayBaseUrl library value is required.');
  }
  final filesBaseUrl = values.filesBaseUrl?.trim() ?? '';
  if (filesBaseUrl.isEmpty) {
    throw StateError('SuperBoard filesBaseUrl library value is required.');
  }
  final identifier = values.applicationIdentifier?.trim() ?? '';
  if (identifier.isEmpty) {
    throw StateError('SuperBoard applicationIdentifier library value is required.');
  }
  return superboard.superboardApplicationInitialize(
    apiBaseUrl: apiBaseUrl,
    filesBaseUrl: filesBaseUrl,
    projectKey: projectKey,
    platform: kIsWeb ? 'web' : defaultTargetPlatform.name,
    identifier: identifier,
    environment: values.applicationEnvironment?.trim() ?? 'production',
    restoreSession: true,
  );
}
''',
  );

  final initializeAuthenticatedFromApplicationSession = app.customAction(
    'superboardInitializeAuthenticatedFromApplicationSession',
    returns: bool_,
    description:
        'Initializes Purchases with the ephemeral access token restored by the SDK session manager.',
    code: r'''
import '/library_values.dart';
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<bool> superboardInitializeAuthenticatedFromApplicationSession() async {
  final accessToken = await superboard.superboardApplicationAccessToken();
  if (accessToken.isEmpty) return false;
  final values = FFLibraryValues();
  final projectKey = values.projectKey?.trim() ?? '';
  final sdkBaseUrl = values.sdkBaseUrl?.trim() ?? '';
  final authGatewayBaseUrl = values.authGatewayBaseUrl?.trim() ?? '';
  if (projectKey.isEmpty || sdkBaseUrl.isEmpty || authGatewayBaseUrl.isEmpty) {
    throw StateError('SuperBoard authenticated library values are incomplete.');
  }
  return superboard.superboardInitializeAuthenticated(
    projectKey: projectKey,
    applicationAccessToken: accessToken,
    sdkBaseUrl: sdkBaseUrl,
    authGatewayBaseUrl: authGatewayBaseUrl,
  );
}
''',
  );

  app.customAction(
    'superboardApplicationRestoreSessionJson',
    returns: string,
    description: 'Restores and rotates the encrypted application session.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<String> superboardApplicationRestoreSessionJson() {
  return superboard.superboardApplicationRestoreSessionJson();
}
''',
  );

  app.customAction(
    'superboardApplicationCurrentSessionJson',
    returns: string,
    description:
        'Returns the current session without exposing the secure refresh token.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<String> superboardApplicationCurrentSessionJson() {
  return superboard.superboardApplicationCurrentSessionJson();
}
''',
  );

  app.customAction(
    'superboardApplicationAccessToken',
    returns: string,
    description:
        'Returns the current access token as an ephemeral action result.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<String> superboardApplicationAccessToken() {
  return superboard.superboardApplicationAccessToken();
}
''',
  );

  app.customAction(
    'superboardApplicationRegisterJson',
    args: {'email': string, 'password': string, 'name': string},
    returns: string,
    description: 'Registers an application user and secures the new session.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<String> superboardApplicationRegisterJson(
  String email,
  String password,
  String name,
) {
  return superboard.superboardApplicationRegisterJson(
    email: email,
    password: password,
    name: name,
  );
}
''',
  );

  app.customAction(
    'superboardApplicationSignInPasswordJson',
    args: {'email': string, 'password': string},
    returns: string,
    description: 'Signs in with email and stores the session securely.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<String> superboardApplicationSignInPasswordJson(
  String email,
  String password,
) {
  return superboard.superboardApplicationSignInPasswordJson(
    email: email,
    password: password,
  );
}
''',
  );

  app.customAction(
    'superboardApplicationSignInProviderJson',
    args: {'provider': string, 'idToken': string, 'name': string},
    returns: string,
    description: 'Signs in with Google or Apple and secures the session.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<String> superboardApplicationSignInProviderJson(
  String provider,
  String idToken,
  String name,
) {
  return superboard.superboardApplicationSignInProviderJson(
    provider: provider,
    idToken: idToken,
    name: name,
  );
}
''',
  );

  app.customAction(
    'superboardApplicationLinkProviderJson',
    args: {'provider': string, 'idToken': string},
    returns: string,
    description:
        'Links Google or Apple to the current authenticated application user.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<String> superboardApplicationLinkProviderJson(
  String provider,
  String idToken,
) {
  return superboard.superboardApplicationLinkProviderJson(
    provider: provider,
    idToken: idToken,
  );
}
''',
  );

  app.customAction(
    'superboardApplicationSignInAnonymousJson',
    args: {'installationId': string},
    returns: string,
    description: 'Creates or restores an anonymous application session.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<String> superboardApplicationSignInAnonymousJson(String installationId) {
  return superboard.superboardApplicationSignInAnonymousJson(installationId);
}
''',
  );

  app.customAction(
    'superboardApplicationRefreshJson',
    returns: string,
    description: 'Rotates the refresh token held by encrypted native storage.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<String> superboardApplicationRefreshJson() {
  return superboard.superboardApplicationRefreshJson();
}
''',
  );

  app.customAction(
    'superboardApplicationLogoutJson',
    returns: string,
    description: 'Revokes the server session and clears local credentials.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<String> superboardApplicationLogoutJson() {
  return superboard.superboardApplicationLogoutJson();
}
''',
  );

  app.customAction(
    'superboardApplicationDeleteAccountJson',
    returns: string,
    description: 'Deletes the account and clears local credentials.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<String> superboardApplicationDeleteAccountJson() {
  return superboard.superboardApplicationDeleteAccountJson();
}
''',
  );

  final identify = app.customAction(
    'superboardSetAnalyticsUser',
    args: {'userIdentifier': string},
    returns: bool_,
    description: 'Associates a user with SuperBoard analytics.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<bool> superboardSetAnalyticsUser(String userIdentifier) {
  return superboard.superboardIdentify(userIdentifier: userIdentifier);
}
''',
  );

  final identifyFromLibraryState = app.customAction(
    'superboardSetAnalyticsUserFromLibraryState',
    returns: bool_,
    description: 'Internal bridge used by the analytics identity Action Block.',
    code: r'''
import '/flutter_flow/flutter_flow_util.dart';
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<bool> superboardSetAnalyticsUserFromLibraryState() {
  return superboard.superboardIdentify(
    userIdentifier: FFAppState().superboardIdentityUserIdentifier,
  );
}
''',
  );

  app.customAction(
    'superboardSetUserAttributesJson',
    args: {'attributesJson': string},
    returns: bool_,
    description: 'Sends user attributes from a JSON object.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<bool> superboardSetUserAttributesJson(String attributesJson) {
  return superboard.superboardSetUserAttributesJson(attributesJson);
}
''',
  );

  app.customAction(
    'superboardSetPushToken',
    args: {'token': string},
    returns: bool_,
    description: 'Registers the device push token.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<bool> superboardSetPushToken(String token) {
  return superboard.superboardSetPushToken(token);
}
''',
  );

  app.customAction(
    'superboardGenerateLinkJson',
    args: {'paramsJson': string},
    returns: string,
    description: 'Creates an SuperBoard link from JSON parameters.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<String> superboardGenerateLinkJson(String paramsJson) {
  return superboard.superboardGenerateLinkJson(paramsJson);
}
''',
  );

  app.customAction(
    'superboardGetUnreadMessageCount',
    returns: int_,
    description: 'Returns the number of unread SuperBoard messages.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<int> superboardGetUnreadMessageCount() {
  return superboard.superboardGetUnreadMessageCount();
}
''',
  );

  app.customAction(
    'superboardDisplayMessages',
    returns: bool_,
    description: 'Displays the native SuperBoard message center.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<bool> superboardDisplayMessages() {
  return superboard.superboardDisplayMessages();
}
''',
  );

  app.customAction(
    'superboardGetLastDeepLinkJson',
    returns: string,
    description:
        'Returns the latest deep link received by SuperBoardBootstrap as JSON.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<String> superboardGetLastDeepLinkJson() {
  return superboard.superboardGetLastDeepLinkJson();
}
''',
  );

  app.customAction(
    'superboardPurchaseLogout',
    returns: bool_,
    description: 'Clears the local purchase identity.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<bool> superboardPurchaseLogout() {
  return superboard.superboardPurchaseLogout();
}
''',
  );

  final purchase = app.customAction(
    'superboardPurchase',
    args: {
      'packageIdentifier': string,
      'offeringIdentifier': string.withDefault('default'),
    },
    returns: string,
    description:
        'Purchases a package and returns purchased, cancelled, pending, or failed.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<String> superboardPurchase(
  String packageIdentifier,
  String offeringIdentifier,
) {
  return superboard.superboardPurchase(
    packageIdentifier: packageIdentifier,
    offeringIdentifier: offeringIdentifier,
  );
}
''',
  );

  final purchaseFromLibraryState = app.customAction(
    'superboardPurchaseFromLibraryState',
    returns: string,
    description: 'Internal bridge used by the purchase Action Block.',
    code: r'''
import '/flutter_flow/flutter_flow_util.dart';
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<String> superboardPurchaseFromLibraryState() {
  return superboard.superboardPurchase(
    packageIdentifier: FFAppState().superboardPackageIdentifier,
    offeringIdentifier: FFAppState().superboardOfferingIdentifier,
  );
}
''',
  );

  final restore = app.customAction(
    'superboardRestore',
    returns: bool_,
    description: 'Restores and verifies App Store or Google Play purchases.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<bool> superboardRestore() {
  return superboard.superboardRestore();
}
''',
  );

  app.customAction(
    'superboardSync',
    returns: bool_,
    description: 'Synchronizes purchases with SuperBoard.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<bool> superboardSync() {
  return superboard.superboardSync();
}
''',
  );

  app.customAction(
    'superboardHasEntitlement',
    args: {'entitlementIdentifier': string.withDefault('premium')},
    returns: bool_,
    description: 'Checks whether the requested entitlement is active.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<bool> superboardHasEntitlement(String entitlementIdentifier) {
  return superboard.superboardHasEntitlement(entitlementIdentifier);
}
''',
  );

  app.customAction(
    'superboardGetCustomerInfoJson',
    returns: string,
    description: 'Returns only verified JWS CustomerInfo.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<String> superboardGetCustomerInfoJson() {
  return superboard.superboardGetCustomerInfoJson();
}
''',
  );

  app.customAction(
    'superboardOpenSubscriptionManagement',
    returns: bool_,
    description: 'Opens App Store or Google Play subscription management.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<bool> superboardOpenSubscriptionManagement() {
  return superboard.superboardOpenSubscriptionManagement();
}
''',
  );

  app.customAction(
    'superboardGetOfferings',
    args: {'placement': string.withDefault('default')},
    returns: string,
    description: 'Returns offerings and packages as JSON.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<String> superboardGetOfferings(String placement) {
  return superboard.superboardGetOfferings(placement: placement);
}
''',
  );

  app.customAction(
    'superboardApplicationProfileJson',
    returns: string,
    description: 'Returns the authenticated common Identity profile.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<String> superboardApplicationProfileJson() {
  return superboard.superboardApplicationProfileJson();
}
''',
  );

  app.customAction(
    'superboardApplicationUpdateProfileJson',
    args: {'name': string},
    returns: string,
    description: 'Updates the authenticated common Identity profile.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<String> superboardApplicationUpdateProfileJson(String name) {
  return superboard.superboardApplicationUpdateProfileJson(name);
}
''',
  );

  app.customAction(
    'superboardApplicationRequestPasswordResetJson',
    args: {'email': string},
    returns: string,
    description: 'Requests the common Identity password-reset email.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<String> superboardApplicationRequestPasswordResetJson(String email) {
  return superboard.superboardApplicationRequestPasswordResetJson(email);
}
''',
  );

  app.customAction(
    'superboardApplicationResetPasswordJson',
    args: {'token': string, 'password': string},
    returns: string,
    description: 'Completes a common Identity password reset.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<String> superboardApplicationResetPasswordJson(
  String token,
  String password,
) {
  return superboard.superboardApplicationResetPasswordJson(
    token: token,
    password: password,
  );
}
''',
  );

  app.customAction(
    'superboardApplicationRuntimePolicyJson',
    args: {'appVersion': string, 'build': string},
    returns: string,
    description:
        'Loads maintenance and minimum-version policy from the selected target.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<String> superboardApplicationRuntimePolicyJson(
  String appVersion,
  String build,
) {
  return superboard.superboardApplicationRuntimePolicyJson(
    appVersion: appVersion,
    build: build,
  );
}
''',
  );

  app.customAction(
    'superboardApplicationMarketingPreferencesJson',
    returns: string,
    description: 'Returns project-scoped newsletter and consent preferences.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<String> superboardApplicationMarketingPreferencesJson() {
  return superboard.superboardApplicationMarketingPreferencesJson();
}
''',
  );

  app.customAction(
    'superboardApplicationUpdateMarketingConsentJson',
    args: {
      'consented': bool_,
      'idempotencyKey': string,
      'attributesJson': string.withDefault('{}'),
      'listIdsJson': string.withDefault('[]'),
    },
    returns: string,
    description:
        'Updates newsletter consent independently from transactional mail.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<String> superboardApplicationUpdateMarketingConsentJson(
  bool consented,
  String idempotencyKey,
  String attributesJson,
  String listIdsJson,
) {
  return superboard.superboardApplicationUpdateMarketingConsentJson(
    consented: consented,
    idempotencyKey: idempotencyKey,
    attributesJson: attributesJson,
    listIdsJson: listIdsJson,
  );
}
''',
  );

  app.customAction(
    'superboardApplicationListFilesJson',
    args: {'limit': int_.withDefault(50), 'offset': int_.withDefault(0)},
    returns: string,
    description: 'Lists owner-scoped files from the configured Files Worker.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<String> superboardApplicationListFilesJson(int limit, int offset) {
  return superboard.superboardApplicationListFilesJson(
    limit: limit,
    offset: offset,
  );
}
''',
  );

  app.customAction(
    'superboardApplicationUploadFileJson',
    args: {'file': uploadedFile, 'contentType': string},
    returns: string,
    description:
        'Uploads an owner-scoped FlutterFlow file to the configured Files Worker.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<String> superboardApplicationUploadFileJson(
  FFUploadedFile file,
  String contentType,
) {
  final bytes = file.bytes;
  if (bytes == null || bytes.isEmpty) {
    throw StateError('A non-empty FlutterFlow file is required.');
  }
  final filename = file.originalFilename.trim().isNotEmpty
      ? file.originalFilename.trim()
      : file.name?.trim() ?? '';
  if (filename.isEmpty) throw StateError('The upload filename is required.');
  return superboard.superboardApplicationUploadFileJson(
    bytes: bytes,
    filename: filename,
    contentType: contentType,
  );
}
''',
  );

  app.customAction(
    'superboardApplicationDownloadFile',
    args: {'fileId': string, 'filename': string},
    returns: uploadedFile,
    description:
        'Downloads an owner-scoped file from the configured Files Worker.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<FFUploadedFile> superboardApplicationDownloadFile(
  String fileId,
  String filename,
) async {
  final bytes = await superboard.superboardApplicationDownloadFile(fileId);
  return FFUploadedFile(
    name: filename,
    originalFilename: filename,
    bytes: bytes,
  );
}
''',
  );

  app.customAction(
    'superboardApplicationDeleteFileJson',
    args: {'fileId': string},
    returns: string,
    description: 'Deletes an owner-scoped file from the Files Worker.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<String> superboardApplicationDeleteFileJson(String fileId) {
  return superboard.superboardApplicationDeleteFileJson(fileId);
}
''',
  );

  app.customAction(
    'superboardApplicationCreateCustomJobJson',
    args: {
      'capability': string,
      'payloadJson': string,
      'idempotencyKey': string,
    },
    returns: string,
    description: 'Creates one authenticated application-specific job.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<String> superboardApplicationCreateCustomJobJson(
  String capability,
  String payloadJson,
  String idempotencyKey,
) {
  return superboard.superboardApplicationCreateCustomJobJson(
    capability: capability,
    payloadJson: payloadJson,
    idempotencyKey: idempotencyKey,
  );
}
''',
  );

  app.customAction(
    'superboardApplicationListCustomJobsJson',
    args: {
      'limit': int_.withDefault(25),
      'status': string,
      'capability': string,
      'cursor': string,
    },
    returns: string,
    description: 'Lists authenticated application-specific jobs.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<String> superboardApplicationListCustomJobsJson(
  int limit,
  String status,
  String capability,
  String cursor,
) {
  return superboard.superboardApplicationListCustomJobsJson(
    limit: limit,
    status: status,
    capability: capability,
    cursor: cursor,
  );
}
''',
  );

  app.customAction(
    'superboardApplicationGetCustomJobJson',
    args: {'jobId': string},
    returns: string,
    description: 'Returns one owner-scoped application-specific job.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<String> superboardApplicationGetCustomJobJson(String jobId) {
  return superboard.superboardApplicationGetCustomJobJson(jobId);
}
''',
  );

  app.customAction(
    'superboardApplicationCancelCustomJobJson',
    args: {'jobId': string},
    returns: string,
    description: 'Cancels one owner-scoped application-specific job.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

Future<String> superboardApplicationCancelCustomJobJson(String jobId) {
  return superboard.superboardApplicationCancelCustomJobJson(jobId);
}
''',
  );

  app.customAction(
    'superboardSupportInitializeAuthenticated',
    returns: bool_,
    description:
        'Initializes Support from the common encrypted application session.',
    code: r'''
import '/library_values.dart';
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as support;

Future<bool> superboardSupportInitializeAuthenticated() async {
  final accessToken = await superboard.superboardApplicationAccessToken();
  if (accessToken.isEmpty) return false;
  final values = FFLibraryValues();
  final authGatewayUrl = values.authGatewayBaseUrl?.trim() ?? '';
  final supportUrl = values.supportBaseUrl?.trim() ?? '';
  final projectId = values.supportProjectId ?? 0;
  if (authGatewayUrl.isEmpty || supportUrl.isEmpty || projectId <= 0) {
    throw StateError('SuperBoard Support library values are incomplete.');
  }
  return support.superboardSupportInitializeAuthenticated(
    applicationAccessToken: accessToken,
    projectId: projectId,
    authGatewayUrl: authGatewayUrl,
    supportUrl: supportUrl,
  );
}
''',
  );

  app.customAction(
    'superboardSupportGetConfigurationJson',
    returns: string,
    description: 'Returns the target-managed Support presentation policy.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as support;

Future<String> superboardSupportGetConfigurationJson() {
  return support.superboardSupportGetConfigurationJson();
}
''',
  );

  app.customAction(
    'superboardSupportListConversationsJson',
    returns: string,
    description: 'Lists the authenticated user Support conversations.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as support;

Future<String> superboardSupportListConversationsJson() {
  return support.superboardSupportListConversationsJson();
}
''',
  );

  app.customAction(
    'superboardSupportOpenConversation',
    args: {
      'clientConversationId': string,
      'subject': string,
      'inboxId': string,
      'customAttributesJson': string.withDefault('{}'),
    },
    returns: string,
    description: 'Opens one idempotent Support conversation.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as support;

Future<String> superboardSupportOpenConversation(
  String clientConversationId,
  String subject,
  String inboxId,
  String customAttributesJson,
) {
  return support.superboardSupportOpenConversation(
    clientConversationId: clientConversationId,
    subject: subject.trim().isEmpty ? null : subject.trim(),
    inboxId: inboxId.trim().isEmpty ? null : inboxId.trim(),
    customAttributesJson: customAttributesJson,
  );
}
''',
  );

  app.customAction(
    'superboardSupportUpdateConversationJson',
    args: {
      'conversationId': string,
      'status': string,
      'customAttributesJson': string,
    },
    returns: string,
    description: 'Updates status or public custom attributes.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as support;

Future<String> superboardSupportUpdateConversationJson(
  String conversationId,
  String status,
  String customAttributesJson,
) {
  return support.superboardSupportUpdateConversationJson(
    conversationId: conversationId,
    status: status.trim().isEmpty ? null : status.trim(),
    customAttributesJson: customAttributesJson.trim().isEmpty
        ? null
        : customAttributesJson,
  );
}
''',
  );

  app.customAction(
    'superboardSupportMessagesJson',
    args: {
      'conversationId': string,
      'beforeSequence': int_.withDefault(0),
      'limit': int_.withDefault(50),
    },
    returns: string,
    description: 'Loads a bounded page of Support messages.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as support;

Future<String> superboardSupportMessagesJson(
  String conversationId,
  int beforeSequence,
  int limit,
) {
  return support.superboardSupportMessagesJson(
    conversationId,
    beforeSequence: beforeSequence > 0 ? beforeSequence : null,
    limit: limit,
  );
}
''',
  );

  app.customAction(
    'superboardSupportSend',
    args: {'conversationId': string, 'body': string, 'clientMessageId': string},
    returns: string,
    description: 'Sends one idempotent text message.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as support;

Future<String> superboardSupportSend(
  String conversationId,
  String body,
  String clientMessageId,
) {
  return support.superboardSupportSend(
    conversationId: conversationId,
    body: body,
    clientMessageId: clientMessageId,
  );
}
''',
  );

  app.customAction(
    'superboardSupportSendAdvanced',
    args: {
      'conversationId': string,
      'body': string,
      'clientMessageId': string,
      'contentType': string.withDefault('text'),
      'replyToMessageId': string,
      'metadataJson': string.withDefault('{}'),
    },
    returns: string,
    description: 'Sends replies and interactive Support messages.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as support;

Future<String> superboardSupportSendAdvanced(
  String conversationId,
  String body,
  String clientMessageId,
  String contentType,
  String replyToMessageId,
  String metadataJson,
) {
  return support.superboardSupportSendAdvanced(
    conversationId: conversationId,
    body: body,
    clientMessageId: clientMessageId,
    contentType: contentType,
    replyToMessageId: replyToMessageId.trim().isEmpty
        ? null
        : replyToMessageId.trim(),
    metadataJson: metadataJson,
  );
}
''',
  );

  app.customAction(
    'superboardSupportSubmitCsatJson',
    args: {'conversationId': string, 'rating': int_, 'feedback': string},
    returns: string,
    description: 'Submits the authenticated customer satisfaction score.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as support;

Future<String> superboardSupportSubmitCsatJson(
  String conversationId,
  int rating,
  String feedback,
) {
  return support.superboardSupportSubmitCsatJson(
    conversationId: conversationId,
    rating: rating,
    feedback: feedback.trim().isEmpty ? null : feedback.trim(),
  );
}
''',
  );

  app.customAction(
    'superboardSupportUploadAttachmentJson',
    args: {
      'conversationId': string,
      'file': uploadedFile,
      'contentType': string,
    },
    returns: string,
    description: 'Uploads one authenticated Support attachment.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as support;

Future<String> superboardSupportUploadAttachmentJson(
  String conversationId,
  FFUploadedFile file,
  String contentType,
) {
  final bytes = file.bytes;
  if (bytes == null || bytes.isEmpty) {
    throw StateError('A non-empty FlutterFlow file is required.');
  }
  final filename = file.originalFilename.trim().isNotEmpty
      ? file.originalFilename.trim()
      : file.name?.trim() ?? '';
  if (filename.isEmpty) throw StateError('The attachment filename is required.');
  return support.superboardSupportUploadAttachmentJson(
    conversationId: conversationId,
    bytes: bytes,
    filename: filename,
    contentType: contentType,
  );
}
''',
  );

  app.customAction(
    'superboardSupportDownloadAttachment',
    args: {
      'conversationId': string,
      'messageId': string,
      'attachmentId': string,
      'filename': string,
    },
    returns: uploadedFile,
    description: 'Downloads one authenticated Support attachment.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as support;

Future<FFUploadedFile> superboardSupportDownloadAttachment(
  String conversationId,
  String messageId,
  String attachmentId,
  String filename,
) async {
  final bytes = await support.superboardSupportDownloadAttachment(
    conversationId: conversationId,
    messageId: messageId,
    attachmentId: attachmentId.trim().isEmpty ? null : attachmentId.trim(),
  );
  return FFUploadedFile(
    name: filename,
    originalFilename: filename,
    bytes: bytes,
  );
}
''',
  );

  app.customAction(
    'superboardSupportSendAttachment',
    args: {
      'conversationId': string,
      'attachmentJson': string,
      'clientMessageId': string,
      'body': string,
    },
    returns: string,
    description: 'Sends one previously uploaded Support attachment.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as support;

Future<String> superboardSupportSendAttachment(
  String conversationId,
  String attachmentJson,
  String clientMessageId,
  String body,
) {
  return support.superboardSupportSendAttachment(
    conversationId: conversationId,
    attachmentJson: attachmentJson,
    clientMessageId: clientMessageId,
    body: body,
  );
}
''',
  );

  app.customAction(
    'superboardSupportMarkRead',
    args: {'conversationId': string},
    returns: string,
    description: 'Advances the authenticated participant read receipt.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as support;

Future<String> superboardSupportMarkRead(String conversationId) {
  return support.superboardSupportMarkRead(conversationId);
}
''',
  );

  app.customAction(
    'superboardSupportSetTyping',
    args: {'conversationId': string, 'active': bool_},
    returns: bool_,
    description: 'Publishes bounded Support typing state.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as support;

Future<bool> superboardSupportSetTyping(String conversationId, bool active) {
  return support.superboardSupportSetTyping(conversationId, active);
}
''',
  );

  app.customAction(
    'superboardSupportConnectRealtime',
    args: {'conversationId': string},
    returns: bool_,
    description: 'Connects authenticated Support realtime events.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as support;

Future<bool> superboardSupportConnectRealtime(String conversationId) {
  return support.superboardSupportConnectRealtime(conversationId);
}
''',
  );

  app.customAction(
    'superboardSupportDisconnectRealtime',
    returns: bool_,
    description: 'Disconnects Support realtime events.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as support;

Future<bool> superboardSupportDisconnectRealtime() {
  return support.superboardSupportDisconnectRealtime();
}
''',
  );

  app.customAction(
    'superboardSupportGetLastRealtimeEventJson',
    returns: string,
    description: 'Returns the last validated Support realtime event.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as support;

Future<String> superboardSupportGetLastRealtimeEventJson() {
  return support.superboardSupportGetLastRealtimeEventJson();
}
''',
  );

  app.customAction(
    'superboardSupportDispose',
    returns: bool_,
    description: 'Disposes the canonical Support client.',
    code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as support;

Future<bool> superboardSupportDispose() {
  return support.superboardSupportDispose();
}
''',
  );

  app.customWidget(
    'SuperBoardBootstrap',
    parameters: {'projectKey': string, 'sdkBaseUrl': string},
    description:
        'Initializes the common SuperBoard runtime from target-owned Library Values.',
    code: r'''
import 'package:flutter/material.dart';
import '/library_values.dart';
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

class SuperBoardBootstrap extends StatelessWidget {
  const SuperBoardBootstrap({
    super.key,
    this.width,
    this.height,
    this.projectKey,
    this.sdkBaseUrl,
  });

  final double? width;
  final double? height;
  final String? projectKey;
  final String? sdkBaseUrl;

  @override
  Widget build(BuildContext context) {
    final values = FFLibraryValues();
    final resolvedProjectKey = (projectKey?.trim().isNotEmpty == true
            ? projectKey
            : values.projectKey)
        ?.trim() ?? '';
    final resolvedSdkBaseUrl = (sdkBaseUrl?.trim().isNotEmpty == true
            ? sdkBaseUrl
            : values.sdkBaseUrl)
        ?.trim() ?? '';
    final experienceApiBaseUrl = values.authGatewayBaseUrl?.trim() ?? '';
    final environment = values.applicationEnvironment?.trim() ?? '';
    if (resolvedProjectKey.isEmpty ||
        resolvedSdkBaseUrl.isEmpty ||
        experienceApiBaseUrl.isEmpty ||
        environment.isEmpty) {
      throw StateError('SuperBoard sdkBaseUrl is required.');
    }
    return superboard.SuperBoardBootstrap(
      width: width,
      height: height,
      projectKey: resolvedProjectKey,
      sdkBaseUrl: resolvedSdkBaseUrl,
      experienceApiBaseUrl: experienceApiBaseUrl,
      environment: environment,
      initializePurchases: false,
    );
  }
}
''',
  );

  final dynamic superBoardPaywallWidget = app.customWidget(
    'SuperBoardPaywall',
    parameters: {
      'offeringIdentifier': string,
      'title': string,
      'subtitle': string,
      'purchaseLabel': string,
      'restoreLabel': string,
      'successRouteName': string.withDefault('/'),
      'closeRouteName': string.withDefault('/'),
      'unavailableRouteName': string.withDefault('/'),
    },
    description:
        'Renders the target-managed paywall backed by verified common Billing.',
    code: r'''
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

class SuperBoardPaywall extends StatelessWidget {
  const SuperBoardPaywall({
    super.key,
    this.width,
    this.height,
    required this.offeringIdentifier,
    required this.title,
    required this.subtitle,
    required this.purchaseLabel,
    required this.restoreLabel,
    this.successRouteName = '/',
    this.closeRouteName = '/',
    this.unavailableRouteName = '/',
  });

  final double? width;
  final double? height;
  final String offeringIdentifier;
  final String title;
  final String subtitle;
  final String purchaseLabel;
  final String restoreLabel;
  final String successRouteName;
  final String closeRouteName;
  final String unavailableRouteName;

  void _leave(BuildContext context, String routeName) {
    final destination = routeName.trim();
    if (destination.isEmpty) {
      Navigator.of(context).maybePop();
    } else if (destination.startsWith('/')) {
      context.go(destination);
    } else {
      context.goNamed(destination);
    }
  }

  @override
  Widget build(BuildContext context) {
    return superboard.SuperBoardPaywall(
      width: width,
      height: height,
      offeringIdentifier: offeringIdentifier,
      title: title,
      subtitle: subtitle,
      purchaseLabel: purchaseLabel,
      restoreLabel: restoreLabel,
      onPurchased: () => _leave(context, successRouteName),
      onRestored: () => _leave(context, successRouteName),
      onClosed: () => _leave(context, closeRouteName),
      onUnavailable: () => _leave(context, unavailableRouteName),
    );
  }
}
''',
  );

  final dynamic superBoardOnboardingWidget = app.customWidget(
    'SuperBoardOnboarding',
    parameters: {
      'placement': string.withDefault('app_launch'),
      'customerId': string.withDefault(''),
      'anonymousId': string.withDefault(''),
      'appVersion': string.withDefault(''),
      'locale': string.withDefault(''),
      'fallbackTitle': string.withDefault(''),
      'fallbackBody': string.withDefault(''),
      'completionRouteName': string.withDefault('/superboard-paywall'),
      'unavailableRouteName': string.withDefault('/'),
    },
    description:
        'Renders a versioned onboarding and reports every lifecycle event.',
    code: r'''
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

class SuperBoardOnboarding extends StatelessWidget {
  const SuperBoardOnboarding({
    super.key,
    this.width,
    this.height,
    this.placement = 'app_launch',
    this.customerId = '',
    this.anonymousId = '',
    this.appVersion = '',
    this.locale = '',
    this.fallbackTitle = '',
    this.fallbackBody = '',
    this.completionRouteName = '/superboard-paywall',
    this.unavailableRouteName = '/',
  });

  final double? width;
  final double? height;
  final String placement;
  final String customerId;
  final String anonymousId;
  final String appVersion;
  final String locale;
  final String fallbackTitle;
  final String fallbackBody;
  final String completionRouteName;
  final String unavailableRouteName;

  void _leave(BuildContext context, String routeName) {
    final destination = routeName.trim();
    if (destination.isNotEmpty) {
      if (destination.startsWith('/')) {
        context.go(destination);
      } else {
        context.goNamed(destination);
      }
      return;
    }
    Navigator.of(context).maybePop();
  }

  @override
  Widget build(BuildContext context) {
    String? optional(String value) => value.trim().isEmpty ? null : value.trim();
    return superboard.SuperBoardOnboarding(
      width: width,
      height: height,
      placement: placement.trim().isEmpty ? 'app_launch' : placement.trim(),
      customerId: optional(customerId),
      anonymousId: optional(anonymousId),
      appVersion: optional(appVersion),
      locale: optional(locale),
      fallbackTitle: fallbackTitle,
      fallbackBody: fallbackBody,
      onCompleted: () => _leave(context, completionRouteName),
      onSkipped: () => _leave(context, completionRouteName),
      onClosed: () => _leave(context, completionRouteName),
      onUnavailable: () => _leave(context, unavailableRouteName),
    );
  }
}
''',
  );

  app.customWidget(
    'SuperBoardRestorePurchasesButton',
    parameters: {'label': string.withDefault('Restore purchases')},
    description:
        'Restores purchases through the common verified Billing authority.',
    code: r'''
import 'package:flutter/material.dart';
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

class SuperBoardRestorePurchasesButton extends StatelessWidget {
  const SuperBoardRestorePurchasesButton({
    super.key,
    this.width,
    this.height,
    this.label,
  });

  final double? width;
  final double? height;
  final String? label;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      height: height,
      child: superboard.SuperBoardRestorePurchasesButton(
        label: label?.trim().isNotEmpty == true
            ? label!
            : 'Restore purchases',
      ),
    );
  }
}
''',
  );

  final dynamic superBoardCustomerCenterWidget = app.customWidget(
    'SuperBoardCustomerCenter',
    parameters: {'title': string.withDefault('My purchases')},
    description:
        'Displays subscriptions and verified entitlements from common Billing.',
    code: r'''
import 'package:flutter/material.dart';
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as superboard;

class SuperBoardCustomerCenter extends StatelessWidget {
  const SuperBoardCustomerCenter({
    super.key,
    this.width,
    this.height,
    this.title = 'My purchases',
  });

  final double? width;
  final double? height;
  final String title;

  @override
  Widget build(BuildContext context) {
    return superboard.SuperBoardCustomerCenter(
      width: width,
      height: height,
      title: title.trim().isEmpty ? 'My purchases' : title.trim(),
    );
  }
}
''',
  );

  app.ensurePage(
    'SuperBoardPaywallPage',
    route: '/superboard-paywall',
    description:
        'Reusable SuperBoard Paywalls and verified Billing destination.',
    params: {
      'successRouteName': string.withDefault('/'),
      'closeRouteName': string.withDefault('/'),
      'unavailableRouteName': string.withDefault('/'),
    },
    body: Scaffold(
      body: superBoardPaywallWidget(
        name: 'SuperBoardPaywallAuthority',
        offeringIdentifier: AppState('superboardOfferingIdentifier'),
        title: 'Go Premium',
        subtitle: 'Unlock every feature.',
        purchaseLabel: 'Continue',
        restoreLabel: 'Restore purchases',
        successRouteName: const PageParam('successRouteName'),
        closeRouteName: const PageParam('closeRouteName'),
        unavailableRouteName: const PageParam('unavailableRouteName'),
      ),
    ),
  );

  app.ensurePage(
    'SuperBoardOnboardingPage',
    route: '/superboard-onboarding',
    description: 'Reusable target-managed onboarding with lifecycle telemetry.',
    params: {
      'completionRouteName': string.withDefault('/superboard-paywall'),
      'unavailableRouteName': string.withDefault('/'),
      'customerId': string.withDefault(''),
      'locale': string.withDefault(''),
    },
    body: Scaffold(
      body: superBoardOnboardingWidget(
        name: 'SuperBoardOnboardingAuthority',
        placement: 'app_launch',
        customerId: const PageParam('customerId'),
        anonymousId: '',
        appVersion: '',
        locale: const PageParam('locale'),
        fallbackTitle: '',
        fallbackBody: '',
        completionRouteName: const PageParam('completionRouteName'),
        unavailableRouteName: const PageParam('unavailableRouteName'),
      ),
    ),
  );

  app.ensurePage(
    'SuperBoardCustomerCenterPage',
    route: '/superboard-customer-center',
    description:
        'Reusable customer view of verified subscriptions and entitlements.',
    body: Scaffold(
      body: superBoardCustomerCenterWidget(
        name: 'SuperBoardCustomerCenterAuthority',
        title: 'My purchases',
      ),
    ),
  );

  app.raw((project) {
    final replacements = {
      'OGBootstrapBridge': 'SuperBoardBootstrap',
      'OGPaywallBridge': 'SuperBoardPaywall',
      'OGRestoreBridge': 'SuperBoardRestorePurchasesButton',
    };

    void visit(FFNode node, void Function(FFNode node) visitor) {
      visitor(node);
      for (final child in node.children) {
        visit(child, visitor);
      }
    }

    for (final entry in replacements.entries) {
      final legacy = custom_code_helpers.findCustomWidget(
        project,
        name: entry.key,
      );
      if (legacy == null) continue;
      final canonical = custom_code_helpers.findCustomWidget(
        project,
        name: entry.value,
      );
      if (canonical == null) {
        throw StateError('${entry.value} canonical widget was not compiled.');
      }
      final canonicalParameters = {
        for (final parameter in canonical.parameters)
          parameter.identifier.name: parameter,
      };
      for (final widgetClass in project.widgetClasses.values) {
        visit(widgetClass.node, (node) {
          if (!node.hasCustomWidgetIdentifier() ||
              node.customWidgetIdentifier.key != legacy.identifier.key) {
            return;
          }
          node.customWidgetIdentifier = canonical.identifier.deepCopy();
          if (!node.hasParameterValues()) return;
          final remapped = <String, FFParameterPass>{};
          for (final pass in node.parameterValues.parameterPasses.values) {
            final target = canonicalParameters[pass.paramIdentifier.name];
            if (target == null) continue;
            final copy = pass.deepCopy();
            copy.paramIdentifier = target.identifier.deepCopy();
            remapped[target.identifier.key] = copy;
          }
          node.parameterValues.parameterPasses
            ..clear()
            ..addAll(remapped);
        });
      }
      custom_code_helpers.removeCustomWidget(project, name: entry.key);
    }
  });

  app.actionBlock(
    'SuperBoardBuyPackage',
    params: {
      'packageIdentifier': string,
      'offeringIdentifier': string.withDefault('default'),
    },
    returns: string,
    actions: [
      UpdateAppState.set(
        'superboardPackageIdentifier',
        const ActionBlockParam('packageIdentifier'),
      ),
      UpdateAppState.set(
        'superboardOfferingIdentifier',
        const ActionBlockParam('offeringIdentifier'),
      ),
      CallCustomAction(purchaseFromLibraryState, outputAs: 'purchaseOutcome'),
      Terminate(const ActionOutput('purchaseOutcome')),
    ],
    description: 'Purchases a package from an SuperBoard offering.',
  );

  app.actionBlock(
    'SuperBoardRestorePurchases',
    returns: bool_,
    actions: [
      CallCustomAction(restore, outputAs: 'restored'),
      Terminate(const ActionOutput('restored')),
    ],
    description: 'Restores purchases and entitlements.',
  );

  // Keep handles referenced so their declaration intent remains explicit.
  initializeAuthenticated;
  initializeApplication;
  initializeAuthenticatedFromApplicationSession;
  identify;
  identifyFromLibraryState;
  purchase;
  uriSchemeId;
  useTestEnvironmentId;
  shortLinkHostId;
  authGatewayBaseUrlId;
  filesBaseUrlId;
  applicationIdentifierId;
  applicationEnvironmentId;
  supportBaseUrlId;
  supportProjectIdId;
}
