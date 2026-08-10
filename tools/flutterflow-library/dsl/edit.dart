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
    key: 'opengrow_project_key',
  );
  final uriSchemeId = FFIdentifier(
    name: 'uriScheme',
    key: 'opengrow_uri_scheme',
  );
  final useTestEnvironmentId = FFIdentifier(
    name: 'useTestEnvironment',
    key: 'opengrow_use_test_environment',
  );
  final sdkBaseUrlId = FFIdentifier(
    name: 'sdkBaseUrl',
    key: 'opengrow_sdk_base_url',
  );
  final authGatewayBaseUrlId = FFIdentifier(
    name: 'authGatewayBaseUrl',
    key: 'opengrow_auth_gateway_base_url',
  );
  final filesBaseUrlId = FFIdentifier(
    name: 'filesBaseUrl',
    key: 'opengrow_files_base_url',
  );
  final applicationIdentifierId = FFIdentifier(
    name: 'applicationIdentifier',
    key: 'opengrow_application_identifier',
  );
  final applicationEnvironmentId = FFIdentifier(
    name: 'applicationEnvironment',
    key: 'opengrow_application_environment',
  );
  final supportBaseUrlId = FFIdentifier(
    name: 'supportBaseUrl',
    key: 'opengrow_support_base_url',
  );
  final supportProjectIdId = FFIdentifier(
    name: 'supportProjectId',
    key: 'opengrow_support_project_id',
  );
  final shortLinkHostId = FFIdentifier(
    name: 'shortLinkHost',
    key: 'opengrow_short_link_host',
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
      file.parameters['opengrow_${file.type.value}_$key'] =
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
      name: 'OpenGrow Deep Links',
      key: 'opengrow_android_deep_links',
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
      name: 'OpenGrow Native Configuration',
      key: 'opengrow_android_native_configuration',
      type: FFCustomFile_Hook_Type.MANIFEST_APP_COMPONENT_TAG,
      content: r'''
<meta-data
  android:name="opengrow_api_key"
  android:value="{{projectKey}}" />
<meta-data
  android:name="opengrow_base_url"
  android:value="{{sdkBaseUrl}}" />
<meta-data
  android:name="opengrow_use_test_environment"
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
      name: 'OpenGrow Native Configuration',
      key: 'opengrow_ios_native_configuration',
      type: FFCustomFile_Hook_Type.INFO_PLIST_PROPERTY,
      content: r'''
<key>OpenGrowApiKey</key>
<string>{{projectKey}}</string>
<key>OpenGrowUseTestEnvironment</key>
<{{useTestEnvironment}}/>
<key>OpenGrowBaseURL</key>
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
      name: 'OpenGrow Associated Domain',
      key: 'opengrow_ios_associated_domain',
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

  app.state('opengrowIdentityUserIdentifier', string.withDefault(''));
  app.state('opengrowPackageIdentifier', string.withDefault(''));
  app.state('opengrowOfferingIdentifier', string.withDefault('default'));

  app.raw((project) {
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
    final sdkDependency =
        r'''
git:
  url: https://github.com/mbzadev/opengrow-platform.git
  ref: sdk-flutterflow-v2.2.5
  path: sdks/flutterflow
'''.trim();
    if (pub_dependency_helpers.findPubDependency(
          project,
          name: 'opengrow_flutterflow',
        ) ==
        null) {
      pub_dependency_helpers.addPubDependency(
        project,
        name: 'opengrow_flutterflow',
        version: sdkDependency,
      );
    } else {
      pub_dependency_helpers.updatePubDependency(
        project,
        name: 'opengrow_flutterflow',
        newVersion: sdkDependency,
      );
    }
    final supportDependency =
        r'''
git:
  url: https://github.com/mbzadev/opengrow-platform.git
  ref: sdk-flutterflow-messaging-v1.3.0
  path: sdks/flutterflow_messaging
'''.trim();
    if (pub_dependency_helpers.findPubDependency(
          project,
          name: 'opengrow_flutterflow_messaging',
        ) ==
        null) {
      pub_dependency_helpers.addPubDependency(
        project,
        name: 'opengrow_flutterflow_messaging',
        version: supportDependency,
      );
    } else {
      pub_dependency_helpers.updatePubDependency(
        project,
        name: 'opengrow_flutterflow_messaging',
        newVersion: supportDependency,
      );
    }
    if (action_block_helpers.findActionBlock(
          project,
          name: 'OpenGrowIdentifyUser',
        ) !=
        null) {
      action_block_helpers.removeActionBlock(
        project,
        name: 'OpenGrowIdentifyUser',
      );
    }
  });

  final initializeAuthenticated = app.customAction(
    'opengrowInitializeAuthenticated',
    args: {'applicationAccessToken': string},
    returns: bool_,
    description:
        'Initializes Purchases through the configured application authentication gateway.',
    code: r'''
import '/library_values.dart';
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<bool> opengrowInitializeAuthenticated(String applicationAccessToken) {
  final values = FFLibraryValues();
  final projectKey = values.projectKey?.trim() ?? '';
  if (projectKey.isEmpty) {
    throw StateError('OpenGrow projectKey library value is required.');
  }
  final sdkBaseUrl = values.sdkBaseUrl?.trim() ?? '';
  if (sdkBaseUrl.isEmpty) {
    throw StateError('OpenGrow sdkBaseUrl library value is required.');
  }
  final authGatewayBaseUrl = values.authGatewayBaseUrl?.trim() ?? '';
  if (authGatewayBaseUrl.isEmpty) {
    throw StateError('OpenGrow authGatewayBaseUrl library value is required.');
  }
  return opengrow.opengrowInitializeAuthenticated(
    projectKey: projectKey,
    applicationAccessToken: applicationAccessToken,
    sdkBaseUrl: sdkBaseUrl,
    authGatewayBaseUrl: authGatewayBaseUrl,
  );
}
''',
  );

  final initializeApplication = app.customAction(
    'opengrowApplicationInitialize',
    returns: bool_,
    description:
        'Initializes the common application gateway and restores its encrypted native session.',
    code: r'''
import '/library_values.dart';
import 'package:flutter/foundation.dart';
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<bool> opengrowApplicationInitialize() {
  final values = FFLibraryValues();
  final projectKey = values.projectKey?.trim() ?? '';
  if (projectKey.isEmpty) {
    throw StateError('OpenGrow projectKey library value is required.');
  }
  final apiBaseUrl = values.authGatewayBaseUrl?.trim() ?? '';
  if (apiBaseUrl.isEmpty) {
    throw StateError('OpenGrow authGatewayBaseUrl library value is required.');
  }
  final filesBaseUrl = values.filesBaseUrl?.trim() ?? '';
  if (filesBaseUrl.isEmpty) {
    throw StateError('OpenGrow filesBaseUrl library value is required.');
  }
  final identifier = values.applicationIdentifier?.trim() ?? '';
  if (identifier.isEmpty) {
    throw StateError('OpenGrow applicationIdentifier library value is required.');
  }
  return opengrow.opengrowApplicationInitialize(
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
    'opengrowInitializeAuthenticatedFromApplicationSession',
    returns: bool_,
    description:
        'Initializes Purchases with the ephemeral access token restored by the SDK session manager.',
    code: r'''
import '/library_values.dart';
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<bool> opengrowInitializeAuthenticatedFromApplicationSession() async {
  final accessToken = await opengrow.opengrowApplicationAccessToken();
  if (accessToken.isEmpty) return false;
  final values = FFLibraryValues();
  final projectKey = values.projectKey?.trim() ?? '';
  final sdkBaseUrl = values.sdkBaseUrl?.trim() ?? '';
  final authGatewayBaseUrl = values.authGatewayBaseUrl?.trim() ?? '';
  if (projectKey.isEmpty || sdkBaseUrl.isEmpty || authGatewayBaseUrl.isEmpty) {
    throw StateError('OpenGrow authenticated library values are incomplete.');
  }
  return opengrow.opengrowInitializeAuthenticated(
    projectKey: projectKey,
    applicationAccessToken: accessToken,
    sdkBaseUrl: sdkBaseUrl,
    authGatewayBaseUrl: authGatewayBaseUrl,
  );
}
''',
  );

  app.customAction(
    'opengrowApplicationRestoreSessionJson',
    returns: string,
    description: 'Restores and rotates the encrypted application session.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String> opengrowApplicationRestoreSessionJson() {
  return opengrow.opengrowApplicationRestoreSessionJson();
}
''',
  );

  app.customAction(
    'opengrowApplicationCurrentSessionJson',
    returns: string,
    description:
        'Returns the current session without exposing the secure refresh token.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String> opengrowApplicationCurrentSessionJson() {
  return opengrow.opengrowApplicationCurrentSessionJson();
}
''',
  );

  app.customAction(
    'opengrowApplicationAccessToken',
    returns: string,
    description:
        'Returns the current access token as an ephemeral action result.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String> opengrowApplicationAccessToken() {
  return opengrow.opengrowApplicationAccessToken();
}
''',
  );

  app.customAction(
    'opengrowApplicationRegisterJson',
    args: {'email': string, 'password': string, 'name': string},
    returns: string,
    description: 'Registers an application user and secures the new session.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String> opengrowApplicationRegisterJson(
  String email,
  String password,
  String name,
) {
  return opengrow.opengrowApplicationRegisterJson(
    email: email,
    password: password,
    name: name,
  );
}
''',
  );

  app.customAction(
    'opengrowApplicationSignInPasswordJson',
    args: {'email': string, 'password': string},
    returns: string,
    description: 'Signs in with email and stores the session securely.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String> opengrowApplicationSignInPasswordJson(
  String email,
  String password,
) {
  return opengrow.opengrowApplicationSignInPasswordJson(
    email: email,
    password: password,
  );
}
''',
  );

  app.customAction(
    'opengrowApplicationSignInProviderJson',
    args: {'provider': string, 'idToken': string, 'name': string},
    returns: string,
    description: 'Signs in with Google or Apple and secures the session.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String> opengrowApplicationSignInProviderJson(
  String provider,
  String idToken,
  String name,
) {
  return opengrow.opengrowApplicationSignInProviderJson(
    provider: provider,
    idToken: idToken,
    name: name,
  );
}
''',
  );

  app.customAction(
    'opengrowApplicationLinkProviderJson',
    args: {'provider': string, 'idToken': string},
    returns: string,
    description:
        'Links Google or Apple to the current authenticated application user.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String> opengrowApplicationLinkProviderJson(
  String provider,
  String idToken,
) {
  return opengrow.opengrowApplicationLinkProviderJson(
    provider: provider,
    idToken: idToken,
  );
}
''',
  );

  app.customAction(
    'opengrowApplicationSignInAnonymousJson',
    args: {'installationId': string},
    returns: string,
    description: 'Creates or restores an anonymous application session.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String> opengrowApplicationSignInAnonymousJson(String installationId) {
  return opengrow.opengrowApplicationSignInAnonymousJson(installationId);
}
''',
  );

  app.customAction(
    'opengrowApplicationRefreshJson',
    returns: string,
    description: 'Rotates the refresh token held by encrypted native storage.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String> opengrowApplicationRefreshJson() {
  return opengrow.opengrowApplicationRefreshJson();
}
''',
  );

  app.customAction(
    'opengrowApplicationLogoutJson',
    returns: string,
    description: 'Revokes the server session and clears local credentials.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String> opengrowApplicationLogoutJson() {
  return opengrow.opengrowApplicationLogoutJson();
}
''',
  );

  app.customAction(
    'opengrowApplicationDeleteAccountJson',
    returns: string,
    description: 'Deletes the account and clears local credentials.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String> opengrowApplicationDeleteAccountJson() {
  return opengrow.opengrowApplicationDeleteAccountJson();
}
''',
  );

  final identify = app.customAction(
    'opengrowSetAnalyticsUser',
    args: {'userIdentifier': string},
    returns: bool_,
    description: 'Associates a user with OpenGrow analytics.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<bool> opengrowSetAnalyticsUser(String userIdentifier) {
  return opengrow.opengrowIdentify(userIdentifier: userIdentifier);
}
''',
  );

  final identifyFromLibraryState = app.customAction(
    'opengrowSetAnalyticsUserFromLibraryState',
    returns: bool_,
    description: 'Internal bridge used by the analytics identity Action Block.',
    code: r'''
import '/flutter_flow/flutter_flow_util.dart';
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<bool> opengrowSetAnalyticsUserFromLibraryState() {
  return opengrow.opengrowIdentify(
    userIdentifier: FFAppState().opengrowIdentityUserIdentifier,
  );
}
''',
  );

  app.customAction(
    'opengrowSetUserAttributesJson',
    args: {'attributesJson': string},
    returns: bool_,
    description: 'Sends user attributes from a JSON object.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<bool> opengrowSetUserAttributesJson(String attributesJson) {
  return opengrow.opengrowSetUserAttributesJson(attributesJson);
}
''',
  );

  app.customAction(
    'opengrowSetPushToken',
    args: {'token': string},
    returns: bool_,
    description: 'Registers the device push token.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<bool> opengrowSetPushToken(String token) {
  return opengrow.opengrowSetPushToken(token);
}
''',
  );

  app.customAction(
    'opengrowGenerateLinkJson',
    args: {'paramsJson': string},
    returns: string,
    description: 'Creates an OpenGrow link from JSON parameters.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String> opengrowGenerateLinkJson(String paramsJson) {
  return opengrow.opengrowGenerateLinkJson(paramsJson);
}
''',
  );

  app.customAction(
    'opengrowGetUnreadMessageCount',
    returns: int_,
    description: 'Returns the number of unread OpenGrow messages.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<int> opengrowGetUnreadMessageCount() {
  return opengrow.opengrowGetUnreadMessageCount();
}
''',
  );

  app.customAction(
    'opengrowDisplayMessages',
    returns: bool_,
    description: 'Displays the native OpenGrow message center.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<bool> opengrowDisplayMessages() {
  return opengrow.opengrowDisplayMessages();
}
''',
  );

  app.customAction(
    'opengrowGetLastDeepLinkJson',
    returns: string,
    description:
        'Returns the latest deep link received by OpenGrowBootstrap as JSON.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String> opengrowGetLastDeepLinkJson() {
  return opengrow.opengrowGetLastDeepLinkJson();
}
''',
  );

  app.customAction(
    'opengrowPurchaseLogout',
    returns: bool_,
    description: 'Clears the local purchase identity.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<bool> opengrowPurchaseLogout() {
  return opengrow.opengrowPurchaseLogout();
}
''',
  );

  final purchase = app.customAction(
    'opengrowPurchase',
    args: {
      'packageIdentifier': string,
      'offeringIdentifier': string.withDefault('default'),
    },
    returns: string,
    description:
        'Purchases a package and returns purchased, cancelled, pending, or failed.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String> opengrowPurchase(
  String packageIdentifier,
  String offeringIdentifier,
) {
  return opengrow.opengrowPurchase(
    packageIdentifier: packageIdentifier,
    offeringIdentifier: offeringIdentifier,
  );
}
''',
  );

  final purchaseFromLibraryState = app.customAction(
    'opengrowPurchaseFromLibraryState',
    returns: string,
    description: 'Internal bridge used by the purchase Action Block.',
    code: r'''
import '/flutter_flow/flutter_flow_util.dart';
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String> opengrowPurchaseFromLibraryState() {
  return opengrow.opengrowPurchase(
    packageIdentifier: FFAppState().opengrowPackageIdentifier,
    offeringIdentifier: FFAppState().opengrowOfferingIdentifier,
  );
}
''',
  );

  final restore = app.customAction(
    'opengrowRestore',
    returns: bool_,
    description: 'Restores and verifies App Store or Google Play purchases.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<bool> opengrowRestore() {
  return opengrow.opengrowRestore();
}
''',
  );

  app.customAction(
    'opengrowSync',
    returns: bool_,
    description: 'Synchronizes purchases with OpenGrow.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<bool> opengrowSync() {
  return opengrow.opengrowSync();
}
''',
  );

  app.customAction(
    'opengrowHasEntitlement',
    args: {'entitlementIdentifier': string.withDefault('premium')},
    returns: bool_,
    description: 'Checks whether the requested entitlement is active.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<bool> opengrowHasEntitlement(String entitlementIdentifier) {
  return opengrow.opengrowHasEntitlement(entitlementIdentifier);
}
''',
  );

  app.customAction(
    'opengrowGetCustomerInfoJson',
    returns: string,
    description: 'Returns only verified JWS CustomerInfo.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String> opengrowGetCustomerInfoJson() {
  return opengrow.opengrowGetCustomerInfoJson();
}
''',
  );

  app.customAction(
    'opengrowOpenSubscriptionManagement',
    returns: bool_,
    description: 'Opens App Store or Google Play subscription management.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<bool> opengrowOpenSubscriptionManagement() {
  return opengrow.opengrowOpenSubscriptionManagement();
}
''',
  );

  app.customAction(
    'opengrowGetOfferings',
    args: {'placement': string.withDefault('default')},
    returns: string,
    description: 'Returns offerings and packages as JSON.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String> opengrowGetOfferings(String placement) {
  return opengrow.opengrowGetOfferings(placement: placement);
}
''',
  );

  app.customAction(
    'opengrowApplicationProfileJson',
    returns: string,
    description: 'Returns the authenticated common Identity profile.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String> opengrowApplicationProfileJson() {
  return opengrow.opengrowApplicationProfileJson();
}
''',
  );

  app.customAction(
    'opengrowApplicationUpdateProfileJson',
    args: {'name': string},
    returns: string,
    description: 'Updates the authenticated common Identity profile.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String> opengrowApplicationUpdateProfileJson(String name) {
  return opengrow.opengrowApplicationUpdateProfileJson(name);
}
''',
  );

  app.customAction(
    'opengrowApplicationRequestPasswordResetJson',
    args: {'email': string},
    returns: string,
    description: 'Requests the common Identity password-reset email.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String> opengrowApplicationRequestPasswordResetJson(String email) {
  return opengrow.opengrowApplicationRequestPasswordResetJson(email);
}
''',
  );

  app.customAction(
    'opengrowApplicationResetPasswordJson',
    args: {'token': string, 'password': string},
    returns: string,
    description: 'Completes a common Identity password reset.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String> opengrowApplicationResetPasswordJson(
  String token,
  String password,
) {
  return opengrow.opengrowApplicationResetPasswordJson(
    token: token,
    password: password,
  );
}
''',
  );

  app.customAction(
    'opengrowApplicationRuntimePolicyJson',
    args: {'appVersion': string, 'build': string},
    returns: string,
    description:
        'Loads maintenance and minimum-version policy from the selected target.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String> opengrowApplicationRuntimePolicyJson(
  String appVersion,
  String build,
) {
  return opengrow.opengrowApplicationRuntimePolicyJson(
    appVersion: appVersion,
    build: build,
  );
}
''',
  );

  app.customAction(
    'opengrowApplicationMarketingPreferencesJson',
    returns: string,
    description: 'Returns project-scoped newsletter and consent preferences.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String> opengrowApplicationMarketingPreferencesJson() {
  return opengrow.opengrowApplicationMarketingPreferencesJson();
}
''',
  );

  app.customAction(
    'opengrowApplicationUpdateMarketingConsentJson',
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
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String> opengrowApplicationUpdateMarketingConsentJson(
  bool consented,
  String idempotencyKey,
  String attributesJson,
  String listIdsJson,
) {
  return opengrow.opengrowApplicationUpdateMarketingConsentJson(
    consented: consented,
    idempotencyKey: idempotencyKey,
    attributesJson: attributesJson,
    listIdsJson: listIdsJson,
  );
}
''',
  );

  app.customAction(
    'opengrowApplicationListFilesJson',
    args: {'limit': int_.withDefault(50), 'offset': int_.withDefault(0)},
    returns: string,
    description: 'Lists owner-scoped files from the configured Files Worker.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String> opengrowApplicationListFilesJson(int limit, int offset) {
  return opengrow.opengrowApplicationListFilesJson(
    limit: limit,
    offset: offset,
  );
}
''',
  );

  app.customAction(
    'opengrowApplicationUploadFileJson',
    args: {'file': uploadedFile, 'contentType': string},
    returns: string,
    description:
        'Uploads an owner-scoped FlutterFlow file to the configured Files Worker.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String> opengrowApplicationUploadFileJson(
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
  return opengrow.opengrowApplicationUploadFileJson(
    bytes: bytes,
    filename: filename,
    contentType: contentType,
  );
}
''',
  );

  app.customAction(
    'opengrowApplicationDownloadFile',
    args: {'fileId': string, 'filename': string},
    returns: uploadedFile,
    description:
        'Downloads an owner-scoped file from the configured Files Worker.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<FFUploadedFile> opengrowApplicationDownloadFile(
  String fileId,
  String filename,
) async {
  final bytes = await opengrow.opengrowApplicationDownloadFile(fileId);
  return FFUploadedFile(
    name: filename,
    originalFilename: filename,
    bytes: bytes,
  );
}
''',
  );

  app.customAction(
    'opengrowApplicationDeleteFileJson',
    args: {'fileId': string},
    returns: string,
    description: 'Deletes an owner-scoped file from the Files Worker.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String> opengrowApplicationDeleteFileJson(String fileId) {
  return opengrow.opengrowApplicationDeleteFileJson(fileId);
}
''',
  );

  app.customAction(
    'opengrowApplicationCreateCustomJobJson',
    args: {
      'capability': string,
      'payloadJson': string,
      'idempotencyKey': string,
    },
    returns: string,
    description: 'Creates one authenticated application-specific job.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String> opengrowApplicationCreateCustomJobJson(
  String capability,
  String payloadJson,
  String idempotencyKey,
) {
  return opengrow.opengrowApplicationCreateCustomJobJson(
    capability: capability,
    payloadJson: payloadJson,
    idempotencyKey: idempotencyKey,
  );
}
''',
  );

  app.customAction(
    'opengrowApplicationListCustomJobsJson',
    args: {
      'limit': int_.withDefault(25),
      'status': string,
      'capability': string,
      'cursor': string,
    },
    returns: string,
    description: 'Lists authenticated application-specific jobs.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String> opengrowApplicationListCustomJobsJson(
  int limit,
  String status,
  String capability,
  String cursor,
) {
  return opengrow.opengrowApplicationListCustomJobsJson(
    limit: limit,
    status: status,
    capability: capability,
    cursor: cursor,
  );
}
''',
  );

  app.customAction(
    'opengrowApplicationGetCustomJobJson',
    args: {'jobId': string},
    returns: string,
    description: 'Returns one owner-scoped application-specific job.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String> opengrowApplicationGetCustomJobJson(String jobId) {
  return opengrow.opengrowApplicationGetCustomJobJson(jobId);
}
''',
  );

  app.customAction(
    'opengrowApplicationCancelCustomJobJson',
    args: {'jobId': string},
    returns: string,
    description: 'Cancels one owner-scoped application-specific job.',
    code: r'''
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

Future<String> opengrowApplicationCancelCustomJobJson(String jobId) {
  return opengrow.opengrowApplicationCancelCustomJobJson(jobId);
}
''',
  );

  app.customAction(
    'opengrowSupportInitializeAuthenticated',
    returns: bool_,
    description:
        'Initializes Support from the common encrypted application session.',
    code: r'''
import '/library_values.dart';
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;
import 'package:opengrow_flutterflow_messaging/opengrow_flutterflow_messaging.dart' as support;

Future<bool> opengrowSupportInitializeAuthenticated() async {
  final accessToken = await opengrow.opengrowApplicationAccessToken();
  if (accessToken.isEmpty) return false;
  final values = FFLibraryValues();
  final authGatewayUrl = values.authGatewayBaseUrl?.trim() ?? '';
  final supportUrl = values.supportBaseUrl?.trim() ?? '';
  final projectId = values.supportProjectId ?? 0;
  if (authGatewayUrl.isEmpty || supportUrl.isEmpty || projectId <= 0) {
    throw StateError('OpenGrow Support library values are incomplete.');
  }
  return support.opengrowSupportInitializeAuthenticated(
    applicationAccessToken: accessToken,
    projectId: projectId,
    authGatewayUrl: authGatewayUrl,
    supportUrl: supportUrl,
  );
}
''',
  );

  app.customAction(
    'opengrowSupportGetConfigurationJson',
    returns: string,
    description: 'Returns the target-managed Support presentation policy.',
    code: r'''
import 'package:opengrow_flutterflow_messaging/opengrow_flutterflow_messaging.dart' as support;

Future<String> opengrowSupportGetConfigurationJson() {
  return support.opengrowSupportGetConfigurationJson();
}
''',
  );

  app.customAction(
    'opengrowSupportListConversationsJson',
    returns: string,
    description: 'Lists the authenticated user Support conversations.',
    code: r'''
import 'package:opengrow_flutterflow_messaging/opengrow_flutterflow_messaging.dart' as support;

Future<String> opengrowSupportListConversationsJson() {
  return support.opengrowSupportListConversationsJson();
}
''',
  );

  app.customAction(
    'opengrowSupportOpenConversation',
    args: {
      'clientConversationId': string,
      'subject': string,
      'inboxId': string,
      'customAttributesJson': string.withDefault('{}'),
    },
    returns: string,
    description: 'Opens one idempotent Support conversation.',
    code: r'''
import 'package:opengrow_flutterflow_messaging/opengrow_flutterflow_messaging.dart' as support;

Future<String> opengrowSupportOpenConversation(
  String clientConversationId,
  String subject,
  String inboxId,
  String customAttributesJson,
) {
  return support.opengrowSupportOpenConversation(
    clientConversationId: clientConversationId,
    subject: subject.trim().isEmpty ? null : subject.trim(),
    inboxId: inboxId.trim().isEmpty ? null : inboxId.trim(),
    customAttributesJson: customAttributesJson,
  );
}
''',
  );

  app.customAction(
    'opengrowSupportUpdateConversationJson',
    args: {
      'conversationId': string,
      'status': string,
      'customAttributesJson': string,
    },
    returns: string,
    description: 'Updates status or public custom attributes.',
    code: r'''
import 'package:opengrow_flutterflow_messaging/opengrow_flutterflow_messaging.dart' as support;

Future<String> opengrowSupportUpdateConversationJson(
  String conversationId,
  String status,
  String customAttributesJson,
) {
  return support.opengrowSupportUpdateConversationJson(
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
    'opengrowSupportMessagesJson',
    args: {
      'conversationId': string,
      'beforeSequence': int_.withDefault(0),
      'limit': int_.withDefault(50),
    },
    returns: string,
    description: 'Loads a bounded page of Support messages.',
    code: r'''
import 'package:opengrow_flutterflow_messaging/opengrow_flutterflow_messaging.dart' as support;

Future<String> opengrowSupportMessagesJson(
  String conversationId,
  int beforeSequence,
  int limit,
) {
  return support.opengrowSupportMessagesJson(
    conversationId,
    beforeSequence: beforeSequence > 0 ? beforeSequence : null,
    limit: limit,
  );
}
''',
  );

  app.customAction(
    'opengrowSupportSend',
    args: {'conversationId': string, 'body': string, 'clientMessageId': string},
    returns: string,
    description: 'Sends one idempotent text message.',
    code: r'''
import 'package:opengrow_flutterflow_messaging/opengrow_flutterflow_messaging.dart' as support;

Future<String> opengrowSupportSend(
  String conversationId,
  String body,
  String clientMessageId,
) {
  return support.opengrowSupportSend(
    conversationId: conversationId,
    body: body,
    clientMessageId: clientMessageId,
  );
}
''',
  );

  app.customAction(
    'opengrowSupportSendAdvanced',
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
import 'package:opengrow_flutterflow_messaging/opengrow_flutterflow_messaging.dart' as support;

Future<String> opengrowSupportSendAdvanced(
  String conversationId,
  String body,
  String clientMessageId,
  String contentType,
  String replyToMessageId,
  String metadataJson,
) {
  return support.opengrowSupportSendAdvanced(
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
    'opengrowSupportSubmitCsatJson',
    args: {'conversationId': string, 'rating': int_, 'feedback': string},
    returns: string,
    description: 'Submits the authenticated customer satisfaction score.',
    code: r'''
import 'package:opengrow_flutterflow_messaging/opengrow_flutterflow_messaging.dart' as support;

Future<String> opengrowSupportSubmitCsatJson(
  String conversationId,
  int rating,
  String feedback,
) {
  return support.opengrowSupportSubmitCsatJson(
    conversationId: conversationId,
    rating: rating,
    feedback: feedback.trim().isEmpty ? null : feedback.trim(),
  );
}
''',
  );

  app.customAction(
    'opengrowSupportUploadAttachmentJson',
    args: {
      'conversationId': string,
      'file': uploadedFile,
      'contentType': string,
    },
    returns: string,
    description: 'Uploads one authenticated Support attachment.',
    code: r'''
import 'package:opengrow_flutterflow_messaging/opengrow_flutterflow_messaging.dart' as support;

Future<String> opengrowSupportUploadAttachmentJson(
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
  return support.opengrowSupportUploadAttachmentJson(
    conversationId: conversationId,
    bytes: bytes,
    filename: filename,
    contentType: contentType,
  );
}
''',
  );

  app.customAction(
    'opengrowSupportDownloadAttachment',
    args: {
      'conversationId': string,
      'messageId': string,
      'attachmentId': string,
      'filename': string,
    },
    returns: uploadedFile,
    description: 'Downloads one authenticated Support attachment.',
    code: r'''
import 'package:opengrow_flutterflow_messaging/opengrow_flutterflow_messaging.dart' as support;

Future<FFUploadedFile> opengrowSupportDownloadAttachment(
  String conversationId,
  String messageId,
  String attachmentId,
  String filename,
) async {
  final bytes = await support.opengrowSupportDownloadAttachment(
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
    'opengrowSupportSendAttachment',
    args: {
      'conversationId': string,
      'attachmentJson': string,
      'clientMessageId': string,
      'body': string,
    },
    returns: string,
    description: 'Sends one previously uploaded Support attachment.',
    code: r'''
import 'package:opengrow_flutterflow_messaging/opengrow_flutterflow_messaging.dart' as support;

Future<String> opengrowSupportSendAttachment(
  String conversationId,
  String attachmentJson,
  String clientMessageId,
  String body,
) {
  return support.opengrowSupportSendAttachment(
    conversationId: conversationId,
    attachmentJson: attachmentJson,
    clientMessageId: clientMessageId,
    body: body,
  );
}
''',
  );

  app.customAction(
    'opengrowSupportMarkRead',
    args: {'conversationId': string},
    returns: string,
    description: 'Advances the authenticated participant read receipt.',
    code: r'''
import 'package:opengrow_flutterflow_messaging/opengrow_flutterflow_messaging.dart' as support;

Future<String> opengrowSupportMarkRead(String conversationId) {
  return support.opengrowSupportMarkRead(conversationId);
}
''',
  );

  app.customAction(
    'opengrowSupportSetTyping',
    args: {'conversationId': string, 'active': bool_},
    returns: bool_,
    description: 'Publishes bounded Support typing state.',
    code: r'''
import 'package:opengrow_flutterflow_messaging/opengrow_flutterflow_messaging.dart' as support;

Future<bool> opengrowSupportSetTyping(String conversationId, bool active) {
  return support.opengrowSupportSetTyping(conversationId, active);
}
''',
  );

  app.customAction(
    'opengrowSupportConnectRealtime',
    args: {'conversationId': string},
    returns: bool_,
    description: 'Connects authenticated Support realtime events.',
    code: r'''
import 'package:opengrow_flutterflow_messaging/opengrow_flutterflow_messaging.dart' as support;

Future<bool> opengrowSupportConnectRealtime(String conversationId) {
  return support.opengrowSupportConnectRealtime(conversationId);
}
''',
  );

  app.customAction(
    'opengrowSupportDisconnectRealtime',
    returns: bool_,
    description: 'Disconnects Support realtime events.',
    code: r'''
import 'package:opengrow_flutterflow_messaging/opengrow_flutterflow_messaging.dart' as support;

Future<bool> opengrowSupportDisconnectRealtime() {
  return support.opengrowSupportDisconnectRealtime();
}
''',
  );

  app.customAction(
    'opengrowSupportGetLastRealtimeEventJson',
    returns: string,
    description: 'Returns the last validated Support realtime event.',
    code: r'''
import 'package:opengrow_flutterflow_messaging/opengrow_flutterflow_messaging.dart' as support;

Future<String> opengrowSupportGetLastRealtimeEventJson() {
  return support.opengrowSupportGetLastRealtimeEventJson();
}
''',
  );

  app.customAction(
    'opengrowSupportDispose',
    returns: bool_,
    description: 'Disposes the canonical Support client.',
    code: r'''
import 'package:opengrow_flutterflow_messaging/opengrow_flutterflow_messaging.dart' as support;

Future<bool> opengrowSupportDispose() {
  return support.opengrowSupportDispose();
}
''',
  );

  app.customWidget(
    'OpenGrowBootstrap',
    parameters: {'projectKey': string, 'sdkBaseUrl': string},
    description:
        'Initializes the common OpenGrow runtime from target-owned Library Values.',
    code: r'''
import 'package:flutter/material.dart';
import '/library_values.dart';
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

class OpenGrowBootstrap extends StatelessWidget {
  const OpenGrowBootstrap({
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
      throw StateError('OpenGrow sdkBaseUrl is required.');
    }
    return opengrow.OpenGrowBootstrap(
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

  final dynamic openGrowPaywallWidget = app.customWidget(
    'OpenGrowPaywall',
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
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

class OpenGrowPaywall extends StatelessWidget {
  const OpenGrowPaywall({
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
    return opengrow.OpenGrowPaywall(
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

  final dynamic openGrowOnboardingWidget = app.customWidget(
    'OpenGrowOnboarding',
    parameters: {
      'placement': string.withDefault('app_launch'),
      'customerId': string.withDefault(''),
      'anonymousId': string.withDefault(''),
      'appVersion': string.withDefault(''),
      'locale': string.withDefault(''),
      'fallbackTitle': string.withDefault(''),
      'fallbackBody': string.withDefault(''),
      'completionRouteName': string.withDefault('/opengrow-paywall'),
      'unavailableRouteName': string.withDefault('/'),
    },
    description:
        'Renders a versioned onboarding and reports every lifecycle event.',
    code: r'''
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

class OpenGrowOnboarding extends StatelessWidget {
  const OpenGrowOnboarding({
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
    this.completionRouteName = '/opengrow-paywall',
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
    return opengrow.OpenGrowOnboarding(
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
    'OpenGrowRestorePurchasesButton',
    parameters: {'label': string.withDefault('Restore purchases')},
    description:
        'Restores purchases through the common verified Billing authority.',
    code: r'''
import 'package:flutter/material.dart';
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

class OpenGrowRestorePurchasesButton extends StatelessWidget {
  const OpenGrowRestorePurchasesButton({
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
      child: opengrow.OpenGrowRestorePurchasesButton(
        label: label?.trim().isNotEmpty == true
            ? label!
            : 'Restore purchases',
      ),
    );
  }
}
''',
  );

  final dynamic openGrowCustomerCenterWidget = app.customWidget(
    'OpenGrowCustomerCenter',
    parameters: {'title': string.withDefault('My purchases')},
    description:
        'Displays subscriptions and verified entitlements from common Billing.',
    code: r'''
import 'package:flutter/material.dart';
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart' as opengrow;

class OpenGrowCustomerCenter extends StatelessWidget {
  const OpenGrowCustomerCenter({
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
    return opengrow.OpenGrowCustomerCenter(
      width: width,
      height: height,
      title: title.trim().isEmpty ? 'My purchases' : title.trim(),
    );
  }
}
''',
  );

  app.ensurePage(
    'OpenGrowPaywallPage',
    route: '/opengrow-paywall',
    description: 'Reusable OpenGrow Paywalls and verified Billing destination.',
    params: {
      'successRouteName': string.withDefault('/'),
      'closeRouteName': string.withDefault('/'),
      'unavailableRouteName': string.withDefault('/'),
    },
    body: Scaffold(
      body: openGrowPaywallWidget(
        name: 'OpenGrowPaywallAuthority',
        offeringIdentifier: AppState('opengrowOfferingIdentifier'),
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
    'OpenGrowOnboardingPage',
    route: '/opengrow-onboarding',
    description: 'Reusable target-managed onboarding with lifecycle telemetry.',
    params: {
      'completionRouteName': string.withDefault('/opengrow-paywall'),
      'unavailableRouteName': string.withDefault('/'),
      'customerId': string.withDefault(''),
      'locale': string.withDefault(''),
    },
    body: Scaffold(
      body: openGrowOnboardingWidget(
        name: 'OpenGrowOnboardingAuthority',
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
    'OpenGrowCustomerCenterPage',
    route: '/opengrow-customer-center',
    description:
        'Reusable customer view of verified subscriptions and entitlements.',
    body: Scaffold(
      body: openGrowCustomerCenterWidget(
        name: 'OpenGrowCustomerCenterAuthority',
        title: 'My purchases',
      ),
    ),
  );

  app.raw((project) {
    final replacements = {
      'OGBootstrapBridge': 'OpenGrowBootstrap',
      'OGPaywallBridge': 'OpenGrowPaywall',
      'OGRestoreBridge': 'OpenGrowRestorePurchasesButton',
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
    'OpenGrowBuyPackage',
    params: {
      'packageIdentifier': string,
      'offeringIdentifier': string.withDefault('default'),
    },
    returns: string,
    actions: [
      UpdateAppState.set(
        'opengrowPackageIdentifier',
        const ActionBlockParam('packageIdentifier'),
      ),
      UpdateAppState.set(
        'opengrowOfferingIdentifier',
        const ActionBlockParam('offeringIdentifier'),
      ),
      CallCustomAction(purchaseFromLibraryState, outputAs: 'purchaseOutcome'),
      Terminate(const ActionOutput('purchaseOutcome')),
    ],
    description: 'Purchases a package from an OpenGrow offering.',
  );

  app.actionBlock(
    'OpenGrowRestorePurchases',
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
