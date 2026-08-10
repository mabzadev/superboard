import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart';
import 'package:opengrow_flutterflow_messaging/opengrow_flutterflow_messaging.dart';

import '../config/reference_config.dart';
import '../model/reference_feature.dart';
import '../state/reference_state.dart';

class ReferenceActionResult {
  const ReferenceActionResult({
    required this.success,
    required this.operation,
    required this.payload,
  });

  final bool success;
  final String operation;
  final Object? payload;

  Map<String, Object?> toJson() => {
    'success': success,
    'operation': operation,
    'payload': payload,
  };
}

abstract interface class ReferenceActions {
  Future<void> initialize(ReferenceState state);

  Future<ReferenceActionResult> execute(
    ReferenceFeature feature,
    ReferenceState state, {
    Map<String, dynamic> input = const {},
  });
}

/// Thin injectable bridge over the public OpenGrow FlutterFlow surface.
///
/// The live reference app invokes only these public actions. Tests replace the
/// bridge with a recorder so every advertised journey proves its actual action
/// dispatch without copying any SDK implementation into this repository.
abstract interface class ReferenceSdkBridge {
  Future<Object?> invoke(String action, Map<String, dynamic> parameters);
}

class OpenGrowReferenceSdkBridge implements ReferenceSdkBridge {
  const OpenGrowReferenceSdkBridge();

  @override
  Future<Object?> invoke(String action, Map<String, dynamic> parameters) async {
    switch (action) {
      case 'opengrowApplicationInitialize':
        return opengrowApplicationInitialize(
          apiBaseUrl: _string(parameters, 'api_base_url'),
          filesBaseUrl: _string(parameters, 'files_base_url'),
          applicationAccessToken: _optionalString(
            parameters,
            'application_access_token',
          ),
          projectKey: _optionalString(parameters, 'project_key'),
          platform: _optionalString(parameters, 'platform'),
          identifier: _optionalString(parameters, 'identifier'),
          environment: _optionalString(parameters, 'environment', 'production'),
        );
      case 'opengrowApplicationSetAccessToken':
        return opengrowApplicationSetAccessToken(
          _optionalString(parameters, 'application_access_token'),
        );
      case 'opengrowApplicationRestoreSessionJson':
        return _decodeJson(await opengrowApplicationRestoreSessionJson());
      case 'opengrowApplicationCurrentSessionJson':
        return _decodeJson(await opengrowApplicationCurrentSessionJson());
      case 'opengrowApplicationAccessToken':
        return opengrowApplicationAccessToken();
      case 'opengrowInitializeAuto':
        return opengrowInitializeAuto(
          projectKey: _string(parameters, 'project_key'),
          sdkBaseUrl: _string(parameters, 'sdk_base_url'),
        );
      case 'opengrowInitializeAuthenticated':
        return opengrowInitializeAuthenticated(
          projectKey: _string(parameters, 'project_key'),
          applicationAccessToken: _string(
            parameters,
            'application_access_token',
          ),
          sdkBaseUrl: _string(parameters, 'sdk_base_url'),
          authGatewayBaseUrl: _string(parameters, 'auth_gateway_base_url'),
        );
      case 'opengrowApplicationRuntimePolicyJson':
        return _decodeJson(
          await opengrowApplicationRuntimePolicyJson(
            appVersion: _string(parameters, 'app_version'),
            build: _optionalString(parameters, 'build'),
          ),
        );
      case 'opengrowApplicationSignInPasswordJson':
        return _decodeJson(
          await opengrowApplicationSignInPasswordJson(
            email: _string(parameters, 'email'),
            password: _string(parameters, 'password'),
          ),
        );
      case 'opengrowApplicationSignInProviderJson':
        return _decodeJson(
          await opengrowApplicationSignInProviderJson(
            provider: _string(parameters, 'provider'),
            idToken: _string(parameters, 'id_token'),
            name: _optionalString(parameters, 'name'),
          ),
        );
      case 'opengrowApplicationRefreshJson':
        return _decodeJson(
          await opengrowApplicationRefreshJson(
            _string(parameters, 'refresh_token'),
          ),
        );
      case 'opengrowApplicationRegisterJson':
        return _decodeJson(
          await opengrowApplicationRegisterJson(
            email: _string(parameters, 'email'),
            password: _string(parameters, 'password'),
            name: _optionalString(parameters, 'name'),
          ),
        );
      case 'opengrowApplicationRequestPasswordResetJson':
        return _decodeJson(
          await opengrowApplicationRequestPasswordResetJson(
            _string(parameters, 'email'),
          ),
        );
      case 'opengrowApplicationResetPasswordJson':
        return _decodeJson(
          await opengrowApplicationResetPasswordJson(
            token: _string(parameters, 'token'),
            password: _string(parameters, 'password'),
          ),
        );
      case 'opengrowApplicationProfileJson':
        return _decodeJson(await opengrowApplicationProfileJson());
      case 'opengrowApplicationUpdateProfileJson':
        return _decodeJson(
          await opengrowApplicationUpdateProfileJson(
            _string(parameters, 'name'),
          ),
        );
      case 'opengrowApplicationLogoutJson':
        return _decodeJson(await opengrowApplicationLogoutJson());
      case 'opengrowApplicationDeleteAccountJson':
        return _decodeJson(await opengrowApplicationDeleteAccountJson());
      case 'opengrowApplicationMarketingPreferencesJson':
        return _decodeJson(await opengrowApplicationMarketingPreferencesJson());
      case 'opengrowApplicationUpdateMarketingConsentJson':
        return _decodeJson(
          await opengrowApplicationUpdateMarketingConsentJson(
            consented: _boolean(parameters, 'consented'),
            idempotencyKey: _string(parameters, 'idempotency_key'),
            attributesJson: jsonEncode(_object(parameters, 'attributes')),
            listIdsJson: jsonEncode(parameters['list_ids'] ?? const []),
          ),
        );
      case 'opengrowIdentify':
        return opengrowIdentify(
          userIdentifier: _string(parameters, 'user_identifier'),
          identityToken: _optionalString(parameters, 'identity_token'),
        );
      case 'opengrowSetUserAttributesJson':
        return opengrowSetUserAttributesJson(
          jsonEncode(_object(parameters, 'attributes')),
        );
      case 'opengrowSetPushToken':
        return opengrowSetPushToken(_string(parameters, 'push_token'));
      case 'opengrowGetUnreadMessageCount':
        return {'unread': await opengrowGetUnreadMessageCount()};
      case 'opengrowDisplayMessages':
        return {'displayed': await opengrowDisplayMessages()};
      case 'opengrowApplicationListFilesJson':
        return _decodeJson(
          await opengrowApplicationListFilesJson(
            limit: _integer(parameters, 'limit', 50),
            offset: _integer(parameters, 'offset', 0),
          ),
        );
      case 'opengrowApplicationUploadFileJson':
        return _decodeJson(
          await opengrowApplicationUploadFileJson(
            bytes: _byteInput(parameters),
            filename: _string(parameters, 'filename'),
            contentType: _string(parameters, 'content_type'),
          ),
        );
      case 'opengrowApplicationDownloadFile':
        return opengrowApplicationDownloadFile(_string(parameters, 'file_id'));
      case 'opengrowApplicationDeleteFileJson':
        return _decodeJson(
          await opengrowApplicationDeleteFileJson(
            _string(parameters, 'file_id'),
          ),
        );
      case 'opengrowGetOfferings':
        return _decodeJson(
          await opengrowGetOfferings(
            placement: _optionalString(parameters, 'placement', 'default'),
          ),
        );
      case 'opengrowGetCustomerInfoJson':
        return _decodeJson(await opengrowGetCustomerInfoJson());
      case 'opengrowGetLastVerifiedCustomerInfoJson':
        return _decodeOptionalJson(
          await opengrowGetLastVerifiedCustomerInfoJson(),
        );
      case 'opengrowRestore':
        return {'restored': await opengrowRestore()};
      case 'opengrowGetPurchaseConfigurationJson':
        return _decodeJson(
          await opengrowGetPurchaseConfigurationJson(
            placement: _optionalString(parameters, 'placement', 'default'),
          ),
        );
      case 'opengrowPurchase':
        return _decodeJson(
          await opengrowPurchase(
            packageIdentifier: _string(parameters, 'package_identifier'),
            offeringIdentifier: _optionalString(
              parameters,
              'offering_identifier',
            ),
          ),
        );
      case 'opengrowGetLastPurchaseResultJson':
        return _decodeOptionalJson(await opengrowGetLastPurchaseResultJson());
      case 'opengrowGenerateLinkJson':
        return {
          'url': await opengrowGenerateLinkJson(
            jsonEncode(_object(parameters, 'parameters')),
          ),
        };
      case 'opengrowGetLastDeepLinkJson':
        return _decodeOptionalJson(await opengrowGetLastDeepLinkJson());
      case 'opengrowSupportInitializeAuthenticated':
        return opengrowSupportInitializeAuthenticated(
          applicationAccessToken: _string(
            parameters,
            'application_access_token',
          ),
          projectId: _integer(parameters, 'project_id'),
          authGatewayUrl: _string(parameters, 'auth_gateway_url'),
          supportUrl: _string(parameters, 'support_url'),
        );
      case 'opengrowSupportGetConfigurationJson':
        return _decodeJson(await opengrowSupportGetConfigurationJson());
      case 'opengrowSupportListConversationsJson':
        return _decodeJson(await opengrowSupportListConversationsJson());
      case 'opengrowSupportOpenConversation':
        return _decodeJson(
          await opengrowSupportOpenConversation(
            clientConversationId: _string(parameters, 'client_conversation_id'),
            subject: _nullableString(parameters, 'subject'),
            inboxId: _nullableString(parameters, 'inbox_id'),
            customAttributesJson: jsonEncode(
              _object(parameters, 'custom_attributes'),
            ),
          ),
        );
      case 'opengrowSupportUpdateConversationJson':
        return _decodeJson(
          await opengrowSupportUpdateConversationJson(
            conversationId: _string(parameters, 'conversation_id'),
            status: _nullableString(parameters, 'status'),
            customAttributesJson: parameters.containsKey('custom_attributes')
                ? jsonEncode(_object(parameters, 'custom_attributes'))
                : null,
          ),
        );
      case 'opengrowSupportMessagesJson':
        return _decodeJson(
          await opengrowSupportMessagesJson(
            _string(parameters, 'conversation_id'),
            beforeSequence: parameters['before_sequence'] == null
                ? null
                : _integer(parameters, 'before_sequence'),
            limit: _integer(parameters, 'limit', 50),
          ),
        );
      case 'opengrowSupportSendAdvanced':
        return _decodeJson(
          await opengrowSupportSendAdvanced(
            conversationId: _string(parameters, 'conversation_id'),
            body: _string(parameters, 'body'),
            clientMessageId: _string(parameters, 'client_message_id'),
            contentType: _optionalString(parameters, 'content_type', 'text'),
            replyToMessageId: _nullableString(
              parameters,
              'reply_to_message_id',
            ),
            metadataJson: jsonEncode(_object(parameters, 'metadata')),
          ),
        );
      case 'opengrowSupportSubmitCsatJson':
        return _decodeJson(
          await opengrowSupportSubmitCsatJson(
            conversationId: _string(parameters, 'conversation_id'),
            rating: _integer(parameters, 'rating'),
            feedback: _nullableString(parameters, 'feedback'),
          ),
        );
      case 'opengrowSupportUploadAttachmentJson':
        return _decodeJson(
          await opengrowSupportUploadAttachmentJson(
            conversationId: _string(parameters, 'conversation_id'),
            bytes: _byteInput(parameters),
            filename: _string(parameters, 'filename'),
            contentType: _string(parameters, 'content_type'),
          ),
        );
      case 'opengrowSupportDownloadAttachment':
        return opengrowSupportDownloadAttachment(
          conversationId: _string(parameters, 'conversation_id'),
          messageId: _string(parameters, 'message_id'),
          attachmentId: _nullableString(parameters, 'attachment_id'),
        );
      case 'opengrowSupportSendAttachment':
        return _decodeJson(
          await opengrowSupportSendAttachment(
            conversationId: _string(parameters, 'conversation_id'),
            attachmentJson: jsonEncode(_object(parameters, 'attachment')),
            clientMessageId: _string(parameters, 'client_message_id'),
            body: _optionalString(parameters, 'body'),
          ),
        );
      case 'opengrowSupportMarkRead':
        return _decodeJson(
          await opengrowSupportMarkRead(_string(parameters, 'conversation_id')),
        );
      case 'opengrowSupportSetTyping':
        return {
          'typing': await opengrowSupportSetTyping(
            _string(parameters, 'conversation_id'),
            _boolean(parameters, 'active'),
          ),
        };
      case 'opengrowSupportConnectRealtime':
        return {
          'connected': await opengrowSupportConnectRealtime(
            _string(parameters, 'conversation_id'),
          ),
        };
      case 'opengrowSupportDisconnectRealtime':
        return {'disconnected': await opengrowSupportDisconnectRealtime()};
      case 'opengrowSupportGetLastRealtimeEventJson':
        return _decodeOptionalJson(
          await opengrowSupportGetLastRealtimeEventJson(),
        );
      case 'opengrowApplicationCreateCustomJobJson':
        return _decodeJson(
          await opengrowApplicationCreateCustomJobJson(
            capability: _string(parameters, 'capability'),
            payloadJson: jsonEncode(_object(parameters, 'payload')),
            idempotencyKey: _string(parameters, 'idempotency_key'),
          ),
        );
      case 'opengrowApplicationListCustomJobsJson':
        return _decodeJson(
          await opengrowApplicationListCustomJobsJson(
            limit: _integer(parameters, 'limit', 25),
            status: _optionalString(parameters, 'status'),
            capability: _optionalString(parameters, 'capability'),
            cursor: _optionalString(parameters, 'cursor'),
          ),
        );
      case 'opengrowApplicationGetCustomJobJson':
        return _decodeJson(
          await opengrowApplicationGetCustomJobJson(
            _string(parameters, 'job_id'),
          ),
        );
      case 'opengrowApplicationCancelCustomJobJson':
        return _decodeJson(
          await opengrowApplicationCancelCustomJobJson(
            _string(parameters, 'job_id'),
          ),
        );
      default:
        throw UnsupportedError(
          'Unsupported OpenGrow reference action: $action',
        );
    }
  }
}

class _LiveExecution {
  const _LiveExecution(this.operation, this.payload);
  final String operation;
  final Object? payload;
}

class DemoReferenceActions implements ReferenceActions {
  @override
  Future<void> initialize(ReferenceState state) async {}

  @override
  Future<ReferenceActionResult> execute(
    ReferenceFeature feature,
    ReferenceState state, {
    Map<String, dynamic> input = const {},
  }) async {
    final result = ReferenceActionResult(
      success: true,
      operation: feature.actions.first,
      payload: {
        'mode': 'demo',
        'feature': feature.id.name,
        'owner': feature.owner,
        'input': input,
        'message': 'Contract exercised without a remote write.',
      },
    );
    state.record(_stateChannel(feature.id), result.toJson());
    return result;
  }
}

class LiveReferenceActions implements ReferenceActions {
  LiveReferenceActions({
    required this.configuration,
    http.Client? client,
    ReferenceSdkBridge? sdk,
  }) : _client = client ?? http.Client(),
       _sdk = sdk ?? const OpenGrowReferenceSdkBridge();

  final ReferenceConfig configuration;
  final http.Client _client;
  final ReferenceSdkBridge _sdk;
  bool _applicationInitialized = false;

  @override
  Future<void> initialize(ReferenceState state) async {
    try {
      await _ensureApplication(state);
    } catch (error) {
      state.record('error', {'error': _sanitizeError(error)});
    }
  }

  @override
  Future<ReferenceActionResult> execute(
    ReferenceFeature feature,
    ReferenceState state, {
    Map<String, dynamic> input = const {},
  }) async {
    try {
      await _ensureApplication(state);
      final execution = await _execute(feature.id, state, input);
      final result = ReferenceActionResult(
        success: true,
        operation: execution.operation,
        payload: execution.payload,
      );
      state.record(_stateChannel(feature.id), execution.payload);
      return result;
    } catch (error) {
      final result = ReferenceActionResult(
        success: false,
        operation: feature.actions.first,
        payload: {'error': _sanitizeError(error)},
      );
      state.record('error', result.toJson());
      return result;
    }
  }

  Future<_LiveExecution> _execute(
    ReferenceFeatureId id,
    ReferenceState state,
    Map<String, dynamic> input,
  ) async {
    switch (id) {
      case ReferenceFeatureId.bootstrap:
        if (state.applicationAccessToken.isEmpty) {
          await _sdk.invoke('opengrowInitializeAuto', {
            'project_key': configuration.projectKey,
            'sdk_base_url': configuration.sdkBaseUrl,
          });
        } else {
          await _sdk.invoke('opengrowInitializeAuthenticated', {
            'project_key': configuration.projectKey,
            'application_access_token': state.applicationAccessToken,
            'sdk_base_url': configuration.sdkBaseUrl,
            'auth_gateway_base_url': configuration.apiBaseUrl,
          });
        }
        final runtimePolicy = await _sdk
            .invoke('opengrowApplicationRuntimePolicyJson', {
              'app_version': input['app_version']?.toString() ?? '0.1.0',
              'build': input['build']?.toString() ?? '1',
            });
        return _LiveExecution('opengrowApplicationRuntimePolicyJson', {
          ...configuration.diagnostics(),
          'runtime_policy': _unwrapData(runtimePolicy),
        });
      case ReferenceFeatureId.signIn:
        final provider = input['provider']?.toString();
        final operation = provider == 'google' || provider == 'apple'
            ? 'opengrowApplicationSignInProviderJson'
            : 'opengrowApplicationSignInPasswordJson';
        final value = await _sdk.invoke(operation, {
          if (provider == 'google' || provider == 'apple') ...{
            'provider': provider,
            'id_token': input['token']?.toString() ?? '',
            'name': input['name']?.toString() ?? '',
          } else ...{
            'email': input['email']?.toString() ?? '',
            'password': input['password']?.toString() ?? '',
          },
        });
        _applySession(state, value);
        return _LiveExecution(operation, value);
      case ReferenceFeatureId.createAccount:
        const operation = 'opengrowApplicationRegisterJson';
        final value = await _sdk.invoke(operation, {
          'email': input['email']?.toString() ?? '',
          'password': input['password']?.toString() ?? '',
          'name': input['name']?.toString() ?? '',
        });
        _applySession(state, value);
        return _LiveExecution(operation, value);
      case ReferenceFeatureId.passwordRecovery:
        final reset = input['operation'] == 'reset';
        final operation = reset
            ? 'opengrowApplicationResetPasswordJson'
            : 'opengrowApplicationRequestPasswordResetJson';
        return _LiveExecution(
          operation,
          await _sdk.invoke(operation, {
            if (reset) ...{
              'token': input['token']?.toString() ?? '',
              'password': input['password']?.toString() ?? '',
            } else
              'email': input['email']?.toString() ?? '',
          }),
        );
      case ReferenceFeatureId.home:
        final profile = await _sdk.invoke(
          'opengrowApplicationProfileJson',
          const {},
        );
        final policy = await _sdk
            .invoke('opengrowApplicationRuntimePolicyJson', {
              'app_version': input['app_version']?.toString() ?? '0.1.0',
              'build': input['build']?.toString() ?? '1',
            });
        return _LiveExecution('loadProfileAndFeatureManifest', {
          'profile': _unwrapData(profile),
          'runtime_policy': _unwrapData(policy),
        });
      case ReferenceFeatureId.profile:
        if (input['operation'] == 'delete') {
          final result = await _sdk.invoke(
            'opengrowApplicationDeleteAccountJson',
            const {},
          );
          state.clearSession();
          return _LiveExecution('opengrowApplicationDeleteAccountJson', result);
        }
        if (input['operation'] == 'logout') {
          final result = await _sdk.invoke(
            'opengrowApplicationLogoutJson',
            const {},
          );
          state.clearSession();
          return _LiveExecution('opengrowApplicationLogoutJson', result);
        }
        if (input['operation'] == 'update_profile') {
          return _LiveExecution(
            'opengrowApplicationUpdateProfileJson',
            await _sdk.invoke('opengrowApplicationUpdateProfileJson', {
              'name': input['name']?.toString() ?? '',
            }),
          );
        }
        if (input['operation'] == 'identify') {
          return _LiveExecution(
            'opengrowIdentify',
            await _sdk.invoke('opengrowIdentify', {
              'user_identifier':
                  input['user_identifier']?.toString() ?? state.currentUserId,
              'identity_token': input['identity_token']?.toString() ?? '',
            }),
          );
        }
        if (input['operation'] == 'attributes') {
          return _LiveExecution(
            'opengrowSetUserAttributesJson',
            await _sdk.invoke('opengrowSetUserAttributesJson', {
              'attributes': input['attributes'] is Map
                  ? input['attributes']
                  : const <String, Object?>{},
            }),
          );
        }
        return _LiveExecution(
          'opengrowApplicationProfileJson',
          await _sdk.invoke('opengrowApplicationProfileJson', const {}),
        );
      case ReferenceFeatureId.notifications:
        final operation = input['operation']?.toString() ?? 'inspect';
        if (operation == 'register') {
          await _sdk.invoke('opengrowSetPushToken', {
            'push_token': input['push_token']?.toString() ?? '',
          });
        } else if (operation == 'display') {
          return _LiveExecution(
            'opengrowDisplayMessages',
            await _sdk.invoke('opengrowDisplayMessages', const {}),
          );
        }
        return _LiveExecution(
          operation == 'register'
              ? 'opengrowSetPushToken'
              : 'opengrowGetUnreadMessageCount',
          await _sdk.invoke('opengrowGetUnreadMessageCount', const {}),
        );
      case ReferenceFeatureId.files:
        final operation = input['operation']?.toString() ?? 'list';
        if (operation == 'upload') {
          return _LiveExecution(
            'opengrowApplicationUploadFileJson',
            await _sdk.invoke('opengrowApplicationUploadFileJson', input),
          );
        }
        if (operation == 'download') {
          final bytes = await _sdk.invoke(
            'opengrowApplicationDownloadFile',
            input,
          );
          return _LiveExecution(
            'opengrowApplicationDownloadFile',
            _downloadProof(bytes),
          );
        }
        if (operation == 'delete') {
          return _LiveExecution(
            'opengrowApplicationDeleteFileJson',
            await _sdk.invoke('opengrowApplicationDeleteFileJson', input),
          );
        }
        return _LiveExecution(
          'opengrowApplicationListFilesJson',
          await _sdk.invoke('opengrowApplicationListFilesJson', input),
        );
      case ReferenceFeatureId.products:
        if (input['operation'] == 'restore') {
          final restored = await _sdk.invoke('opengrowRestore', const {});
          final customer = await _sdk.invoke(
            'opengrowGetCustomerInfoJson',
            const {},
          );
          return _LiveExecution('opengrowRestore', {
            'restore': restored,
            'customer_info': _unwrapData(customer),
          });
        }
        final offerings = await _sdk.invoke('opengrowGetOfferings', input);
        final customer = await _sdk.invoke(
          'opengrowGetCustomerInfoJson',
          const {},
        );
        final verified = await _sdk.invoke(
          'opengrowGetLastVerifiedCustomerInfoJson',
          const {},
        );
        return _LiveExecution('inspectProductsAndCustomerInfo', {
          'offerings': _unwrapData(offerings),
          'customer_info': _unwrapData(customer),
          'last_verified_customer_info': _unwrapData(verified),
        });
      case ReferenceFeatureId.paywall:
        if (input['operation'] == 'purchase') {
          final purchase = await _sdk.invoke('opengrowPurchase', input);
          final latest = await _sdk.invoke(
            'opengrowGetLastPurchaseResultJson',
            const {},
          );
          return _LiveExecution('opengrowPurchase', {
            'purchase': _unwrapData(purchase),
            'last_result': _unwrapData(latest),
          });
        }
        return _LiveExecution(
          'opengrowGetPurchaseConfigurationJson',
          await _sdk.invoke('opengrowGetPurchaseConfigurationJson', input),
        );
      case ReferenceFeatureId.dynamicLinks:
        if (input['operation'] == 'last') {
          return _LiveExecution(
            'opengrowGetLastDeepLinkJson',
            await _sdk.invoke('opengrowGetLastDeepLinkJson', const {}),
          );
        }
        final link = await _sdk.invoke('opengrowGenerateLinkJson', {
          'parameters': {
            'title': input['title']?.toString() ?? 'OpenGrow reference',
            'data': input['data'] is Map
                ? input['data']
                : {'source': 'opengrow-reference'},
          },
        });
        return _LiveExecution('opengrowGenerateLinkJson', {
          ..._objectValue(link),
          'origin': configuration.shortLinksBaseUrl,
        });
      case ReferenceFeatureId.support:
        await _initializeSupport(state);
        return _executeSupport(input);
      case ReferenceFeatureId.marketingConsent:
        final load = input['operation'] == 'load';
        return _LiveExecution(
          load
              ? 'opengrowApplicationMarketingPreferencesJson'
              : 'opengrowApplicationUpdateMarketingConsentJson',
          await _sdk.invoke(
            load
                ? 'opengrowApplicationMarketingPreferencesJson'
                : 'opengrowApplicationUpdateMarketingConsentJson',
            input,
          ),
        );
      case ReferenceFeatureId.onboarding:
        return _LiveExecution('OpenGrowOnboarding', {
          'widget': 'OpenGrowOnboarding',
          'placement': input['placement']?.toString() ?? 'app_launch',
          'rendered_in_live_mode': configuration.liveMode,
          'message':
              'Use the live widget below to exercise resolve, progress, complete, skip and rollback-safe versioning.',
        });
      case ReferenceFeatureId.customExtension:
        final acceptance = input['operation'] == 'acceptance';
        final capability = acceptance
            ? 'reference.acceptance'
            : 'reference.echo';
        final rawPayload = input['payload'];
        final payload = acceptance
            ? <String, Object?>{
                'schemaVersion': 1,
                'target': configuration.target,
                'projectEnvironment': configuration.projectEnvironment,
                'platformRevision': configuration.platformRevision,
                'referenceRevision': configuration.referenceRevision,
                'completedAt': DateTime.now().toUtc().toIso8601String(),
                'journeys': input['journeys'],
              }
            : rawPayload is Map
            ? rawPayload.cast<String, dynamic>()
            : const <String, Object?>{'message': 'OpenGrow reference'};
        final idempotencyKey =
            input['idempotency_key']?.toString().trim() ?? '';
        if (idempotencyKey.isEmpty) {
          throw const FormatException(
            'A stable idempotency_key is required for the custom extension.',
          );
        }
        final created = await _sdk
            .invoke('opengrowApplicationCreateCustomJobJson', {
              'capability': capability,
              'payload': payload,
              'idempotency_key': idempotencyKey,
            });
        final createdMap = _objectValue(created);
        final jobId =
            createdMap['id']?.toString() ??
            _objectValue(createdMap['data'])['id']?.toString() ??
            '';
        if (jobId.isEmpty) {
          throw const FormatException(
            'Custom job creation returned no job identifier.',
          );
        }
        final listed = await _sdk.invoke(
          'opengrowApplicationListCustomJobsJson',
          {'limit': 10, 'status': 'completed', 'capability': capability},
        );
        final detail = await _sdk.invoke(
          'opengrowApplicationGetCustomJobJson',
          {'job_id': jobId},
        );
        Object cancellation;
        try {
          await _sdk.invoke('opengrowApplicationCancelCustomJobJson', {
            'job_id': jobId,
          });
          throw const FormatException(
            'A completed reference job was unexpectedly cancellable.',
          );
        } on OpenGrowApplicationException catch (error) {
          if (error.code != 'job_not_cancellable' || error.statusCode != 409) {
            rethrow;
          }
          cancellation = {
            'status': 'terminal',
            'code': error.code,
            'http_status': error.statusCode,
          };
        }
        return _LiveExecution('$capability.create-list-detail-cancel', {
          'created': created,
          'list': listed,
          'detail': detail,
          'cancellation': cancellation,
        });
      case ReferenceFeatureId.diagnostics:
        final health = await _request('GET', '/health');
        return _LiveExecution('loadHealth', {
          'configuration': configuration.diagnostics(),
          'health': health,
        });
    }
  }

  Future<_LiveExecution> _executeSupport(Map<String, dynamic> input) async {
    final operation = input['operation']?.toString() ?? 'list';
    final action = switch (operation) {
      'configuration' => 'opengrowSupportGetConfigurationJson',
      'open' => 'opengrowSupportOpenConversation',
      'update' => 'opengrowSupportUpdateConversationJson',
      'messages' => 'opengrowSupportMessagesJson',
      'send' => 'opengrowSupportSendAdvanced',
      'upload_attachment' => 'opengrowSupportUploadAttachmentJson',
      'download_attachment' => 'opengrowSupportDownloadAttachment',
      'send_attachment' => 'opengrowSupportSendAttachment',
      'mark_read' => 'opengrowSupportMarkRead',
      'typing' => 'opengrowSupportSetTyping',
      'connect' => 'opengrowSupportConnectRealtime',
      'disconnect' => 'opengrowSupportDisconnectRealtime',
      'realtime_event' => 'opengrowSupportGetLastRealtimeEventJson',
      'csat' => 'opengrowSupportSubmitCsatJson',
      'list' => 'opengrowSupportListConversationsJson',
      _ => throw FormatException('Unsupported Support operation: $operation'),
    };
    final result = await _sdk.invoke(action, input);
    return _LiveExecution(
      action,
      action == 'opengrowSupportDownloadAttachment'
          ? _downloadProof(result)
          : result,
    );
  }

  Future<void> _initializeSupport(ReferenceState state) async {
    await _sdk.invoke('opengrowSupportInitializeAuthenticated', {
      'application_access_token': state.applicationAccessToken,
      'project_id': configuration.projectId,
      'auth_gateway_url': configuration.apiBaseUrl,
      'support_url': configuration.supportBaseUrl,
    });
  }

  Future<Object?> _request(
    String method,
    String path, {
    String token = '',
    Map<String, dynamic>? body,
    Map<String, String> headers = const {},
  }) async {
    final base = configuration.apiBaseUrl.replaceFirst(RegExp(r'/+$'), '');
    final request = http.Request(method, Uri.parse('$base$path'));
    request.headers['accept'] = 'application/json';
    if (token.isNotEmpty) request.headers['authorization'] = 'Bearer $token';
    request.headers.addAll(headers);
    if (body != null) {
      request.headers['content-type'] = 'application/json; charset=utf-8';
      request.body = jsonEncode(body);
    }
    final response = await _client
        .send(request)
        .timeout(const Duration(seconds: 10));
    final bytes = <int>[];
    await for (final chunk in response.stream.timeout(
      const Duration(seconds: 10),
    )) {
      bytes.addAll(chunk);
      if (bytes.length > 1024 * 1024) {
        throw const FormatException('OpenGrow response exceeded 1 MiB.');
      }
    }
    final text = utf8.decode(bytes);
    Object? payload;
    try {
      payload = text.isEmpty ? const <String, Object?>{} : jsonDecode(text);
    } catch (_) {
      payload = {'message': text};
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw ReferenceHttpException(response.statusCode, payload);
    }
    return payload;
  }

  void _applySession(ReferenceState state, Object? payload) {
    if (payload is! Map) {
      throw const FormatException('Identity response is invalid.');
    }
    final token = payload['access_token']?.toString() ?? '';
    final authenticated = payload['authenticated'];
    final user = payload['user'];
    final userId =
        payload['user_id']?.toString() ??
        (user is Map ? user['id']?.toString() : null) ??
        '';
    if (authenticated == false) {
      state.clearSession();
      return;
    }
    if (token.isEmpty || userId.isEmpty) {
      throw const FormatException('Identity session is incomplete.');
    }
    state.setSession(accessToken: token, userId: userId);
  }

  Future<void> _ensureApplication(ReferenceState state) async {
    if (!_applicationInitialized) {
      await _sdk.invoke('opengrowApplicationInitialize', {
        'api_base_url': configuration.apiBaseUrl,
        'files_base_url': configuration.filesBaseUrl,
        'project_key': configuration.projectKey,
        'platform': configuration.sdkPlatform,
        'identifier': configuration.sdkIdentifier,
        'environment': configuration.projectEnvironment,
      });
      _applicationInitialized = true;
      final restored = await _sdk.invoke(
        'opengrowApplicationCurrentSessionJson',
        const {},
      );
      _applySession(state, restored);
    }
  }
}

class ReferenceHttpException implements Exception {
  const ReferenceHttpException(this.statusCode, this.payload);
  final int statusCode;
  final Object? payload;

  @override
  String toString() =>
      'OpenGrow request failed with HTTP $statusCode: $payload';
}

String _stateChannel(ReferenceFeatureId id) => switch (id) {
  ReferenceFeatureId.dynamicLinks => 'deepLink',
  ReferenceFeatureId.paywall => 'purchase',
  ReferenceFeatureId.products => 'customer',
  ReferenceFeatureId.support => 'support',
  ReferenceFeatureId.notifications => 'notification',
  ReferenceFeatureId.files => 'file',
  ReferenceFeatureId.marketingConsent => 'marketing',
  ReferenceFeatureId.onboarding => 'onboarding',
  ReferenceFeatureId.customExtension => 'customJob',
  _ => 'status',
};

String _sanitizeError(Object error) {
  final message = error.toString();
  return message.length <= 1000 ? message : '${message.substring(0, 1000)}…';
}

Map<String, dynamic> _decodeJson(String value) {
  final decoded = jsonDecode(value);
  if (decoded is! Map) {
    throw const FormatException('OpenGrow response must be a JSON object.');
  }
  return decoded.cast<String, dynamic>();
}

Object? _decodeOptionalJson(String value) {
  if (value.trim().isEmpty) return null;
  final decoded = jsonDecode(value);
  if (decoded is Map) return decoded.cast<String, dynamic>();
  if (decoded is List) return decoded;
  return decoded;
}

String _string(Map<String, dynamic> values, String name) {
  final value = values[name]?.toString().trim() ?? '';
  if (value.isEmpty) throw FormatException('$name is required.');
  return value;
}

String _optionalString(
  Map<String, dynamic> values,
  String name, [
  String fallback = '',
]) {
  final value = values[name]?.toString().trim() ?? '';
  return value.isEmpty ? fallback : value;
}

String? _nullableString(Map<String, dynamic> values, String name) {
  final value = values[name]?.toString().trim() ?? '';
  return value.isEmpty ? null : value;
}

int _integer(Map<String, dynamic> values, String name, [int? fallback]) {
  final raw = values[name];
  if (raw == null && fallback != null) return fallback;
  final value = raw is int ? raw : int.tryParse(raw?.toString() ?? '');
  if (value == null) throw FormatException('$name must be an integer.');
  return value;
}

bool _boolean(Map<String, dynamic> values, String name) {
  final raw = values[name];
  if (raw is bool) return raw;
  if (raw == 'true' || raw == 1) return true;
  if (raw == 'false' || raw == 0) return false;
  throw FormatException('$name must be a boolean.');
}

Map<String, dynamic> _object(Map<String, dynamic> values, String name) {
  final value = values[name];
  if (value == null) return <String, dynamic>{};
  if (value is! Map) throw FormatException('$name must be a JSON object.');
  return value.cast<String, dynamic>();
}

Map<String, dynamic> _objectValue(Object? value) {
  if (value is! Map) return <String, dynamic>{};
  return value.cast<String, dynamic>();
}

Object? _unwrapData(Object? value) {
  if (value is Map && value.containsKey('data')) return value['data'];
  return value;
}

Uint8List _byteInput(Map<String, dynamic> values) {
  final encoded = values['bytes_base64']?.toString().trim() ?? '';
  if (encoded.isNotEmpty) {
    try {
      return base64Decode(encoded);
    } catch (_) {
      throw const FormatException('bytes_base64 is not valid base64.');
    }
  }
  if (values.containsKey('text')) {
    return Uint8List.fromList(utf8.encode(values['text']?.toString() ?? ''));
  }
  throw const FormatException('text or bytes_base64 is required.');
}

Map<String, Object?> _downloadProof(Object? value) {
  if (value is! Uint8List) {
    throw const FormatException('Download did not return bytes.');
  }
  const previewLimit = 64 * 1024;
  return {
    'byte_length': value.length,
    'content_included': value.length <= previewLimit,
    'bytes_base64': value.length <= previewLimit ? base64Encode(value) : null,
    'preview_limit': previewLimit,
  };
}
