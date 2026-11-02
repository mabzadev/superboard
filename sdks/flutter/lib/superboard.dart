import 'superboard_platform_interface.dart';
import 'models/superboard_link.dart';
export 'models/superboard_link.dart';
export 'superboard_purchases.dart';
export 'models/superboard_purchases.dart';
export 'superboard_flows.dart';
export 'superboard_support.dart';

class SuperBoard {
  Future<String?> getPlatformVersion() {
    return SuperBoardPlatform.instance.getPlatformVersion();
  }

  Future<String> getPlatformIdentifier() {
    return SuperBoardPlatform.instance.getPlatformIdentifier();
  }

  Future<String> generateLink(GenerateLinkParams params) {
    return SuperBoardPlatform.instance.generateLink(params);
  }

  Future<void> setUserIdentifier(String identifier) {
    return SuperBoardPlatform.instance.setUserIdentifier(identifier);
  }

  Future<void> setUserAttributes(Map<String, dynamic> attributes) {
    return SuperBoardPlatform.instance.setUserAttributes(attributes);
  }

  Future<void> setDebugLevel(String level) {
    return SuperBoardPlatform.instance.setDebugLevel(level);
  }

  Future<void> setPushToken(String token) {
    return SuperBoardPlatform.instance.setPushToken(token);
  }

  Future<int> getUnreadMessageCount() {
    return SuperBoardPlatform.instance.getUnreadMessageCount();
  }

  Future<void> displayMessages() {
    return SuperBoardPlatform.instance.displayMessages();
  }

  Future<void> logInAppPurchase(String transactionId) {
    return SuperBoardPlatform.instance.logInAppPurchase(transactionId);
  }

  Future<void> logCustomPurchase({
    required TransactionType type,
    required int priceInCents,
    required String currency,
    required String productId,
    DateTime? startDate,
  }) {
    return SuperBoardPlatform.instance.logCustomPurchase(
      type: type,
      priceInCents: priceInCents,
      currency: currency,
      productId: productId,
      startDate: startDate,
    );
  }

  Stream<DeeplinkDetails> get onDeeplinkReceived {
    return SuperBoardPlatform.instance.onDeeplinkReceived;
  }
}
