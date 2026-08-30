import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:superboard_reference/src/config/reference_config.dart';
import 'package:superboard_reference/src/model/reference_feature.dart';
import 'package:superboard_reference/src/services/reference_actions.dart';
import 'package:superboard_reference/src/state/reference_state.dart';
import 'package:superboard_flutterflow/superboard_flutterflow.dart';

void main() {
  test(
    'startup restores the SDK-owned session without a host token store',
    () async {
      final sdk = _RecordingBridge()
        ..currentSession = {
          'authenticated': true,
          'access_token': 'restored-access-token',
          'user_id': 'restored-user',
          'user': {'id': 'restored-user'},
        };
      final state = ReferenceState(configuration: _configuration);
      final actions = LiveReferenceActions(
        configuration: _configuration,
        sdk: sdk,
      );

      await actions.initialize(state);

      expect(state.applicationAccessToken, 'restored-access-token');
      expect(state.currentUserId, 'restored-user');
      expect(
        sdk.actions,
        containsAllInOrder([
          'superboardApplicationInitialize',
          'superboardApplicationCurrentSessionJson',
        ]),
      );
    },
  );

  test(
    'identity session accepts the real nested Identity user response',
    () async {
      final harness = _Harness();
      final result = await harness.run(ReferenceFeatureId.signIn, {
        'email': 'reference@example.test',
        'password': 'correct horse battery staple',
      });

      expect(result.success, isTrue);
      expect(result.operation, 'superboardApplicationSignInPasswordJson');
      expect(harness.state.currentUserId, 'application-user-1');
      expect(harness.state.applicationAccessToken, 'access-token');
    },
  );

  test('password recovery proves request and reset operations', () async {
    final harness = _Harness();

    await harness.run(ReferenceFeatureId.passwordRecovery, {
      'email': 'reference@example.test',
    });
    await harness.run(ReferenceFeatureId.passwordRecovery, {
      'operation': 'reset',
      'token': 'reset-token',
      'password': 'new secure password',
    });

    expect(
      harness.sdk.actions,
      containsAllInOrder([
        'superboardApplicationRequestPasswordResetJson',
        'superboardApplicationResetPasswordJson',
      ]),
    );
  });

  test('files dispatch upload, download proof, list and delete', () async {
    final harness = _Harness();

    await harness.run(ReferenceFeatureId.files, {
      'operation': 'upload',
      'filename': 'reference.txt',
      'content_type': 'text/plain',
      'text': 'SuperBoard',
    });
    final download = await harness.run(ReferenceFeatureId.files, {
      'operation': 'download',
      'file_id': 'file-1',
    });
    await harness.run(ReferenceFeatureId.files, {'operation': 'list'});
    await harness.run(ReferenceFeatureId.files, {
      'operation': 'delete',
      'file_id': 'file-1',
    });

    expect(
      harness.sdk.actions,
      containsAllInOrder([
        'superboardApplicationUploadFileJson',
        'superboardApplicationDownloadFile',
        'superboardApplicationListFilesJson',
        'superboardApplicationDeleteFileJson',
      ]),
    );
    expect(download.payload, {
      'byte_length': 3,
      'content_included': true,
      'bytes_base64': 'AQID',
      'preview_limit': 65536,
    });
  });

  test('notifications prove registration, unread state and display', () async {
    final harness = _Harness();

    await harness.run(ReferenceFeatureId.notifications, {
      'operation': 'register',
      'push_token': 'development-device-token',
    });
    await harness.run(ReferenceFeatureId.notifications, {
      'operation': 'display',
    });

    expect(
      harness.sdk.actions,
      containsAllInOrder([
        'superboardSetPushToken',
        'superboardGetUnreadMessageCount',
        'superboardDisplayMessages',
      ]),
    );
  });

  test(
    'products and paywall prove customer, restore and purchase state',
    () async {
      final harness = _Harness();

      await harness.run(ReferenceFeatureId.products, {'placement': 'default'});
      await harness.run(ReferenceFeatureId.products, {'operation': 'restore'});
      await harness.run(ReferenceFeatureId.paywall, {
        'operation': 'purchase',
        'package_identifier': 'monthly',
      });

      expect(
        harness.sdk.actions,
        containsAllInOrder([
          'superboardGetOfferings',
          'superboardGetCustomerInfoJson',
          'superboardGetLastVerifiedCustomerInfoJson',
          'superboardRestore',
          'superboardGetCustomerInfoJson',
          'superboardPurchase',
          'superboardGetLastPurchaseResultJson',
        ]),
      );
    },
  );

  test(
    'dynamic links prove generation and received attribution state',
    () async {
      final harness = _Harness();

      await harness.run(ReferenceFeatureId.dynamicLinks, {
        'title': 'Reference',
        'data': {'source': 'test'},
      });
      await harness.run(ReferenceFeatureId.dynamicLinks, {'operation': 'last'});

      expect(
        harness.sdk.actions,
        containsAllInOrder([
          'superboardGenerateLinkJson',
          'superboardGetLastDeepLinkJson',
        ]),
      );
    },
  );

  test(
    'Marketing consent uses the common authenticated SDK contract',
    () async {
      final harness = _Harness();

      await harness.run(ReferenceFeatureId.marketingConsent, {
        'operation': 'load',
      });
      await harness.run(ReferenceFeatureId.marketingConsent, {
        'operation': 'update',
        'consented': true,
        'attributes': {'locale': 'fr-CH'},
        'list_ids': ['product-news'],
        'idempotency_key': 'consent-reference-1',
      });

      expect(
        harness.sdk.actions,
        containsAllInOrder([
          'superboardApplicationMarketingPreferencesJson',
          'superboardApplicationUpdateMarketingConsentJson',
        ]),
      );
    },
  );

  test('support dispatches every canonical conversation operation', () async {
    final harness = _Harness();
    const operations = <String, String>{
      'configuration': 'superboardSupportGetConfigurationJson',
      'list': 'superboardSupportListConversationsJson',
      'open': 'superboardSupportOpenConversation',
      'update': 'superboardSupportUpdateConversationJson',
      'messages': 'superboardSupportMessagesJson',
      'send': 'superboardSupportSendAdvanced',
      'upload_attachment': 'superboardSupportUploadAttachmentJson',
      'download_attachment': 'superboardSupportDownloadAttachment',
      'send_attachment': 'superboardSupportSendAttachment',
      'mark_read': 'superboardSupportMarkRead',
      'typing': 'superboardSupportSetTyping',
      'connect': 'superboardSupportConnectRealtime',
      'disconnect': 'superboardSupportDisconnectRealtime',
      'realtime_event': 'superboardSupportGetLastRealtimeEventJson',
      'csat': 'superboardSupportSubmitCsatJson',
    };

    for (final entry in operations.entries) {
      final result = await harness.run(ReferenceFeatureId.support, {
        'operation': entry.key,
        'client_conversation_id': 'reference-conversation',
        'conversation_id': 'conversation-1',
        'message_id': 'message-1',
        'client_message_id': 'client-message-1',
        'body': 'Hello',
        'filename': 'attachment.txt',
        'content_type': 'text/plain',
        'text': 'Attachment',
        'attachment': {'id': 'attachment-1'},
        'active': true,
        'rating': 5,
      });
      expect(result.success, isTrue, reason: entry.key);
      expect(result.operation, entry.value, reason: entry.key);
    }

    for (final action in operations.values) {
      expect(harness.sdk.actions, contains(action), reason: action);
    }
  });

  test(
    'custom extension proves public create-list-detail and terminal cancellation',
    () async {
      final harness = _Harness();
      final result = await harness.run(ReferenceFeatureId.customExtension, {
        'payload': {'message': 'echo'},
        'idempotency_key': 'reference-echo-1',
      });

      expect(result.success, isTrue);
      expect(result.operation, 'reference.echo.create-list-detail-cancel');
      expect(result.payload, isA<Map>());
      expect((result.payload as Map)['cancellation'], {
        'status': 'terminal',
        'code': 'job_not_cancellable',
        'http_status': 409,
      });
      expect(
        harness.sdk.actions,
        containsAllInOrder([
          'superboardApplicationCreateCustomJobJson',
          'superboardApplicationListCustomJobsJson',
          'superboardApplicationGetCustomJobJson',
          'superboardApplicationCancelCustomJobJson',
        ]),
      );
    },
  );

  test(
    'custom extension binds an acceptance receipt to exact revisions',
    () async {
      final harness = _Harness();
      final result = await harness.run(ReferenceFeatureId.customExtension, {
        'operation': 'acceptance',
        'idempotency_key': 'reference-acceptance-1',
        'journeys': _acceptanceJourneyIds
            .map(
              (id) => {
                'id': id,
                'status': 'passed',
                'evidence': '$id accepted',
              },
            )
            .toList(),
      });

      expect(result.success, isTrue);
      expect(
        result.operation,
        'reference.acceptance.create-list-detail-cancel',
      );
      final creation = harness.sdk.invocations.firstWhere(
        (entry) => entry.$1 == 'superboardApplicationCreateCustomJobJson',
      );
      expect(creation.$2['capability'], 'reference.acceptance');
      expect(creation.$2['payload'], {
        'schemaVersion': 1,
        'target': 'mbza-development',
        'projectEnvironment': 'test',
        'platformRevision': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'referenceRevision': 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'completedAt': isA<String>(),
        'journeys': isA<List<dynamic>>(),
      });
    },
  );
}

class _Harness {
  _Harness() : sdk = _RecordingBridge() {
    state = ReferenceState(configuration: _configuration);
    actions = LiveReferenceActions(configuration: _configuration, sdk: sdk);
  }

  final _RecordingBridge sdk;
  late ReferenceState state;
  late LiveReferenceActions actions;

  Future<ReferenceActionResult> run(
    ReferenceFeatureId id, [
    Map<String, dynamic> input = const {},
  ]) => actions.execute(
    referenceFeatures.singleWhere((feature) => feature.id == id),
    state,
    input: input,
  );
}

const _configuration = ReferenceConfig(
  environment: 'development',
  target: 'mbza-development',
  apiBaseUrl: 'https://api.example.test',
  sdkBaseUrl: 'https://sdk.example.test',
  supportBaseUrl: 'https://api.example.test/api/v1/support-client',
  shortLinksBaseUrl: 'https://in.example.test',
  filesBaseUrl: 'https://files.example.test',
  mailPreviewBaseUrl: 'https://mail.example.test',
  projectKey: 'test_project_key',
  projectId: 12,
  sdkPlatform: 'web',
  sdkIdentifier: 'reference.example.test',
  projectEnvironment: 'test',
  liveMode: true,
  platformRevision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  referenceRevision: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
);

class _RecordingBridge implements ReferenceSdkBridge {
  final actions = <String>[];
  final invocations = <(String, Map<String, dynamic>)>[];
  Map<String, Object?> currentSession = const {'authenticated': false};

  @override
  Future<Object?> invoke(String action, Map<String, dynamic> parameters) async {
    actions.add(action);
    invocations.add((action, Map<String, dynamic>.from(parameters)));
    return switch (action) {
      'superboardApplicationSignInPasswordJson' => {
        'authenticated': true,
        'access_token': 'access-token',
        'user': {'id': 'application-user-1'},
      },
      'superboardApplicationCurrentSessionJson' => currentSession,
      'superboardApplicationDownloadFile' ||
      'superboardSupportDownloadAttachment' => Uint8List.fromList([1, 2, 3]),
      'superboardApplicationCreateCustomJobJson' => {'id': 'job-1'},
      'superboardApplicationCancelCustomJobJson' =>
        throw const SuperBoardApplicationException(
          'job_not_cancellable',
          'The completed reference receipt cannot be cancelled.',
          statusCode: 409,
        ),
      'superboardGenerateLinkJson' => {'url': 'https://in.example.test/link'},
      'superboardGetUnreadMessageCount' => {'unread': 2},
      _ => <String, Object?>{'ok': true, 'action': action},
    };
  }
}

const _acceptanceJourneyIds = <String>[
  'bootstrap',
  'sign-in',
  'create-account',
  'password-recovery',
  'home',
  'profile',
  'notifications',
  'files',
  'products',
  'paywall',
  'dynamic-links',
  'support',
  'marketing-consent',
  'onboarding',
  'custom-extension',
  'diagnostics',
];
