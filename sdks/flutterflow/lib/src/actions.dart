import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:opengrow_flutter/opengrow.dart';
import 'package:url_launcher/url_launcher.dart';

import 'models.dart';

/// Ephemeral values emitted by native callbacks for no-code action flows.
///
/// Deep-link payloads are deliberately kept in memory and are never persisted.
abstract final class OpenGrowFlutterFlowState {
  static String lastDeepLinkJson = '';
  static String lastPurchaseResultJson = '';
  static String lastVerifiedCustomerInfoJson = '';
  static String lastError = '';
}

/// Emits only CustomerInfo payloads that have already passed SDK JWS
/// verification. Hosts can use this stream to update no-code application
/// state when a pending or recovered purchase resolves asynchronously.
Stream<String> get opengrowVerifiedCustomerInfoJsonStream => OpenGrowPurchases
    .instance
    .customerInfoStream
    .map((customerInfo) => jsonEncode(customerInfo.toJson()));

/// Emits structured terminal and pending purchase results for host bridges.
Stream<String> get opengrowPurchaseResultJsonStream => OpenGrowPurchases
    .instance
    .purchaseResultStream
    .map((result) => jsonEncode(result.toJson()));

Future<bool> opengrowInitialize({
  required String projectKey,
  required String platformIdentifier,
  String purchasesBaseUrl = 'https://sdk.vocostar.com/purchases/v2',
  String identityToken = '',
}) async {
  await OpenGrowPurchases.instance.configure(
    projectKey: projectKey,
    platformIdentifier: platformIdentifier,
    baseUrl: purchasesBaseUrl,
    identityToken: identityToken.isEmpty ? null : identityToken,
  );
  return true;
}

/// Initializes OpenGrow Purchases using the Bundle ID/package name reported by
/// the native app. The native OpenGrow SDK itself is configured automatically
/// from Info.plist/AndroidManifest.xml before this action runs.
Future<bool> opengrowInitializeAuto({
  required String projectKey,
  String sdkBaseUrl = 'https://sdk.vocostar.com',
  String identityToken = '',
}) async {
  final platformIdentifier = await OpenGrow().getPlatformIdentifier();
  final trimmedBaseUrl = sdkBaseUrl
      .replaceFirst(RegExp(r'/+$'), '')
      .replaceFirst(RegExp(r'/purchases/v\d+$'), '');
  final purchasesBaseUrl = trimmedBaseUrl.endsWith('/purchases/v2')
      ? trimmedBaseUrl
      : '$trimmedBaseUrl/purchases/v2';
  return opengrowInitialize(
    projectKey: projectKey,
    platformIdentifier: platformIdentifier,
    purchasesBaseUrl: purchasesBaseUrl,
    identityToken: identityToken,
  );
}

/// Initializes Purchases only after the application authentication gateway has
/// exchanged its existing access token for a short-lived ES256 identity token.
Future<bool> opengrowInitializeAuthenticated({
  required String projectKey,
  required String applicationAccessToken,
  String sdkBaseUrl = 'https://sdk.vocostar.com',
  String authGatewayBaseUrl = 'https://api.vocostar.com',
}) async {
  if (applicationAccessToken.trim().isEmpty) {
    throw const OpenGrowPurchasesException(
      'Application authentication is required before Purchases initialization',
      code: 'identity_required',
    );
  }
  Future<String?> tokenProvider() async {
    final client = http.Client();
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
      final body = response.body.isEmpty ? const {} : jsonDecode(response.body);
      final token = body is Map ? body['access_token']?.toString() : null;
      if (response.statusCode != 200 || token == null || token.isEmpty) {
        throw OpenGrowPurchasesException(
          'Identity synchronization failed',
          code: 'identity_sync_failed',
          retryable: response.statusCode >= 500,
        );
      }
      return token;
    } finally {
      client.close();
    }
  }

  final initialToken = await tokenProvider();
  final platformIdentifier = await OpenGrow().getPlatformIdentifier();
  final base = sdkBaseUrl.replaceFirst(RegExp(r'/+$'), '');
  await OpenGrowPurchases.instance.configure(
    projectKey: projectKey,
    platformIdentifier: platformIdentifier,
    baseUrl: '$base/purchases/v2',
    identityToken: initialToken,
    identityTokenProvider: tokenProvider,
  );
  return true;
}

/// Associates both OpenGrow attribution and verified purchases with a user.
///
/// Pass the server-issued OpenGrow identity JWT when purchase identity should
/// be merged. The JWT is never persisted by this wrapper.
Future<bool> opengrowIdentify({
  required String userIdentifier,
  String identityToken = '',
}) async {
  await OpenGrow().setUserIdentifier(userIdentifier);
  if (identityToken.isNotEmpty) {
    await OpenGrowPurchases.instance.logIn(identityToken);
  }
  return true;
}

Future<bool> opengrowPurchaseLogin(String identityToken) async {
  await OpenGrowPurchases.instance.logIn(identityToken);
  return true;
}

Future<bool> opengrowPurchaseLogout() async {
  await OpenGrowPurchases.instance.logOut();
  return true;
}

Future<bool> opengrowSetUserAttributesJson(String attributesJson) async {
  final decoded = jsonDecode(attributesJson);
  if (decoded is! Map) {
    throw const FormatException('User attributes must be a JSON object');
  }
  await OpenGrow().setUserAttributes(decoded.cast<String, dynamic>());
  return true;
}

Future<bool> opengrowSetPushToken(String token) async {
  await OpenGrow().setPushToken(token);
  return true;
}

Future<String> opengrowGenerateLinkJson(String paramsJson) async {
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

  return OpenGrow().generateLink(
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

Future<int> opengrowGetUnreadMessageCount() {
  return OpenGrow().getUnreadMessageCount();
}

Future<bool> opengrowDisplayMessages() async {
  await OpenGrow().displayMessages();
  return true;
}

Future<String> opengrowGetLastDeepLinkJson() async {
  return OpenGrowFlutterFlowState.lastDeepLinkJson;
}

/// Returns the latest purchase result emitted by the native store listener.
///
/// This includes terminal results that resolve after an action first returned
/// `pending` and results recovered after an application restart.
Future<String> opengrowGetLastPurchaseResultJson() async {
  return OpenGrowFlutterFlowState.lastPurchaseResultJson;
}

/// Returns the latest CustomerInfo received from the verified SDK stream.
Future<String> opengrowGetLastVerifiedCustomerInfoJson() async {
  return OpenGrowFlutterFlowState.lastVerifiedCustomerInfoJson;
}

Future<String> opengrowPurchase({
  required String packageIdentifier,
  String offeringIdentifier = '',
}) async {
  final offerings = await OpenGrowPurchases.instance.getOfferings();
  final offering = offeringIdentifier.isEmpty
      ? offerings.current
      : offerings.all[offeringIdentifier];
  if (offering == null) {
    return jsonEncode(
      const OpenGrowPurchaseResult(
        OpenGrowPurchaseOutcome.failed,
        code: 'offering_not_found',
        error: 'Offering not found',
      ).toJson(),
    );
  }
  OpenGrowPackage? selected;
  for (final package in offering.packages) {
    if (package.identifier == packageIdentifier) {
      selected = package;
      break;
    }
  }
  if (selected == null) {
    return jsonEncode(
      OpenGrowPurchaseResult(
        OpenGrowPurchaseOutcome.failed,
        code: 'package_not_found',
        error: 'Package not found',
        productIdentifier: packageIdentifier,
      ).toJson(),
    );
  }
  return jsonEncode(
    (await OpenGrowPurchases.instance.purchasePackage(selected)).toJson(),
  );
}

Future<bool> opengrowRestore() async {
  await OpenGrowPurchases.instance.restorePurchases();
  return true;
}

Future<bool> opengrowSync() async {
  await OpenGrowPurchases.instance.syncPurchases();
  return true;
}

Future<bool> opengrowHasEntitlement(String entitlementIdentifier) {
  return OpenGrowPurchases.instance.isEntitled(entitlementIdentifier);
}

Future<String> opengrowGetOfferings({String placement = 'default'}) async {
  final offerings = await OpenGrowPurchases.instance.getOfferings(
    placement: placement,
  );
  return jsonEncode({
    'current': offerings.current?.identifier,
    'all': offerings.all.map(
      (key, value) => MapEntry(
        key,
        OpenGrowFlutterFlowOffering.fromOpenGrow(value).toMap(),
      ),
    ),
  });
}

Future<String> opengrowGetPurchaseConfigurationJson({
  String placement = 'default',
}) async {
  final configuration = await OpenGrowPurchases.instance
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

Future<String> opengrowGetCustomerInfoJson() async {
  final info = await OpenGrowPurchases.instance.getCustomerInfo();
  return jsonEncode(info.toJson());
}

Future<String> opengrowGetVirtualCurrenciesJson() async {
  final currencies = await OpenGrowPurchases.instance.getVirtualCurrencies();
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

Future<String> opengrowGetCustomerCenterJson() async {
  return jsonEncode(await OpenGrowPurchases.instance.getCustomerCenter());
}

Future<bool> opengrowOpenSubscriptionManagement() async {
  final info = await OpenGrowPurchases.instance.getCustomerInfo();
  final value = info.managementUrl;
  if (value == null || value.isEmpty) return false;
  final uri = Uri.tryParse(value);
  if (uri == null || !{'https', 'itms-apps'}.contains(uri.scheme)) return false;
  return launchUrl(uri, mode: LaunchMode.externalApplication);
}

Future<List<OpenGrowFlutterFlowEntitlement>> opengrowGetEntitlements() async {
  final info = await OpenGrowPurchases.instance.getCustomerInfo();
  return info.entitlements.values
      .map(OpenGrowFlutterFlowEntitlement.fromOpenGrow)
      .toList();
}
