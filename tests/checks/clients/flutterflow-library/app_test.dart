import 'package:flutterflow_ai/flutterflow_ai.dart';
import 'package:flutterflow_ai/src/helpers/action_block_helpers.dart';
import 'package:flutterflow_ai/src/helpers/library_value_helpers.dart';
import 'package:flutterflow_ai/src/helpers/custom_code_helpers.dart'
    as customCode;
import 'package:test/test.dart';

import '../../../../scripts/clients/flutterflow-library/dsl/edit.dart' as superboard;

void main() {
  test(
    'upgrading the managed library preserves identifiers and unrelated pages',
    () {
      final project = compileApp(
        buildApp((app) {
          superboard.buildStarterEditFlow(app);
          app.ensurePage(
            'UnrelatedPage',
            route: '/unrelated',
            body: Scaffold(body: Text('Keep this page')),
          );
        }),
      ).project;
      final widget = customCode.findCustomWidget(
        project,
        name: 'SuperBoardPaywall',
      )!;
      final widgetKey = widget.identifier.key;
      final expectedWidget = widget.code;
      widget.code = widget.code.replaceFirst('Go Premium', 'Previous title');
      final action = customCode.findCustomAction(
        project,
        name: 'superboardGetCustomerInfoJson',
      )!;
      final actionKey = action.identifier.key;
      final expectedAction = action.code;
      action.code = '${action.code}\n// Earlier revision\n';

      compileApp(buildApp(superboard.buildManagedLibrary), project: project);

      expect(
        customCode
            .findCustomWidget(project, name: 'SuperBoardPaywall')!
            .identifier
            .key,
        widgetKey,
      );
      expect(
        customCode.findCustomWidget(project, name: 'SuperBoardPaywall')!.code,
        expectedWidget,
      );
      expect(
        customCode
            .findCustomAction(project, name: 'superboardGetCustomerInfoJson')!
            .identifier
            .key,
        actionKey,
      );
      expect(
        customCode
            .findCustomAction(project, name: 'superboardGetCustomerInfoJson')!
            .code,
        expectedAction,
      );
      expect(findPage(project, name: 'UnrelatedPage'), isNotNull);
    },
  );

  test('legacy actions retain their identity under the SuperBoard brand', () {
    String? previousKey;
    final app = buildApp((app) {
      app.customAction(
        'superboardGetCustomerInfoJson',
        returns: string,
        code: r'''
import 'package:superboard_flutterflow/superboard_flutterflow.dart' as legacy;
Future<String> superboardGetCustomerInfoJson() => legacy.superboardGetCustomerInfoJson();
''',
      );
      app.raw((project) {
        previousKey = customCode
            .findCustomAction(project, name: 'superboardGetCustomerInfoJson')!
            .identifier
            .key;
      });
      superboard.buildStarterEditFlow(app);
    });
    final project = compileApp(app).project;
    final action = customCode.findCustomAction(
      project,
      name: 'superboardLibraryGetCustomerInfoJson',
    )!;
    expect(action.identifier.key, previousKey);
    expect(
      action.code,
      contains('package:superboard_flutterflow/superboard_flutterflow.dart'),
    );
    expect(action.code, contains('legacy.superboardGetCustomerInfoJson()'));
    expect(action.code, isNot(contains('package:superboard_flutterflow/')));
    expect(action.code, contains('superboardLibraryGetCustomerInfoJson()'));
    expect(
      customCode.findCustomAction(
        project,
        name: 'superboardGetCustomerInfoJson',
      ),
      isNull,
    );
  });

  test(
    'branding migration preserves state, action and navigation bindings',
    () {
      final project = compileApp(
        buildApp((app) {
          app.state(
            'superboardPackageIdentifier',
            string.withDefault('annual'),
          );
          final action = app.customAction(
            'superboardReadPackage',
            returns: string,
            code: r'''
import '../../../../../../../../flutter_flow/flutter_flow_util.dart';
Future<String> superboardReadPackage() async => FFAppState().superboardPackageIdentifier;
''',
          );
          app.ensurePage(
            'SuperBoardPaywallPage',
            route: '/superboard-paywall',
            body: Scaffold(
              body: Column(
                children: [
                  Text('SuperBoard Premium', name: 'OGPaywallBridge'),
                  Button(
                    'Read',
                    onTap: [CallCustomAction(action, outputAs: 'package')],
                  ),
                ],
              ),
            ),
          );
          app.ensurePage(
            'Entry',
            route: '/entry',
            body: Scaffold(
              body: Button('Open', onTap: [Navigate('SuperBoardPaywallPage')]),
            ),
          );
        }),
      ).project;
      final pageKey = findPage(
        project,
        name: 'SuperBoardPaywallPage',
      )!.node.key;
      final identifiers = allProtosOfType<FFIdentifier>(
        project,
      ).map((identifier) => identifier.key).toList();
      final nodeKeys = allProtosOfType<FFNode>(
        project,
      ).map((node) => node.key).toList();

      superboard.migrateLibraryBranding(project);

      expect(
        findPage(project, name: 'SuperBoardLibraryPaywallPage')!.node.key,
        pageKey,
      );
      expect(
        allProtosOfType<FFIdentifier>(project).map((id) => id.key),
        identifiers,
      );
      expect(
        allProtosOfType<FFNode>(project).map((node) => node.key),
        nodeKeys,
      );
      expect(
        project.writeToJson(),
        isNot(matches(r'SuperBoard|superboard|OGPaywall')),
      );
      final code = customCode
          .findCustomAction(project, name: 'superboardLibraryReadPackage')!
          .code;
      expect(code, contains('FFAppState().superboardLibraryPackageIdentifier'));
      final migrated = project.writeToBuffer();
      superboard.migrateLibraryBranding(project);
      expect(project.writeToBuffer(), migrated);
    },
  );

  test(
    'native configuration removes replaced hooks and preserves other hooks',
    () {
      final project = compileApp(
        buildApp(superboard.buildStarterEditFlow),
      ).project;
      final file = project.customCode.customFiles.files.first;
      final canonical = file.hooks.first;
      final old = canonical.deepCopy();
      old.identifier.name = old.identifier.name.replaceFirst(
        'SuperBoard',
        'SuperBoard',
      );
      old.identifier.key = 'old-hook';
      old.content = old.content.replaceAll('superboard_', 'superboard_');
      final unrelated = FFCustomFile_Hook(
        identifier: FFIdentifier(
          name: 'Application configuration',
          key: 'application-hook',
        ),
        content: '<application-setting/>',
        type: canonical.type,
      );
      file.hooks.addAll([old, unrelated]);
      final canonicalBytes = canonical.writeToBuffer();
      superboard.migrateLibraryBranding(project);
      expect(
        file.hooks.where((hook) => hook.identifier.key == 'old-hook'),
        isEmpty,
      );
      expect(canonical.writeToBuffer(), canonicalBytes);
      expect(file.hooks, contains(unrelated));
    },
  );

  test('branding collisions fail before changing the project', () {
    final project = compileApp(
      buildApp((app) {
        app.state('superboardPackageIdentifier', string);
        app.state('superboardLibraryPackageIdentifier', string);
      }),
    ).project;
    final before = project.writeToBuffer();
    expect(() => superboard.migrateLibraryBranding(project), throwsStateError);
    expect(project.writeToBuffer(), before);
  });

  test('nullable FlutterFlow inputs have optional nullable Dart fields', () {
    final project = compileApp(
      buildApp(superboard.buildStarterEditFlow),
    ).project;
    final incompatible = <String>[];
    for (final widget in project.customCode.customWidgets) {
      final fields = {
        for (final match in RegExp(
          r'final\s+(String|bool|int|double|DateTime)(\?)?\s+(\w+)\s*;',
        ).allMatches(widget.code))
          match.group(3)!: match.group(2) == '?',
      };
      final required = RegExp(
        r'\brequired\s+this\.(\w+)',
      ).allMatches(widget.code).map((match) => match.group(1)).toSet();
      for (final parameter in widget.parameters) {
        final name = parameter.identifier.name;
        if (!parameter.dataType.nonNullable &&
            fields.containsKey(name) &&
            (fields[name] != true || required.contains(name))) {
          incompatible.add('${widget.identifier.name}.$name');
        }
      }
    }
    expect(
      incompatible,
      isEmpty,
      reason:
          'FlutterFlow may omit these inputs or bind nullable page parameters.',
    );
  });

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
                'projectKey': 'superboard_project_key',
                'sdkBaseUrl': 'superboard_sdk_base_url',
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
