import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:superboard_flutter/superboard_flutter.dart';
import 'package:superboard_flutterflow/superboard_flutterflow.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';

void main() {
  testWidgets('forwards terminal purchase and verified CustomerInfo updates', (
    tester,
  ) async {
    SuperBoardPlatform.instance = BootstrapPlatform();
    final purchases = StreamController<SuperBoardPurchaseResult>.broadcast();
    final customerInfo = StreamController<SuperBoardCustomerInfo>.broadcast();
    addTearDown(() async {
      await purchases.close();
      await customerInfo.close();
    });
    String? purchaseJson;
    String? customerInfoJson;

    await tester.pumpWidget(
      MaterialApp(
        home: SuperBoardBootstrap(
          projectKey: 'project-key',
          sdkBaseUrl: 'https://sdk.example.com',
          experienceApiBaseUrl: 'https://api.example.com/api/v1',
          purchaseResultStream: purchases.stream,
          customerInfoStream: customerInfo.stream,
          onPurchaseResultJson: (value) async {
            purchaseJson = value;
          },
          onVerifiedCustomerInfoJson: (value) async {
            customerInfoJson = value;
          },
        ),
      ),
    );

    purchases.add(
      const SuperBoardPurchaseResult(
        SuperBoardPurchaseOutcome.purchased,
        code: 'purchase_verified',
        productIdentifier: 'premium-weekly',
        transactionIdentifier: 'transaction-1',
      ),
    );
    customerInfo.add(
      SuperBoardCustomerInfo(
        originalAppUserId: 'user-1',
        requestDate: DateTime.utc(2026, 8, 3),
        entitlements: const {
          'premium': SuperBoardEntitlementInfo(
            identifier: 'premium',
            isActive: true,
            status: 'active',
          ),
        },
      ),
    );
    await tester.pump();

    expect(jsonDecode(purchaseJson!)['state'], 'purchased');
    expect(
      jsonDecode(customerInfoJson!)['entitlements']['premium']['is_active'],
      isTrue,
    );
    expect(await superboardGetLastPurchaseResultJson(), purchaseJson);
    expect(await superboardGetLastVerifiedCustomerInfoJson(), customerInfoJson);
  });
}

class BootstrapPlatform
    with MockPlatformInterfaceMixin
    implements SuperBoardPlatform {
  @override
  Stream<DeeplinkDetails> get onDeeplinkReceived => const Stream.empty();

  @override
  Future<String?> getPlatformVersion() async => 'test';

  @override
  Future<String> getPlatformIdentifier() async => 'com.example.app';

  @override
  Future<String> generateLink(GenerateLinkParams params) async =>
      'https://example.com/link';

  @override
  Future<void> setPushToken(String token) async {}

  @override
  Future<void> setUserIdentifier(String identifier) async {}

  @override
  Future<void> setUserAttributes(Map<String, dynamic> attributes) async {}

  @override
  Future<void> setDebugLevel(String level) async {}

  @override
  Future<int> getUnreadMessageCount() async => 0;

  @override
  Future<void> displayMessages() async {}

  @override
  Future<void> logInAppPurchase(String transactionId) async {}

  @override
  Future<void> logCustomPurchase({
    required TransactionType type,
    required int priceInCents,
    required String currency,
    required String productId,
    DateTime? startDate,
  }) async {}
}
