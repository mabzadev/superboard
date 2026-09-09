import 'package:flutterflow_ai/flutterflow_ai.dart';
import 'package:flutterflow_ai/src/helpers/action_block_helpers.dart';
import 'package:flutterflow_ai/src/helpers/library_value_helpers.dart';
import 'package:flutterflow_ai/src/helpers/custom_code_helpers.dart'
    as customCode;
import 'package:test/test.dart';

import '../dsl/edit.dart' as superboard;

void main() {
  for (final hasLegacyBindings in [false, true]) {
    test(
      'bootstrap migration repairs ${hasLegacyBindings ? "legacy" : "missing"} library bindings',
      () {
        Iterable<FFNode> nodes(FFNode node) sync* {
          yield node;
          for (final child in node.children) {
            yield* nodes(child);
          }
        }

        final app = buildApp((app) {
          final dynamic legacy = app.customWidget(
            'OGBootstrapBridge',
            parameters: hasLegacyBindings
                ? {'projectKey': string, 'sdkBaseUrl': string}
                : {},
            code: r'''
import 'package:flutter/material.dart';
class OGBootstrapBridge extends StatelessWidget {
  const OGBootstrapBridge({super.key, this.width, this.height, this.projectKey, this.sdkBaseUrl});
  final double? width;
  final double? height;
  final String? projectKey;
  final String? sdkBaseUrl;
  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}
''',
          );
          app.ensurePage(
            'ExistingBootstrap',
            route: '/existing-bootstrap',
            body: Scaffold(
              body: hasLegacyBindings
                  ? legacy(projectKey: '', sdkBaseUrl: '')
                  : legacy(),
            ),
          );
          if (hasLegacyBindings) {
            app.raw((project) {
              final widget = customCode.findCustomWidget(
                project,
                name: 'OGBootstrapBridge',
              )!;
              final node = project.widgetClasses.values
                  .expand((w) => nodes(w.node))
                  .where(
                    (node) =>
                        node.customWidgetIdentifier.name == 'OGBootstrapBridge',
                  )
                  .single;
              for (final entry in {
                'projectKey': 'opengrow_project_key',
                'sdkBaseUrl': 'opengrow_sdk_base_url',
              }.entries) {
                addLibraryParameter(
                  project,
                  name: entry.key,
                  dataType: FFDataTypeV2(scalarType: FFBaseDataType.String),
                );
                final parameter = findLibraryParameter(
                  project,
                  name: entry.key,
                )!;
                parameter.identifier.key = entry.value;
                final target = widget.parameters.firstWhere(
                  (p) => p.identifier.name == entry.key,
                );
                node
                    .ensureParameterValues()
                    .parameterPasses[target.identifier.key] = FFParameterPass(
                  paramIdentifier: target.identifier.deepCopy(),
                  variable: FFVariable(
                    source: FFVariableSource.LIBRARY_VALUE,
                    baseVariable: FFBaseVariable(
                      libraryValue: FFLibraryValueVariable(
                        identifier: parameter.identifier.deepCopy(),
                      ),
                    ),
                  ),
                );
              }
            });
          }
          superboard.buildStarterEditFlow(app);
        });
        final project = compileApp(app).project;
        final bootstrap = project.widgetClasses.values
            .expand((widget) => nodes(widget.node))
            .where(
              (node) =>
                  node.customWidgetIdentifier.name == 'SuperBoardBootstrap',
            )
            .single;
        final bindings = {
          for (final pass in bootstrap.parameterValues.parameterPasses.values)
            pass.paramIdentifier.name: pass.variable,
        };
        for (final name in ['projectKey', 'sdkBaseUrl']) {
          expect(bindings[name]?.source, FFVariableSource.LIBRARY_VALUE);
          expect(
            bindings[name]?.baseVariable.libraryValue.identifier,
            findLibraryParameter(project, name: name)!.identifier,
          );
        }
      },
    );
  }

  test('SuperBoard private library DSL compiles', () {
    final app = buildApp(superboard.buildStarterEditFlow);
    final project = compileApp(app).project;

    expect(project.name, 'SuperBoard');

    expect(findActionBlock(project, name: 'SuperBoardBuyPackage'), isNotNull);
    expect(
      findActionBlock(project, name: 'SuperBoardRestorePurchases'),
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
      isNot(contains('superboardApplicationAccessToken')),
    );
    expect(
      project.appState.fields.map((field) => field.parameter.identifier.name),
      isNot(contains('superboardIdentityToken')),
    );
    expect(
      project.appState.fields.map((field) => field.parameter.identifier.name),
      isNot(contains('superboardVocostarAccessToken')),
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
        'superboardApplicationInitialize',
        'superboardApplicationRestoreSessionJson',
        'superboardApplicationSignInPasswordJson',
        'superboardApplicationSignInProviderJson',
        'superboardApplicationLinkProviderJson',
        'superboardApplicationSignInAnonymousJson',
        'superboardApplicationRuntimePolicyJson',
        'superboardApplicationUploadFileJson',
        'superboardApplicationCreateCustomJobJson',
        'superboardApplicationUpdateMarketingConsentJson',
        'superboardSupportInitializeAuthenticated',
        'superboardSupportGetConfigurationJson',
        'superboardSupportListConversationsJson',
        'superboardSupportOpenConversation',
        'superboardSupportUpdateConversationJson',
        'superboardSupportMessagesJson',
        'superboardSupportSend',
        'superboardSupportSendAdvanced',
        'superboardSupportSubmitCsatJson',
        'superboardSupportUploadAttachmentJson',
        'superboardSupportDownloadAttachment',
        'superboardSupportSendAttachment',
        'superboardSupportMarkRead',
        'superboardSupportSetTyping',
        'superboardSupportConnectRealtime',
        'superboardSupportDisconnectRealtime',
        'superboardSupportGetLastRealtimeEventJson',
        'superboardSupportDispose',
      ]),
    );
    expect(
      project.customCode.customWidgets.map((widget) => widget.identifier.name),
      containsAll([
        'SuperBoardBootstrap',
        'SuperBoardPaywall',
        'SuperBoardOnboarding',
        'SuperBoardRestorePurchasesButton',
        'SuperBoardCustomerCenter',
      ]),
    );
    final widgetNames = project.customCode.customWidgets
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
      'SuperBoardPaywallPage',
      'SuperBoardOnboardingPage',
      'SuperBoardCustomerCenterPage',
    ]) {
      expect(findPage(project, name: page), isNotNull);
    }
    final sdkDependency = project
        .customCode
        .pubspecPackageInfo
        .pubspecDependencies
        .singleWhere(
          (dependency) => dependency.name == 'superboard_flutterflow',
        );
    expect(
      sdkDependency.version,
      contains('https://github.com/mabzadev/superboard.git'),
    );
    expect(sdkDependency.version, contains('sdk-flutterflow-v3.0.0'));
    expect(sdkDependency.version, isNot(contains('git@github.com')));

    final manifest = project.customCode.customFiles.files.singleWhere(
      (file) => file.type == FFCustomFile_Type.ANDROID_MANIFEST,
    );
    expect(
      manifest.hooks.map((hook) => hook.identifier.name),
      containsAll(['SuperBoard Deep Links', 'SuperBoard Native Configuration']),
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
      contains('<key>SuperBoardApiKey</key>'),
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
