import 'package:flutterflow_ai/flutterflow_ai.dart';
import 'package:flutterflow_ai/src/helpers/action_block_helpers.dart';
import 'package:flutterflow_ai/src/helpers/library_value_helpers.dart';
import 'package:test/test.dart';

import '../dsl/edit.dart' as opengrow;

void main() {
  test('OpenGrow private library DSL compiles', () {
    final app = buildApp(opengrow.buildStarterEditFlow);
    final project = compileApp(app).project;

    expect(findActionBlock(project, name: 'OpenGrowBuyPackage'), isNotNull);
    expect(
      findActionBlock(project, name: 'OpenGrowRestorePurchases'),
      isNotNull,
    );
    expect(
      listLibraryParameters(project).map((parameter) => parameter.name),
      containsAll([
        'projectKey',
        'uriScheme',
        'useTestEnvironment',
        'sdkBaseUrl',
        'authGatewayBaseUrl',
        'filesBaseUrl',
        'applicationIdentifier',
        'applicationEnvironment',
        'supportBaseUrl',
        'supportProjectId',
        'shortLinkHost',
      ]),
    );
    expect(
      project.appState.fields.map((field) => field.parameter.identifier.name),
      isNot(contains('opengrowApplicationAccessToken')),
    );
    expect(
      project.appState.fields.map((field) => field.parameter.identifier.name),
      isNot(contains('opengrowIdentityToken')),
    );
    expect(
      project.appState.fields.map((field) => field.parameter.identifier.name),
      isNot(contains('opengrowVocostarAccessToken')),
    );
    expect(
      project.customCode.customActions.map((action) => action.identifier.name),
      containsAll([
        'opengrowApplicationInitialize',
        'opengrowApplicationRestoreSessionJson',
        'opengrowApplicationSignInPasswordJson',
        'opengrowApplicationSignInProviderJson',
        'opengrowApplicationLinkProviderJson',
        'opengrowApplicationSignInAnonymousJson',
        'opengrowApplicationRuntimePolicyJson',
        'opengrowApplicationUploadFileJson',
        'opengrowApplicationCreateCustomJobJson',
        'opengrowApplicationUpdateMarketingConsentJson',
        'opengrowSupportInitializeAuthenticated',
        'opengrowSupportGetConfigurationJson',
        'opengrowSupportListConversationsJson',
        'opengrowSupportOpenConversation',
        'opengrowSupportUpdateConversationJson',
        'opengrowSupportMessagesJson',
        'opengrowSupportSend',
        'opengrowSupportSendAdvanced',
        'opengrowSupportSubmitCsatJson',
        'opengrowSupportUploadAttachmentJson',
        'opengrowSupportDownloadAttachment',
        'opengrowSupportSendAttachment',
        'opengrowSupportMarkRead',
        'opengrowSupportSetTyping',
        'opengrowSupportConnectRealtime',
        'opengrowSupportDisconnectRealtime',
        'opengrowSupportGetLastRealtimeEventJson',
        'opengrowSupportDispose',
      ]),
    );
    expect(
      project.customCode.customWidgets.map((widget) => widget.identifier.name),
      containsAll([
        'OpenGrowBootstrap',
        'OpenGrowPaywall',
        'OpenGrowOnboarding',
        'OpenGrowRestorePurchasesButton',
        'OpenGrowCustomerCenter',
      ]),
    );
    final widgetNames =
        project.customCode.customWidgets
            .map((widget) => widget.identifier.name)
            .toSet();
    for (final legacy in [
      'OGBootstrapBridge',
      'OGPaywallBridge',
      'OGRestoreBridge',
    ]) {
      expect(widgetNames, isNot(contains(legacy)));
    }
    for (final page in [
      'OpenGrowPaywallPage',
      'OpenGrowOnboardingPage',
      'OpenGrowCustomerCenterPage',
    ]) {
      expect(findPage(project, name: page), isNotNull);
    }
    final sdkDependency = project
        .customCode
        .pubspecPackageInfo
        .pubspecDependencies
        .singleWhere((dependency) => dependency.name == 'opengrow_flutterflow');
    expect(
      sdkDependency.version,
      contains('https://github.com/mbzadev/opengrow-platform.git'),
    );
    expect(sdkDependency.version, contains('sdk-flutterflow-v2.2.4'));
    expect(sdkDependency.version, isNot(contains('git@github.com')));
    final supportDependency = project
        .customCode
        .pubspecPackageInfo
        .pubspecDependencies
        .singleWhere(
          (dependency) => dependency.name == 'opengrow_flutterflow_messaging',
        );
    expect(
      supportDependency.version,
      contains('https://github.com/mbzadev/opengrow-platform.git'),
    );
    expect(
      supportDependency.version,
      contains('sdk-flutterflow-messaging-v1.3.0'),
    );
    expect(supportDependency.version, isNot(contains('git@github.com')));

    final manifest = project.customCode.customFiles.files.singleWhere(
      (file) => file.type == FFCustomFile_Type.ANDROID_MANIFEST,
    );
    expect(
      manifest.hooks.map((hook) => hook.identifier.name),
      containsAll(['OpenGrow Deep Links', 'OpenGrow Native Configuration']),
    );
    expect(
      manifest.parameters.values.map(
        (parameter) => parameter.parameter.identifier.name,
      ),
      containsAll([
        'projectKey',
        'uriScheme',
        'useTestEnvironment',
        'sdkBaseUrl',
        'shortLinkHost',
      ]),
    );
    expect(
      manifest.parameters.values.every(
        (parameter) =>
            parameter.value.variable.source == FFVariableSource.LIBRARY_VALUE,
      ),
      isTrue,
    );

    final infoPlist = project.customCode.customFiles.files.singleWhere(
      (file) => file.type == FFCustomFile_Type.INFO_PLIST,
    );
    expect(
      infoPlist.hooks.single.content,
      contains('<key>OpenGrowApiKey</key>'),
    );

    final entitlements = project.customCode.customFiles.files.singleWhere(
      (file) => file.type == FFCustomFile_Type.ENTITLEMENTS,
    );
    expect(
      entitlements.hooks.single.content,
      contains('applinks:{{shortLinkHost}}'),
    );
  });
}
