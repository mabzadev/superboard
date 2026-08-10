import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:superboard_flutter/superboard_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import 'models.dart';

/// Ephemeral values emitted by native callbacks for no-code action flows.
///
/// Deep-link payloads are deliberately kept in memory and are never persisted.
abstract final class SuperBoardFlutterFlowState {
  static String lastDeepLinkJson = '';
  static String lastPurchaseResultJson = '';
  static String lastVerifiedCustomerInfoJson = '';
  static String lastError = '';
}

/// Emits only CustomerInfo payloads that have already passed SDK JWS
/// verification. Hosts can use this stream to update no-code application
/// state when a pending or recovered purchase resolves asynchronously.
Stream<String> get superboardVerifiedCustomerInfoJsonStream =>
    SuperBoardPurchases.instance.customerInfoStream.map(
      (customerInfo) => jsonEncode(customerInfo.toJson()),
    );

/// Emits structured terminal and pending purchase results for host bridges.
Stream<String> get superboardPurchaseResultJsonStream => SuperBoardPurchases
    .instance
    .purchaseResultStream
    .map((result) => jsonEncode(result.toJson()));

Future<bool> superboardInitialize({
  required String projectKey,
  required String platformIdentifier,
  required String purchasesBaseUrl,
  String identityToken = '',
  String appVersion = '',
  String buildNumber = '',
  String sdkVersion = '3.0.0',
}) async {
  await SuperBoardPurchases.instance.configure(
    projectKey: projectKey,
    platformIdentifier: platformIdentifier,
    baseUrl: purchasesBaseUrl,
    identityToken: identityToken.isEmpty ? null : identityToken,
    appVersion: appVersion,
    buildNumber: buildNumber,
    sdkVersion: sdkVersion,
  );
  return true;
}

/// Initializes SuperBoard Purchases using the Bundle ID/package name reported by
/// the native app. The native SuperBoard SDK itself is configured automatically
/// from Info.plist/AndroidManifest.xml before this action runs.
Future<bool> superboardInitializeAuto({
  required String projectKey,
  required String sdkBaseUrl,
  String identityToken = '',
  String appVersion = '',
  String buildNumber = '',
  String sdkVersion = '3.0.0',
}) async {
  final platformIdentifier = await SuperBoard().getPlatformIdentifier();
  return superboardInitialize(
    projectKey: projectKey,
    platformIdentifier: platformIdentifier,
    purchasesBaseUrl: _purchasesBaseUrl(sdkBaseUrl),
    identityToken: identityToken,
    appVersion: appVersion,
    buildNumber: buildNumber,
    sdkVersion: sdkVersion,
  );
}

/// Initializes Purchases only after the application authentication gateway has
/// exchanged its existing access token for a short-lived ES256 identity token.
Future<bool> superboardInitializeAuthenticated({
  required String projectKey,
  required String applicationAccessToken,
  required String sdkBaseUrl,
  required String authGatewayBaseUrl,
  String appVersion = '',
  String buildNumber = '',
  String sdkVersion = '3.0.0',
}) async {
  if (applicationAccessToken.trim().isEmpty) {
    throw const SuperBoardPurchasesException(
      'Application authentication is required before Purchases initialization',
      code: 'identity_required',
    );
  }
  Future<String?> tokenProvider() async {
    final client = http.Client();
    try {
      try {
        final response = await client
            .post(
              Uri.parse(
                '${authGatewayBaseUrl.replaceFirst(RegExp(r'/+$'), '')}/auth/opengrow-token',
              ),
              headers: {
                'Authorization': 'Bearer ${applicationAccessToken.trim()}',
                'Accept': 'application/json',
              },
            )
            .timeout(const Duration(seconds: 10));
        dynamic body;
        try {
          body = response.body.isEmpty ? const {} : jsonDecode(response.body);
        } catch (_) {
          throw const SuperBoardPurchasesException(
            'Identity synchronization returned an invalid response',
            code: 'identity_response_invalid',
            retryable: true,
          );
        }
        final token = body is Map ? body['access_token']?.toString() : null;
        if (response.statusCode != 200 || token == null || token.isEmpty) {
          final error = body is Map && body['error'] is Map
              ? body['error'] as Map
              : null;
          throw SuperBoardPurchasesException(
            'Identity synchronization failed',
            code: error?['code']?.toString() ?? 'identity_sync_failed',
            retryable:
                response.statusCode == 408 ||
                response.statusCode == 429 ||
                response.statusCode >= 500,
            requestId:
                error?['request_id']?.toString() ??
                response.headers['x-request-id'],
          );
        }
        return token;
      } on TimeoutException {
        throw const SuperBoardPurchasesException(
          'Identity synchronization timed out',
          code: 'identity_timeout',
          retryable: true,
        );
      } on http.ClientException {
        throw const SuperBoardPurchasesException(
          'Identity synchronization is unavailable',
          code: 'identity_network_unavailable',
          retryable: true,
        );
      }
    } finally {
      client.close();
    }
  }

  final initialToken = await tokenProvider();
  final platformIdentifier = await SuperBoard().getPlatformIdentifier();
  final base = sdkBaseUrl.replaceFirst(RegExp(r'/+$'), '');
  await SuperBoardPurchases.instance.configure(
    projectKey: projectKey,
    platformIdentifier: platformIdentifier,
    baseUrl: _purchasesBaseUrl(base),
    identityToken: initialToken,
    identityTokenProvider: tokenProvider,
    appVersion: appVersion,
    buildNumber: buildNumber,
    sdkVersion: sdkVersion,
  );
  return true;
}

String _purchasesBaseUrl(String sdkBaseUrl) {
  final base = sdkBaseUrl
      .replaceFirst(RegExp(r'/+$'), '')
      .replaceFirst(RegExp(r'/purchases/v\d+$'), '');
  return '$base/purchases/v2';
}

/// Submits structured evidence from the authenticated FlutterFlow build to an
/// active Purchases certification run. The challenge is issued from the
/// dashboard and is never persisted by this wrapper.
Future<String> superboardRecordCertificationResultJson({
  required String runId,
  required String deviceChallenge,
  required String checkKey,
  required bool passed,
  required String deviceModel,
  required String osVersion,
  required String assertionsJson,
  String resultId = '',
}) async {
  final decoded = jsonDecode(assertionsJson);
  if (decoded is! Map) {
    throw const FormatException(
      'Certification assertions must be a JSON object',
    );
  }
  final result = await SuperBoardPurchases.instance.submitCertificationResult(
    runId: runId,
    challenge: deviceChallenge,
    checkKey: checkKey,
    passed: passed,
    deviceModel: deviceModel,
    osVersion: osVersion,
    assertions: decoded.cast<String, dynamic>(),
    resultId: resultId.trim().isEmpty ? null : resultId.trim(),
  );
  return jsonEncode(result.toJson());
}

/// Associates both SuperBoard attribution and verified purchases with a user.
///
/// Pass the server-issued SuperBoard identity JWT when purchase identity should
/// be merged. The JWT is never persisted by this wrapper.
Future<bool> superboardIdentify({
  required String userIdentifier,
  String identityToken = '',
}) async {
  await SuperBoard().setUserIdentifier(userIdentifier);
  if (identityToken.isNotEmpty) {
    await SuperBoardPurchases.instance.logIn(identityToken);
  }
  return true;
}

Future<bool> superboardPurchaseLogin(String identityToken) async {
  await SuperBoardPurchases.instance.logIn(identityToken);
  return true;
}

Future<bool> superboardPurchaseLogout() async {
  await SuperBoardPurchases.instance.logOut();
  return true;
}

Future<bool> superboardSetUserAttributesJson(String attributesJson) async {
  final decoded = jsonDecode(attributesJson);
  if (decoded is! Map) {
    throw const FormatException('User attributes must be a JSON object');
  }
  await SuperBoard().setUserAttributes(decoded.cast<String, dynamic>());
  return true;
}

Future<bool> superboardSetPushToken(String token) async {
  await SuperBoard().setPushToken(token);
  return true;
}

Future<String> superboardGenerateLinkJson(String paramsJson) async {
  final decoded = jsonDecode(paramsJson);
  if (decoded is! Map) {
    throw const FormatException('Link parameters must be a JSON object');
  }
  final params = decoded.cast<String, dynamic>();
  final title = params['title']?.toString();
  if (title == null || title.isEmpty) {
    throw const FormatException('Link title is required');
  }

  CustomLinkRedirect? redirect(dynamic value) {
    if (value is! Map) return null;
    final map = value.cast<String, dynamic>();
    final url = map['url']?.toString();
    if (url == null || url.isEmpty) return null;
    return CustomLinkRedirect(
      url: url,
      openAppIfInstalled: map['openAppIfInstalled'] as bool? ?? true,
    );
  }

  final redirects = params['customRedirects'] is Map
      ? (params['customRedirects'] as Map).cast<String, dynamic>()
      : null;
  final tracking = params['tracking'] is Map
      ? (params['tracking'] as Map).cast<String, dynamic>()
      : null;
  final data = params['data'] is Map
      ? (params['data'] as Map).cast<String, dynamic>()
      : null;

  return SuperBoard().generateLink(
    GenerateLinkParams(
      title: title,
      subtitle: params['subtitle']?.toString(),
      imageURL: params['imageURL']?.toString(),
      data: data,
      tags: (params['tags'] as List?)
          ?.map((value) => value.toString())
          .toList(),
      customRedirects: redirects == null
          ? null
          : CustomRedirects(
              ios: redirect(redirects['ios']),
              android: redirect(redirects['android']),
              desktop: redirect(redirects['desktop']),
            ),
      showPreviewIos: params['showPreviewIos'] as bool?,
      showPreviewAndroid: params['showPreviewAndroid'] as bool?,
      tracking: tracking == null
          ? null
          : TrackingParams(
              utmCampaign: (tracking['utm_campaign'] ?? tracking['campaign'])
                  ?.toString(),
              utmSource: (tracking['utm_source'] ?? tracking['source'])
                  ?.toString(),
              utmMedium: (tracking['utm_medium'] ?? tracking['medium'])
                  ?.toString(),
            ),
    ),
  );
}

Future<int> superboardGetUnreadMessageCount() {
  return SuperBoard().getUnreadMessageCount();
}

Future<bool> superboardDisplayMessages() async {
  await SuperBoard().displayMessages();
  return true;
}

Future<String> superboardGetLastDeepLinkJson() async {
  return SuperBoardFlutterFlowState.lastDeepLinkJson;
}

/// Returns the latest purchase result emitted by the native store listener.
///
/// This includes terminal results that resolve after an action first returned
/// `pending` and results recovered after an application restart.
Future<String> superboardGetLastPurchaseResultJson() async {
  return SuperBoardFlutterFlowState.lastPurchaseResultJson;
}

/// Returns the latest CustomerInfo received from the verified SDK stream.
Future<String> superboardGetLastVerifiedCustomerInfoJson() async {
  return SuperBoardFlutterFlowState.lastVerifiedCustomerInfoJson;
}

Future<String> superboardPurchase({
  required String packageIdentifier,
  String offeringIdentifier = '',
}) async {
  String? productIdentifier;
  try {
    final offerings = await SuperBoardPurchases.instance.getOfferings();
    final offering = offeringIdentifier.isEmpty
        ? offerings.current
        : offerings.all[offeringIdentifier];
    if (offering == null) {
      return jsonEncode(
        const SuperBoardPurchaseResult(
          SuperBoardPurchaseOutcome.failed,
          code: 'offering_not_found',
          error: 'Offering not found',
        ).toJson(),
      );
    }
    SuperBoardPackage? selected;
    for (final package in offering.packages) {
      if (package.identifier == packageIdentifier) {
        selected = package;
        break;
      }
    }
    if (selected == null) {
      return jsonEncode(
        SuperBoardPurchaseResult(
          SuperBoardPurchaseOutcome.failed,
          code: 'package_not_found',
          error: 'Package not found',
          productIdentifier: packageIdentifier,
        ).toJson(),
      );
    }
    productIdentifier = selected.product.identifier;
    return jsonEncode(
      (await SuperBoardPurchases.instance.purchasePackage(selected)).toJson(),
    );
  } on SuperBoardPurchasesException catch (error) {
    return jsonEncode(
      SuperBoardPurchaseResult(
        SuperBoardPurchaseOutcome.failed,
        code: error.code,
        error: error.message,
        retryable: error.retryable,
        productIdentifier: productIdentifier,
        requestId: error.requestId,
      ).toJson(),
    );
  } catch (_) {
    return jsonEncode(
      SuperBoardPurchaseResult(
        SuperBoardPurchaseOutcome.failed,
        code: 'purchase_failed',
        error: 'Purchase could not start',
        retryable: true,
        productIdentifier: productIdentifier,
      ).toJson(),
    );
  }
}

Future<bool> superboardRestore() async {
  await SuperBoardPurchases.instance.restorePurchases();
  return true;
}

Future<bool> superboardSync() async {
  await SuperBoardPurchases.instance.syncPurchases();
  return true;
}

Future<bool> superboardHasEntitlement(String entitlementIdentifier) {
  return SuperBoardPurchases.instance.isEntitled(entitlementIdentifier);
}

Future<String> superboardGetOfferings({String placement = 'default'}) async {
  final offerings = await SuperBoardPurchases.instance.getOfferings(
    placement: placement,
  );
  return jsonEncode({
    'current': offerings.current?.identifier,
    'all': offerings.all.map(
      (key, value) => MapEntry(
        key,
        SuperBoardFlutterFlowOffering.fromSuperBoard(value).toMap(),
      ),
    ),
  });
}

Future<String> superboardGetPurchaseConfigurationJson({
  String placement = 'default',
}) async {
  final configuration = await SuperBoardPurchases.instance
      .getPurchaseConfiguration(placement: placement);
  return jsonEncode({
    'placement': configuration.placement.identifier,
    'offering': configuration.offering?.identifier,
    'paywall': configuration.paywall?.toJson(),
    'experiment': configuration.experimentAssignment == null
        ? null
        : {
            'experiment_id': configuration.experimentAssignment!.experimentId,
            'variant_id': configuration.experimentAssignment!.variantId,
            'variant': configuration.experimentAssignment!.variantIdentifier,
            'is_control': configuration.experimentAssignment!.isControl,
          },
    'from_cache': configuration.fromCache,
    'fetched_at': configuration.fetchedAt.toIso8601String(),
  });
}

Future<String> superboardGetCustomerInfoJson() async {
  final info = await SuperBoardPurchases.instance.getCustomerInfo();
  return jsonEncode(info.toJson());
}

Future<String> superboardGetVirtualCurrenciesJson() async {
  final currencies = await SuperBoardPurchases.instance.getVirtualCurrencies();
  return jsonEncode({
    'fetched_at': currencies.fetchedAt.toIso8601String(),
    'all': currencies.all.map(
      (key, value) => MapEntry(key, {
        'code': value.code,
        'name': value.name,
        'description': value.description,
        'icon': value.icon,
        'balance': value.balance,
      }),
    ),
  });
}

Future<String> superboardGetCustomerCenterJson() async {
  return jsonEncode(await SuperBoardPurchases.instance.getCustomerCenter());
}

Future<bool> superboardOpenSubscriptionManagement() async {
  final info = await SuperBoardPurchases.instance.getCustomerInfo();
  final value = info.managementUrl;
  if (value == null || value.isEmpty) return false;
  final uri = Uri.tryParse(value);
  if (uri == null || !{'https', 'itms-apps'}.contains(uri.scheme)) return false;
  return launchUrl(uri, mode: LaunchMode.externalApplication);
}

Future<List<SuperBoardFlutterFlowEntitlement>>
superboardGetEntitlements() async {
  final info = await SuperBoardPurchases.instance.getCustomerInfo();
  return info.entitlements.values
      .map(SuperBoardFlutterFlowEntitlement.fromSuperBoard)
      .toList();
}
