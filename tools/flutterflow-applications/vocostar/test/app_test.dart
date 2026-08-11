import 'package:flutterflow_ai/flutterflow_ai.dart';
import 'package:flutterflow_ai/src/helpers/api_helpers.dart' as api_helpers;
import 'package:flutterflow_ai/src/helpers/custom_code_helpers.dart'
    as custom_code_helpers;
import 'package:flutterflow_ai/src/helpers/action_block_helpers.dart'
    as action_block_helpers;
import 'package:flutterflow_ai/src/helpers/app_event_helpers.dart'
    as app_event_helpers;
import 'package:flutterflow_ai/src/helpers/data_schema_helpers.dart'
    as data_schema_helpers;
import 'package:flutterflow_ai/src/helpers/data_type_helpers.dart';
import 'package:flutterflow_ai/src/helpers/project_helpers.dart'
    as project_helpers;
import 'package:flutterflow_ai/src/helpers/pub_dependency_helpers.dart'
    as pub_dependency_helpers;
import 'package:flutterflow_ai/src/ui/actions.dart' as ui_actions;
import 'package:flutterflow_ai/src/ui/ui.dart';
import 'package:test/test.dart';

import '../dsl/edit.dart' as application;
import '../dsl/migration.dart' as migration;
import '../generated/application_bindings.dart';

void main() {
  test('VocoStar binds the complete SuperBoard library contract', () {
    final app = buildApp(
      (app) => application.buildApplicationConfigurationFor(
        app,
        libraryProjectId: 'test-opengrow-library',
        environment: const {'SUPERBOARD_PROJECT_KEY': 'test-public-client-key'},
      ),
    );
    final project = compileApp(app).project;
    final configured = project.appSettings.librarySettings.libraryValues;

    expect(configured, hasLength(superBoardLibraryBindings.length));
    for (final expected in superBoardLibraryBindings) {
      final actual = configured.singleWhere(
        (value) => value.parameter.identifier.name == expected.name,
      );
      expect(actual.parameter.identifier.key, expected.key);
      expect(actual.parameter.identifier.projectId, 'test-opengrow-library');
      expect(
        actual.value.inputValue.serializedValue,
        application.resolveSuperBoardLibraryBinding(expected, const {
          'SUPERBOARD_PROJECT_KEY': 'test-public-client-key',
        }),
      );
    }
  });

  test('an empty library project identifier fails closed', () {
    expect(
      () => buildApp(
        (app) => application.buildApplicationConfigurationFor(
          app,
          libraryProjectId: '  ',
        ),
      ),
      throwsArgumentError,
    );
  });

  test('a missing protected project key fails closed', () {
    expect(
      () => compileApp(
        buildApp(
          (app) => application.buildApplicationConfigurationFor(
            app,
            libraryProjectId: 'test-opengrow-library',
            environment: const {},
          ),
        ),
      ),
      throwsA(
        isA<StateError>().having(
          (error) => error.message,
          'message',
          contains('SUPERBOARD_PROJECT_KEY'),
        ),
      ),
    );
  });

  test('the VocoStar migration is secure, complete and idempotent', () {
    final project = FFProject();
    _seedLegacyVocoStar(project);

    migration.migrateVocoStarProject(
      project,
      libraryProjectId: 'test-opengrow-library',
      onboardingPageKey: 'library_onboarding_page',
    );
    migration.migrateVocoStarProject(
      project,
      libraryProjectId: 'test-opengrow-library',
      onboardingPageKey: 'library_onboarding_page',
    );

    final actions = project.customCode.customActions
        .map((action) => action.identifier.name)
        .toSet();
    expect(actions, contains('superboardApplicationUploadFileJson'));
    expect(actions, contains('superboardApplicationCreateCustomJobJson'));
    expect(actions, contains('superboardSupportInitializeAuthenticated'));
    expect(actions, contains('superboardRegisterPushDevice'));
    expect(actions, contains('superboardLogoutSession'));
    expect(actions, isNot(contains('userMediaUpload')));
    expect(actions, isNot(contains('userMediaConverter')));
    expect(actions, isNot(contains('userMediaRemove')));
    expect(actions, isNot(contains('supportInit')));
    expect(actions, isNot(contains('supportFetchMessages')));
    expect(actions, isNot(contains('supportSendMessage')));
    expect(actions, isNot(contains('userFCMToken')));

    final widgets = project.customCode.customWidgets
        .map((widget) => widget.identifier.name)
        .toSet();
    expect(widgets, contains('SuperBoardSupportChatWidget'));
    expect(widgets, isNot(contains('SupportChatWidget')));

    for (final page in [
      'onboard00',
      'onboard01',
      'onboard02',
      'onboard03',
      'onboard04',
      'onboard05',
    ]) {
      expect(project_helpers.findPage(project, name: page), isNull);
    }
    expect(
      app_event_helpers.findAppEvent(project, name: 'getAppOnBoarding'),
      isNull,
    );
    expect(
      action_block_helpers.findActionBlock(project, name: 'getAppOnBording'),
      isNull,
    );
    final home = project_helpers.findPage(project, name: 'FixtureHome')!;
    final onboardingNavigation =
        home.node.triggerActions.single.rootAction.action.navigate;
    expect(onboardingNavigation.pageNodeKeyRef.key, 'library_onboarding_page');
    expect(
      onboardingNavigation.pageNodeKeyRef.dependencyProjectId,
      'test-opengrow-library',
    );
    expect(
      onboardingNavigation
          .passedParameters
          .widgetClassNodeKeyRef
          .dependencyProjectId,
      'test-opengrow-library',
    );
    final onboardingRoute = project.libraryConfigurations
        .singleWhere(
          (configuration) => configuration.projectId == 'test-opengrow-library',
        )
        .routeOverrides
        .singleWhere((route) => route.pageKey == 'library_onboarding_page');
    expect(
      onboardingRoute.routePath.inputValue.serializedValue,
      '/superboard-onboarding',
    );

    for (final forbidden in [
      'authAccessToken',
      'authRefreshToken',
      'authExpiresIn',
      'supportContactId',
      'supportConversationId',
      'supportMessages',
      'supportPubsubToken',
      'supportUnreadCount',
      'userFcmToken',
    ]) {
      expect(
        data_schema_helpers.findAppStateField(project, name: forbidden),
        isNull,
      );
    }
    for (final transient in [
      'superboardAccessTokenTransient',
      'superboardRefreshTokenUnavailable',
      'superboardTokenExpirationTransient',
      'superboardPushTokenTransient',
    ]) {
      final field = data_schema_helpers.findAppStateField(
        project,
        name: transient,
      );
      expect(field, isNotNull);
      expect(field!.persisted, isFalse);
    }
    expect(project.appState.securePersistedValues, isTrue);

    final source = [
      ...project.customCode.customActions.map((action) => action.code),
      ...project.customCode.customWidgets.map((widget) => widget.code),
    ].join('\n');
    expect(source, isNot(contains('sup.vocostar.com')));
    expect(source, isNot(contains('file.vocostar.com')));
    expect(source, isNot(contains('.workers.dev')));
    expect(source, contains('superboardApplicationRestoreSessionJson'));
    expect(source, contains('superboardApplicationSignInProviderJson'));
    expect(source, contains('superboardApplicationRuntimePolicyJson'));
    expect(source, contains('superboardSetPushToken'));
    expect(source, contains('superboardApplicationDeleteAccountJson'));
    expect(source, contains('superboardApplicationLogoutJson'));
    expect(source, contains('superboardPurchaseLogout'));
    expect(source, isNot(contains('/clean/user')));

    expect(
      api_helpers.findApiEndpoint(
        project,
        name: 'auth Logout',
        groupName: 'Vocostar API Gateway',
      ),
      isNull,
    );
    final accountFixture = project_helpers.findPage(
      project,
      name: 'AccountFixture',
    )!;
    final logoutNode = accountFixture.node.triggerActions.single.rootAction;
    expect(logoutNode.key, 'fixture_logout_node');
    expect(logoutNode.action.hasCustomCodeCall(), isTrue);
    expect(
      logoutNode.action.customCodeCall.identifier.name,
      'superboardLogoutSession',
    );
    expect(logoutNode.hasFollowUpAction(), isTrue);
    expect(logoutNode.followUpAction.action.hasSnackBar(), isTrue);

    final dependencies =
        project.customCode.pubspecPackageInfo.pubspecDependencies;
    expect(
      dependencies.where(
        (dependency) => const {
          'opengrow_flutterflow',
          'opengrow_flutterflow_messaging',
        }.contains(dependency.name),
      ),
      isEmpty,
    );
    final superBoardDependency = dependencies.singleWhere(
      (dependency) => dependency.name == 'superboard_flutterflow',
    );
    expect(superBoardDependency.version, contains('sdk-flutterflow-v3.0.0'));
    expect(
      superBoardDependency.version,
      isNot(contains('flutterflow_messaging')),
    );
    expect(
      dependencies.where(
        (dependency) => dependency.name == 'superboard_flutterflow',
      ),
      hasLength(1),
    );
  });
}

void _seedLegacyVocoStar(FFProject project) {
  pub_dependency_helpers.addPubDependency(
    project,
    name: 'opengrow_flutterflow',
    version: 'legacy-v2-fixture',
  );
  pub_dependency_helpers.addPubDependency(
    project,
    name: 'opengrow_flutterflow_messaging',
    version: 'legacy-v1-fixture',
  );
  for (final field in [
    ('authAccessToken', stringType, true),
    ('authRefreshToken', stringType, true),
    ('authExpiresIn', dateTimeType, true),
    ('supportContactId', stringType, true),
    ('supportConversationId', intType, false),
    ('supportMessages', jsonType, false),
    ('supportPubsubToken', stringType, true),
    ('supportUnreadCount', intType, true),
    ('userFcmToken', stringType, true),
  ]) {
    data_schema_helpers.addAppStateField(
      project,
      name: field.$1,
      type: field.$2,
      description: 'legacy fixture',
      persisted: field.$3,
    );
  }

  void action(
    String name,
    String code, {
    List<FFParameter> arguments = const [],
    FFParameter? returns,
  }) {
    custom_code_helpers.addCustomAction(
      project,
      name: name,
      code: code,
      arguments: arguments,
      returnParameter: returns,
      description: 'legacy fixture',
    );
  }

  FFParameter parameter(String name, FFDataTypeV2 type) => FFParameter(
    identifier: FFIdentifier(name: name, key: 'fixture_$name'),
    dataType: type,
  );

  action('initApp', 'Future<void> initApp() async {}');
  action(
    'userAuthenticate',
    'Future<bool> userAuthenticate() async => true;',
    returns: parameter('result', boolType),
  );
  action(
    'userRefreshAuth',
    'Future<bool> userRefreshAuth() async => true;',
    returns: parameter('result', boolType),
  );
  for (final provider in ['signlinkWithGoogle', 'signlinkWithApple']) {
    action(
      provider,
      'Future<String> $provider(String mode, String bearer) async => "";',
      arguments: [
        parameter('mode', stringType),
        parameter('bearer', stringType),
      ],
      returns: parameter('result', stringType),
    );
  }
  for (final policy in ['appCheckMaintenance', 'appCheckUpdate']) {
    action(
      policy,
      'Future<bool> $policy(String bearerAuth) async => false;',
      arguments: [parameter('bearerAuth', stringType)],
      returns: parameter('result', boolType),
    );
  }
  action(
    'userFCMToken',
    'Future<void> userFCMToken(String bearer) async {}',
    arguments: [parameter('bearer', stringType)],
  );
  action(
    'userCleanManager',
    'Future<bool> userCleanManager(String bearer, String type, String id) async => false;',
    arguments: [
      parameter('bearer', stringType),
      parameter('type', stringType),
      parameter('id', stringType),
    ],
    returns: parameter('result', boolType),
  );
  action(
    'userMediaUpload',
    'Future<String?> userMediaUpload(String? userMediaPath, String? userId, String? bearerToken) async => null;',
    arguments: [
      parameter('userMediaPath', stringType),
      parameter('userId', stringType),
      parameter('bearerToken', stringType),
    ],
    returns: parameter('result', stringType),
  );
  action(
    'userMediaConverter',
    'Future<String?> userMediaConverter(String bearer, String vocalId, String mediaType, String vocalType, dynamic input, int credits) async => null;',
    arguments: [
      parameter('bearer', stringType),
      parameter('vocalId', stringType),
      parameter('mediaType', stringType),
      parameter('vocalType', stringType),
      parameter('input', jsonType),
      parameter('credits', intType),
    ],
    returns: parameter('result', stringType),
  );
  action(
    'userMediaRemove',
    'Future<String?> userMediaRemove(String a, String b, String c, String d) async => null;',
    arguments: [
      parameter('mediaId', stringType),
      parameter('mediaType', stringType),
      parameter('mediaOutput', stringType),
      parameter('mediaInput', stringType),
    ],
    returns: parameter('result', stringType),
  );
  action('supportInit', 'Future<void> supportInit() async {}');
  action(
    'supportFetchMessages',
    'Future<void> supportFetchMessages() async {}',
  );
  action(
    'supportSendMessage',
    'Future<bool> supportSendMessage(String message) async => true;',
    arguments: [parameter('message', stringType)],
    returns: parameter('result', boolType),
  );

  custom_code_helpers.addCustomWidget(
    project,
    name: 'SupportChatWidget',
    code: r'''
import 'package:flutter/material.dart';
class SupportChatWidget extends StatelessWidget {
  const SupportChatWidget({super.key, this.width, this.height});
  final double? width;
  final double? height;
  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}
''',
    description: 'legacy fixture',
  );

  final legacyOnboardingKeys = <String, String>{};
  for (final name in [
    'onboard00',
    'onboard01',
    'onboard02',
    'onboard03',
    'onboard04',
    'onboard05',
  ]) {
    legacyOnboardingKeys[name] = project_helpers.addPage(
      project,
      name: name,
      route: '/$name',
      description: 'legacy onboarding fixture',
      body: UI.scaffold(),
    );
  }
  action_block_helpers.addActionBlock(
    project,
    name: 'getAppOnBording',
    rootAction: ui_actions.Actions.chain([
      ui_actions.Actions.snackBar('legacy onboarding loader'),
    ]),
    description: 'legacy onboarding loader',
  );
  final eventIdentifier = app_event_helpers.addAppEvent(
    project,
    name: 'getAppOnBoarding',
    description: 'legacy onboarding event',
    handlerActionBlockName: 'getAppOnBording',
  );
  project_helpers.addPage(
    project,
    name: 'FixtureHome',
    route: '/fixture-home',
    description: 'onboarding caller fixture',
    body: UI.scaffold()
      ..triggerActions.add(
        FFTriggerActions(
          rootAction: FFActionNode(
            key: 'fixture_event_node',
            action: FFAction(
              key: 'fixture_event_action',
              triggerAppEventAction: FFTriggerAppEventAction(
                appEventIdentifier: eventIdentifier,
              ),
            ),
            followUpAction: FFActionNode(
              key: 'fixture_navigation_node',
              action: FFAction(
                key: 'fixture_navigation_action',
                navigate: FFNavigateAction(
                  pageNodeKeyRef: FFNodeKeyReference(
                    key: legacyOnboardingKeys['onboard00'],
                  ),
                  passedParameters: FFPassedParameters(
                    widgetClassNodeKeyRef: FFNodeKeyReference(
                      key: legacyOnboardingKeys['onboard00'],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
  );

  api_helpers.addApiGroup(project, name: 'Vocostar API Gateway');
  final logoutIdentifier = api_helpers.addEndpointToGroup(
    project,
    groupName: 'Vocostar API Gateway',
    name: 'auth Logout',
    url: '/auth/logout',
    method: FFApiEndpoint_CallType.POST,
  );
  project_helpers.addPage(
    project,
    name: 'AccountFixture',
    route: '/account-fixture',
    description: 'legacy logout caller fixture',
    body: UI.scaffold()
      ..triggerActions.add(
        FFTriggerActions(
          rootAction: FFActionNode(
            key: 'fixture_logout_node',
            action: FFAction(
              key: 'fixture_logout_action',
              database: FFDatabaseAction(
                apiCall: FFApiCall(
                  endpointIdentifier: logoutIdentifier.deepCopy(),
                ),
              ),
            ),
            followUpAction: FFActionNode(
              key: 'fixture_logout_follow_up_node',
              action: ui_actions.Actions.snackBar('logged out'),
            ),
          ),
        ),
      ),
  );
}
