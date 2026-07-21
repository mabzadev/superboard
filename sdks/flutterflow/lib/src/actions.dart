import 'dart:convert';

import 'package:opengrow_flutter/opengrow.dart';

import 'models.dart';

Future<bool> opengrowInitialize({
  required String projectKey,
  required String platformIdentifier,
  String purchasesBaseUrl = 'https://sdk.vocostar.com/purchases/v1',
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

Future<String> opengrowPurchase({
  required String packageIdentifier,
  String offeringIdentifier = '',
}) async {
  final offerings = await OpenGrowPurchases.instance.getOfferings();
  final offering = offeringIdentifier.isEmpty
      ? offerings.current
      : offerings.all[offeringIdentifier];
  if (offering == null) return OpenGrowPurchaseOutcome.failed.name;
  OpenGrowPackage? selected;
  for (final package in offering.packages) {
    if (package.identifier == packageIdentifier) {
      selected = package;
      break;
    }
  }
  if (selected == null) return OpenGrowPurchaseOutcome.failed.name;
  return (await OpenGrowPurchases.instance.purchasePackage(selected)).outcome.name;
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
      (key, value) =>
          MapEntry(key, OpenGrowFlutterFlowOffering.fromOpenGrow(value).toMap()),
    ),
  });
}

Future<List<OpenGrowFlutterFlowEntitlement>> opengrowGetEntitlements() async {
  final info = await OpenGrowPurchases.instance.getCustomerInfo();
  return info.entitlements.values
      .map(OpenGrowFlutterFlowEntitlement.fromOpenGrow)
      .toList();
}
