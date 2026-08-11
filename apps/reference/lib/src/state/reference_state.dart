import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../config/reference_config.dart';

class ReferenceState extends ChangeNotifier {
  ReferenceState({required this.configuration});

  final ReferenceConfig configuration;

  String applicationAccessToken = '';
  String currentUserId = '';
  String lastDeepLinkJson = '';
  String lastPurchaseResultJson = '';
  String lastCustomerInfoJson = '';
  String lastSupportEventJson = '';
  String lastNotificationJson = '';
  String lastFileJson = '';
  String lastMarketingConsentJson = '';
  String lastOnboardingJson = '';
  String lastCustomJobJson = '';
  String lastIntegrationError = '';

  void setSession({required String accessToken, required String userId}) {
    applicationAccessToken = accessToken;
    currentUserId = userId;
    notifyListeners();
  }

  void clearSession() {
    applicationAccessToken = '';
    currentUserId = '';
    notifyListeners();
  }

  void record(String key, Object? value) {
    final encoded = value is String ? value : jsonEncode(value);
    switch (key) {
      case 'deepLink':
        lastDeepLinkJson = encoded;
      case 'purchase':
        lastPurchaseResultJson = encoded;
      case 'customer':
        lastCustomerInfoJson = encoded;
      case 'support':
        lastSupportEventJson = encoded;
      case 'notification':
        lastNotificationJson = encoded;
      case 'file':
        lastFileJson = encoded;
      case 'marketing':
        lastMarketingConsentJson = encoded;
      case 'onboarding':
        lastOnboardingJson = encoded;
      case 'customJob':
        lastCustomJobJson = encoded;
      default:
        lastIntegrationError = encoded;
    }
    notifyListeners();
  }
}
