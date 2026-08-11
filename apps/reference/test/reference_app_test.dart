import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:superboard_reference/src/app.dart';
import 'package:superboard_reference/src/config/reference_config.dart';
import 'package:superboard_reference/src/model/reference_feature.dart';
import 'package:superboard_reference/src/pages/reference_shell.dart';
import 'package:superboard_reference/src/services/reference_actions.dart';
import 'package:superboard_reference/src/state/reference_state.dart';

void main() {
  testWidgets('reference app exposes all journeys and runs in safe demo mode', (
    tester,
  ) async {
    final state = ReferenceState(
      configuration: const ReferenceConfig(
        environment: 'development',
        target: 'mbza-development',
        apiBaseUrl: 'https://api.mbza.dev',
        sdkBaseUrl: 'https://sdk.mbza.dev',
        supportBaseUrl: 'https://api.mbza.dev/api/v1/support-client',
        shortLinksBaseUrl: 'https://in.mbza.dev',
        filesBaseUrl: 'https://files.mbza.dev',
        mailPreviewBaseUrl: 'https://mail.mbza.dev',
        projectKey: '',
        projectId: 0,
        sdkPlatform: 'web',
        sdkIdentifier: 'reference.mbza.dev',
        projectEnvironment: 'test',
        liveMode: false,
      ),
    );
    await tester.binding.setSurfaceSize(const Size(1200, 900));
    await tester.pumpWidget(
      GrowReferenceApp(state: state, actions: DemoReferenceActions()),
    );
    await tester.pumpAndSettle();

    expect(find.text('SuperBoard Reference'), findsOneWidget);
    expect(find.text('platform local · reference local'), findsOneWidget);
    expect(find.text('2 active · v3 pending'), findsOneWidget);
    expect(find.text('Bootstrap'), findsWidgets);
    expect(find.text('Safe demo mode'), findsOneWidget);
    await tester.tap(find.text('2 active · v3 pending'));
    await tester.pumpAndSettle();
    expect(find.text('SuperBoard SDK catalogue'), findsOneWidget);
    expect(
      find.text('opengrow_flutter 2.1.4 → superboard_flutter 3.0.0'),
      findsOneWidget,
    );
    expect(find.text('archived'), findsNWidgets(3));
    await tester.tap(find.text('Close'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Run reference action'));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('Contract exercised without a remote write.'),
      findsOneWidget,
    );
    await tester.binding.setSurfaceSize(null);
  });

  testWidgets(
    'live acceptance exposes the real paywall and onboarding widgets',
    (tester) async {
      final state = ReferenceState(
        configuration: const ReferenceConfig(
          environment: 'development',
          target: 'mbza-development',
          apiBaseUrl: 'https://api.mbza.dev',
          sdkBaseUrl: 'https://sdk.mbza.dev',
          supportBaseUrl: 'https://api.mbza.dev/api/v1/support-client',
          shortLinksBaseUrl: 'https://in.mbza.dev',
          filesBaseUrl: 'https://files.mbza.dev',
          mailPreviewBaseUrl: 'https://mail.mbza.dev',
          projectKey: 'test-project-key',
          projectId: 20,
          sdkPlatform: 'web',
          sdkIdentifier: 'reference.mbza.dev',
          projectEnvironment: 'test',
          liveMode: true,
          platformRevision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          referenceRevision: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        ),
      );
      await tester.binding.setSurfaceSize(const Size(1400, 1000));
      await tester.pumpWidget(
        GrowReferenceApp(state: state, actions: DemoReferenceActions()),
      );
      await tester.pumpAndSettle();

      expect(find.text('LIVE'), findsOneWidget);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ReferenceFeaturePage(
              feature: referenceFeatures.singleWhere(
                (feature) => feature.id == ReferenceFeatureId.paywall,
              ),
              state: state,
              actions: DemoReferenceActions(),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Live widget acceptance'), findsOneWidget);
      expect(find.text('Render live widget'), findsOneWidget);
      expect(find.text('OpenGrowPaywall'), findsOneWidget);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ReferenceFeaturePage(
              feature: referenceFeatures.singleWhere(
                (feature) => feature.id == ReferenceFeatureId.onboarding,
              ),
              state: state,
              actions: DemoReferenceActions(),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Live widget acceptance'), findsOneWidget);
      expect(find.text('Render live widget'), findsOneWidget);
      expect(find.text('OpenGrowOnboarding'), findsOneWidget);
      await tester.binding.setSurfaceSize(null);
    },
  );
}
