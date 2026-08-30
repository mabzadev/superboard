import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:superboard_flutterflow/superboard_flutterflow.dart';

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

/// Thin injectable bridge over the public SuperBoard FlutterFlow surface.
///
/// The live reference app invokes only these public actions. Tests replace the
/// bridge with a recorder so every advertised journey proves its actual action
/// dispatch without copying any SDK implementation into this repository.
abstract interface class ReferenceSdkBridge {
  Future<Object?> invoke(String action, Map<String, dynamic> parameters);
}

class SuperBoardReferenceSdkBridge implements ReferenceSdkBridge {
  const SuperBoardReferenceSdkBridge();

  @override
  Future<Object?> invoke(String action, Map<String, dynamic> parameters) async {
    switch (action) {
      case 'superboardApplicationInitialize':
        return superboardApplicationInitialize(
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
      case 'superboardApplicationSetAccessToken':
        return superboardApplicationSetAccessToken(
          _optionalString(parameters, 'application_access_token'),
        );
      case 'superboardApplicationRestoreSessionJson':
        return _decodeJson(await superboardApplicationRestoreSessionJson());
      case 'superboardApplicationCurrentSessionJson':
        return _decodeJson(await superboardApplicationCurrentSessionJson());
      case 'superboardApplicationAccessToken':
        return superboardApplicationAccessToken();
      case 'superboardInitializeAuto':
        return superboardInitializeAuto(
          projectKey: _string(parameters, 'project_key'),
          sdkBaseUrl: _string(parameters, 'sdk_base_url'),
        );
      case 'superboardInitializeAuthenticated':
        return superboardInitializeAuthenticated(
          projectKey: _string(parameters, 'project_key'),
          applicationAccessToken: _string(
            parameters,
            'application_access_token',
          ),
          sdkBaseUrl: _string(parameters, 'sdk_base_url'),
          authGatewayBaseUrl: _string(parameters, 'auth_gateway_base_url'),
        );
      case 'superboardApplicationRuntimePolicyJson':
        return _decodeJson(
          await superboardApplicationRuntimePolicyJson(
            appVersion: _string(parameters, 'app_version'),
            build: _optionalString(parameters, 'build'),
          ),
        );
      case 'superboardApplicationSignInPasswordJson':
        return _decodeJson(
          await superboardApplicationSignInPasswordJson(
            email: _string(parameters, 'email'),
            password: _string(parameters, 'password'),
          ),
        );
      case 'superboardApplicationSignInProviderJson':
        return _decodeJson(
          await superboardApplicationSignInProviderJson(
            provider: _string(parameters, 'provider'),
            idToken: _string(parameters, 'id_token'),
            name: _optionalString(parameters, 'name'),
          ),
        );
      case 'superboardApplicationRefreshJson':
        return _decodeJson(
          await superboardApplicationRefreshJson(
            _string(parameters, 'refresh_token'),
          ),
        );
      case 'superboardApplicationRegisterJson':
        return _decodeJson(
          await superboardApplicationRegisterJson(
            email: _string(parameters, 'email'),
            password: _string(parameters, 'password'),
            name: _optionalString(parameters, 'name'),
          ),
        );
      case 'superboardApplicationRequestPasswordResetJson':
        return _decodeJson(
          await superboardApplicationRequestPasswordResetJson(
            _string(parameters, 'email'),
          ),
        );
      case 'superboardApplicationResetPasswordJson':
        return _decodeJson(
          await superboardApplicationResetPasswordJson(
            token: _string(parameters, 'token'),
            password: _string(parameters, 'password'),
          ),
        );
      case 'superboardApplicationProfileJson':
        return _decodeJson(await superboardApplicationProfileJson());
      case 'superboardApplicationUpdateProfileJson':
        return _decodeJson(
          await superboardApplicationUpdateProfileJson(
            _string(parameters, 'name'),
          ),
        );
      case 'superboardApplicationLogoutJson':
        return _decodeJson(await superboardApplicationLogoutJson());
      case 'superboardApplicationDeleteAccountJson':
        return _decodeJson(await superboardApplicationDeleteAccountJson());
      case 'superboardApplicationMarketingPreferencesJson':
        return _decodeJson(
          await superboardApplicationMarketingPreferencesJson(),
        );
      case 'superboardApplicationUpdateMarketingConsentJson':
        return _decodeJson(
          await superboardApplicationUpdateMarketingConsentJson(
            consented: _boolean(parameters, 'consented'),
            idempotencyKey: _string(parameters, 'idempotency_key'),
            attributesJson: jsonEncode(_object(parameters, 'attributes')),
            listIdsJson: jsonEncode(parameters['list_ids'] ?? const []),
          ),
        );
      case 'superboardIdentify':
        return superboardIdentify(
          userIdentifier: _string(parameters, 'user_identifier'),
          identityToken: _optionalString(parameters, 'identity_token'),
        );
      case 'superboardSetUserAttributesJson':
        return superboardSetUserAttributesJson(
          jsonEncode(_object(parameters, 'attributes')),
        );
      case 'superboardSetPushToken':
        return superboardSetPushToken(_string(parameters, 'push_token'));
      case 'superboardGetUnreadMessageCount':
        return {'unread': await superboardGetUnreadMessageCount()};
      case 'superboardDisplayMessages':
        return {'displayed': await superboardDisplayMessages()};
      case 'superboardApplicationListFilesJson':
        return _decodeJson(
          await superboardApplicationListFilesJson(
            limit: _integer(parameters, 'limit', 50),
            offset: _integer(parameters, 'offset', 0),
          ),
        );
      case 'superboardApplicationUploadFileJson':
        return _decodeJson(
          await superboardApplicationUploadFileJson(
            bytes: _byteInput(parameters),
            filename: _string(parameters, 'filename'),
            contentType: _string(parameters, 'content_type'),
          ),
        );
      case 'superboardApplicationDownloadFile':
        return superboardApplicationDownloadFile(
          _string(parameters, 'file_id'),
        );
      case 'superboardApplicationDeleteFileJson':
        return _decodeJson(
          await superboardApplicationDeleteFileJson(
            _string(parameters, 'file_id'),
          ),
        );
      case 'superboardGetOfferings':
        return _decodeJson(
          await superboardGetOfferings(
            placement: _optionalString(parameters, 'placement', 'default'),
          ),
        );
      case 'superboardGetCustomerInfoJson':
        return _decodeJson(await superboardGetCustomerInfoJson());
      case 'superboardGetLastVerifiedCustomerInfoJson':
        return _decodeOptionalJson(
          await superboardGetLastVerifiedCustomerInfoJson(),
        );
      case 'superboardRestore':
        return {'restored': await superboardRestore()};
      case 'superboardGetPurchaseConfigurationJson':
        return _decodeJson(
          await superboardGetPurchaseConfigurationJson(
            placement: _optionalString(parameters, 'placement', 'default'),
          ),
        );
      case 'superboardPurchase':
        return _decodeJson(
          await superboardPurchase(
            packageIdentifier: _string(parameters, 'package_identifier'),
            offeringIdentifier: _optionalString(
              parameters,
              'offering_identifier',
            ),
          ),
        );
      case 'superboardGetLastPurchaseResultJson':
        return _decodeOptionalJson(await superboardGetLastPurchaseResultJson());
      case 'superboardGenerateLinkJson':
        return {
          'url': await superboardGenerateLinkJson(
            jsonEncode(_object(parameters, 'parameters')),
          ),
        };
      case 'superboardGetLastDeepLinkJson':
        return _decodeOptionalJson(await superboardGetLastDeepLinkJson());
      case 'superboardSupportInitializeAuthenticated':
        return superboardSupportInitializeAuthenticated(
          applicationAccessToken: _string(
            parameters,
            'application_access_token',
          ),
          projectId: _integer(parameters, 'project_id'),
          authGatewayUrl: _string(parameters, 'auth_gateway_url'),
          supportUrl: _string(parameters, 'support_url'),
        );
      case 'superboardSupportGetConfigurationJson':
        return _decodeJson(await superboardSupportGetConfigurationJson());
      case 'superboardSupportListConversationsJson':
        return _decodeJson(await superboardSupportListConversationsJson());
      case 'superboardSupportOpenConversation':
        return _decodeJson(
          await superboardSupportOpenConversation(
            clientConversationId: _string(parameters, 'client_conversation_id'),
            subject: _nullableString(parameters, 'subject'),
            inboxId: _nullableString(parameters, 'inbox_id'),
            customAttributesJson: jsonEncode(
              _object(parameters, 'custom_attributes'),
            ),
          ),
        );
      case 'superboardSupportUpdateConversationJson':
        return _decodeJson(
          await superboardSupportUpdateConversationJson(
            conversationId: _string(parameters, 'conversation_id'),
            status: _nullableString(parameters, 'status'),
            customAttributesJson: parameters.containsKey('custom_attributes')
                ? jsonEncode(_object(parameters, 'custom_attributes'))
                : null,
          ),
        );
      case 'superboardSupportMessagesJson':
        return _decodeJson(
          await superboardSupportMessagesJson(
            _string(parameters, 'conversation_id'),
            beforeSequence: parameters['before_sequence'] == null
                ? null
                : _integer(parameters, 'before_sequence'),
            limit: _integer(parameters, 'limit', 50),
          ),
        );
      case 'superboardSupportSendAdvanced':
        return _decodeJson(
          await superboardSupportSendAdvanced(
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
      case 'superboardSupportSubmitCsatJson':
        return _decodeJson(
          await superboardSupportSubmitCsatJson(
            conversationId: _string(parameters, 'conversation_id'),
            rating: _integer(parameters, 'rating'),
            feedback: _nullableString(parameters, 'feedback'),
          ),
        );
      case 'superboardSupportUploadAttachmentJson':
        return _decodeJson(
          await superboardSupportUploadAttachmentJson(
            conversationId: _string(parameters, 'conversation_id'),
            bytes: _byteInput(parameters),
            filename: _string(parameters, 'filename'),
            contentType: _string(parameters, 'content_type'),
          ),
        );
      case 'superboardSupportDownloadAttachment':
        return superboardSupportDownloadAttachment(
          conversationId: _string(parameters, 'conversation_id'),
          messageId: _string(parameters, 'message_id'),
          attachmentId: _nullableString(parameters, 'attachment_id'),
        );
      case 'superboardSupportSendAttachment':
        return _decodeJson(
          await superboardSupportSendAttachment(
            conversationId: _string(parameters, 'conversation_id'),
            attachmentJson: jsonEncode(_object(parameters, 'attachment')),
            clientMessageId: _string(parameters, 'client_message_id'),
            body: _optionalString(parameters, 'body'),
          ),
        );
      case 'superboardSupportMarkRead':
        return _decodeJson(
          await superboardSupportMarkRead(
            _string(parameters, 'conversation_id'),
          ),
        );
      case 'superboardSupportSetTyping':
        return {
          'typing': await superboardSupportSetTyping(
            _string(parameters, 'conversation_id'),
            _boolean(parameters, 'active'),
          ),
        };
      case 'superboardSupportConnectRealtime':
        return {
          'connected': await superboardSupportConnectRealtime(
            _string(parameters, 'conversation_id'),
          ),
        };
      case 'superboardSupportDisconnectRealtime':
        return {'disconnected': await superboardSupportDisconnectRealtime()};
      case 'superboardSupportGetLastRealtimeEventJson':
        return _decodeOptionalJson(
          await superboardSupportGetLastRealtimeEventJson(),
        );
      case 'superboardApplicationCreateCustomJobJson':
        return _decodeJson(
          await superboardApplicationCreateCustomJobJson(
            capability: _string(parameters, 'capability'),
            payloadJson: jsonEncode(_object(parameters, 'payload')),
            idempotencyKey: _string(parameters, 'idempotency_key'),
          ),
        );
      case 'superboardApplicationListCustomJobsJson':
        return _decodeJson(
          await superboardApplicationListCustomJobsJson(
            limit: _integer(parameters, 'limit', 25),
            status: _optionalString(parameters, 'status'),
            capability: _optionalString(parameters, 'capability'),
            cursor: _optionalString(parameters, 'cursor'),
          ),
        );
      case 'superboardApplicationGetCustomJobJson':
        return _decodeJson(
          await superboardApplicationGetCustomJobJson(
            _string(parameters, 'job_id'),
          ),
        );
      case 'superboardApplicationCancelCustomJobJson':
        return _decodeJson(
          await superboardApplicationCancelCustomJobJson(
            _string(parameters, 'job_id'),
          ),
        );
      default:
        throw UnsupportedError(
          'Unsupported SuperBoard reference action: $action',
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
       _sdk = sdk ?? const SuperBoardReferenceSdkBridge();

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
          await _sdk.invoke('superboardInitializeAuto', {
            'project_key': configuration.projectKey,
            'sdk_base_url': configuration.sdkBaseUrl,
          });
        } else {
          await _sdk.invoke('superboardInitializeAuthenticated', {
            'project_key': configuration.projectKey,
            'application_access_token': state.applicationAccessToken,
            'sdk_base_url': configuration.sdkBaseUrl,
            'auth_gateway_base_url': configuration.apiBaseUrl,
          });
        }
        final runtimePolicy = await _sdk
            .invoke('superboardApplicationRuntimePolicyJson', {
              'app_version': input['app_version']?.toString() ?? '0.1.0',
              'build': input['build']?.toString() ?? '1',
            });
        return _LiveExecution('superboardApplicationRuntimePolicyJson', {
          ...configuration.diagnostics(),
          'runtime_policy': _unwrapData(runtimePolicy),
        });
      case ReferenceFeatureId.signIn:
        final provider = input['provider']?.toString();
        final operation = provider == 'google' || provider == 'apple'
            ? 'superboardApplicationSignInProviderJson'
            : 'superboardApplicationSignInPasswordJson';
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
        const operation = 'superboardApplicationRegisterJson';
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
            ? 'superboardApplicationResetPasswordJson'
            : 'superboardApplicationRequestPasswordResetJson';
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
          'superboardApplicationProfileJson',
          const {},
        );
        final policy = await _sdk
            .invoke('superboardApplicationRuntimePolicyJson', {
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
            'superboardApplicationDeleteAccountJson',
            const {},
          );
          state.clearSession();
          return _LiveExecution(
            'superboardApplicationDeleteAccountJson',
            result,
          );
        }
        if (input['operation'] == 'logout') {
          final result = await _sdk.invoke(
            'superboardApplicationLogoutJson',
            const {},
          );
          state.clearSession();
          return _LiveExecution('superboardApplicationLogoutJson', result);
        }
        if (input['operation'] == 'update_profile') {
          return _LiveExecution(
            'superboardApplicationUpdateProfileJson',
            await _sdk.invoke('superboardApplicationUpdateProfileJson', {
              'name': input['name']?.toString() ?? '',
            }),
          );
        }
        if (input['operation'] == 'identify') {
          return _LiveExecution(
            'superboardIdentify',
            await _sdk.invoke('superboardIdentify', {
              'user_identifier':
                  input['user_identifier']?.toString() ?? state.currentUserId,
              'identity_token': input['identity_token']?.toString() ?? '',
            }),
          );
        }
        if (input['operation'] == 'attributes') {
          return _LiveExecution(
            'superboardSetUserAttributesJson',
            await _sdk.invoke('superboardSetUserAttributesJson', {
              'attributes': input['attributes'] is Map
                  ? input['attributes']
                  : const <String, Object?>{},
            }),
          );
        }
        return _LiveExecution(
          'superboardApplicationProfileJson',
          await _sdk.invoke('superboardApplicationProfileJson', const {}),
        );
      case ReferenceFeatureId.notifications:
        final operation = input['operation']?.toString() ?? 'inspect';
        if (operation == 'register') {
          await _sdk.invoke('superboardSetPushToken', {
            'push_token': input['push_token']?.toString() ?? '',
          });
        } else if (operation == 'display') {
          return _LiveExecution(
            'superboardDisplayMessages',
            await _sdk.invoke('superboardDisplayMessages', const {}),
          );
        }
        return _LiveExecution(
          operation == 'register'
              ? 'superboardSetPushToken'
              : 'superboardGetUnreadMessageCount',
          await _sdk.invoke('superboardGetUnreadMessageCount', const {}),
        );
      case ReferenceFeatureId.files:
        final operation = input['operation']?.toString() ?? 'list';
        if (operation == 'upload') {
          return _LiveExecution(
            'superboardApplicationUploadFileJson',
            await _sdk.invoke('superboardApplicationUploadFileJson', input),
          );
        }
        if (operation == 'download') {
          final bytes = await _sdk.invoke(
            'superboardApplicationDownloadFile',
            input,
          );
          return _LiveExecution(
            'superboardApplicationDownloadFile',
            _downloadProof(bytes),
          );
        }
        if (operation == 'delete') {
          return _LiveExecution(
            'superboardApplicationDeleteFileJson',
            await _sdk.invoke('superboardApplicationDeleteFileJson', input),
          );
        }
        return _LiveExecution(
          'superboardApplicationListFilesJson',
          await _sdk.invoke('superboardApplicationListFilesJson', input),
        );
      case ReferenceFeatureId.products:
        if (input['operation'] == 'restore') {
          final restored = await _sdk.invoke('superboardRestore', const {});
          final customer = await _sdk.invoke(
            'superboardGetCustomerInfoJson',
            const {},
          );
          return _LiveExecution('superboardRestore', {
            'restore': restored,
            'customer_info': _unwrapData(customer),
          });
        }
        final offerings = await _sdk.invoke('superboardGetOfferings', input);
        final customer = await _sdk.invoke(
          'superboardGetCustomerInfoJson',
          const {},
        );
        final verified = await _sdk.invoke(
          'superboardGetLastVerifiedCustomerInfoJson',
          const {},
        );
        return _LiveExecution('inspectProductsAndCustomerInfo', {
          'offerings': _unwrapData(offerings),
          'customer_info': _unwrapData(customer),
          'last_verified_customer_info': _unwrapData(verified),
        });
      case ReferenceFeatureId.paywall:
        if (input['operation'] == 'purchase') {
          final purchase = await _sdk.invoke('superboardPurchase', input);
          final latest = await _sdk.invoke(
            'superboardGetLastPurchaseResultJson',
            const {},
          );
          return _LiveExecution('superboardPurchase', {
            'purchase': _unwrapData(purchase),
            'last_result': _unwrapData(latest),
          });
        }
        return _LiveExecution(
          'superboardGetPurchaseConfigurationJson',
          await _sdk.invoke('superboardGetPurchaseConfigurationJson', input),
        );
      case ReferenceFeatureId.dynamicLinks:
        if (input['operation'] == 'last') {
          return _LiveExecution(
            'superboardGetLastDeepLinkJson',
            await _sdk.invoke('superboardGetLastDeepLinkJson', const {}),
          );
        }
        final link = await _sdk.invoke('superboardGenerateLinkJson', {
          'parameters': {
            'title': input['title']?.toString() ?? 'SuperBoard reference',
            'data': input['data'] is Map
                ? input['data']
                : {'source': 'superboard-reference'},
          },
        });
        return _LiveExecution('superboardGenerateLinkJson', {
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
              ? 'superboardApplicationMarketingPreferencesJson'
              : 'superboardApplicationUpdateMarketingConsentJson',
          await _sdk.invoke(
            load
                ? 'superboardApplicationMarketingPreferencesJson'
                : 'superboardApplicationUpdateMarketingConsentJson',
            input,
          ),
        );
      case ReferenceFeatureId.onboarding:
        return _LiveExecution('SuperBoardOnboarding', {
          'widget': 'SuperBoardOnboarding',
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
            : const <String, Object?>{'message': 'SuperBoard reference'};
        final idempotencyKey =
            input['idempotency_key']?.toString().trim() ?? '';
        if (idempotencyKey.isEmpty) {
          throw const FormatException(
            'A stable idempotency_key is required for the custom extension.',
          );
        }
        final created = await _sdk
            .invoke('superboardApplicationCreateCustomJobJson', {
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
          'superboardApplicationListCustomJobsJson',
          {'limit': 10, 'status': 'completed', 'capability': capability},
        );
        final detail = await _sdk.invoke(
          'superboardApplicationGetCustomJobJson',
          {'job_id': jobId},
        );
        Object cancellation;
        try {
          await _sdk.invoke('superboardApplicationCancelCustomJobJson', {
            'job_id': jobId,
          });
          throw const FormatException(
            'A completed reference job was unexpectedly cancellable.',
          );
        } on SuperBoardApplicationException catch (error) {
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
      'configuration' => 'superboardSupportGetConfigurationJson',
      'open' => 'superboardSupportOpenConversation',
      'update' => 'superboardSupportUpdateConversationJson',
      'messages' => 'superboardSupportMessagesJson',
      'send' => 'superboardSupportSendAdvanced',
      'upload_attachment' => 'superboardSupportUploadAttachmentJson',
      'download_attachment' => 'superboardSupportDownloadAttachment',
      'send_attachment' => 'superboardSupportSendAttachment',
      'mark_read' => 'superboardSupportMarkRead',
      'typing' => 'superboardSupportSetTyping',
      'connect' => 'superboardSupportConnectRealtime',
      'disconnect' => 'superboardSupportDisconnectRealtime',
      'realtime_event' => 'superboardSupportGetLastRealtimeEventJson',
      'csat' => 'superboardSupportSubmitCsatJson',
      'list' => 'superboardSupportListConversationsJson',
      _ => throw FormatException('Unsupported Support operation: $operation'),
    };
    final result = await _sdk.invoke(action, input);
    return _LiveExecution(
      action,
      action == 'superboardSupportDownloadAttachment'
          ? _downloadProof(result)
          : result,
    );
  }

  Future<void> _initializeSupport(ReferenceState state) async {
    await _sdk.invoke('superboardSupportInitializeAuthenticated', {
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
        throw const FormatException('SuperBoard response exceeded 1 MiB.');
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
      await _sdk.invoke('superboardApplicationInitialize', {
        'api_base_url': configuration.apiBaseUrl,
        'files_base_url': configuration.filesBaseUrl,
        'project_key': configuration.projectKey,
        'platform': configuration.sdkPlatform,
        'identifier': configuration.sdkIdentifier,
        'environment': configuration.projectEnvironment,
      });
      _applicationInitialized = true;
      final restored = await _sdk.invoke(
        'superboardApplicationCurrentSessionJson',
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
      'SuperBoard request failed with HTTP $statusCode: $payload';
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
    throw const FormatException('SuperBoard response must be a JSON object.');
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
