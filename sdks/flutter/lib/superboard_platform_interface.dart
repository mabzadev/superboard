import 'package:plugin_platform_interface/plugin_platform_interface.dart';

import 'superboard_method_channel.dart';
import 'models/superboard_link.dart';

abstract class SuperBoardPlatform extends PlatformInterface {
  SuperBoardPlatform() : super(token: _token);

  static final Object _token = Object();

  static SuperBoardPlatform _instance = MethodChannelSuperBoard();

  static SuperBoardPlatform get instance => _instance;

  static set instance(SuperBoardPlatform instance) {
    PlatformInterface.verifyToken(instance, _token);
    _instance = instance;
  }

  Future<String?> getPlatformVersion() {
    throw UnimplementedError('platformVersion() has not been implemented.');
  }

  Future<String> getPlatformIdentifier() {
    throw UnimplementedError(
      'getPlatformIdentifier() has not been implemented.',
    );
  }

  Future<String> generateLink(GenerateLinkParams params) {
    throw UnimplementedError('generateLink() has not been implemented.');
  }

  Future<void> setPushToken(String token) {
    throw UnimplementedError('setPushToken() has not been implemented.');
  }

  Future<void> setUserIdentifier(String identifier) {
    throw UnimplementedError('setUserIdentifier() has not been implemented.');
  }

  Future<void> setUserAttributes(Map<String, dynamic> attributes) {
    throw UnimplementedError('setUserAttributes() has not been implemented.');
  }

  Future<void> setDebugLevel(String level) {
    throw UnimplementedError('setDebugLevel() has not been implemented.');
  }

  Future<int> getUnreadMessageCount() {
    throw UnimplementedError(
      'getUnreadMessageCount() has not been implemented.',
    );
  }

  Future<void> displayMessages() {
    throw UnimplementedError('displayMessages() has not been implemented.');
  }

  Future<void> logInAppPurchase(String transactionId) {
    throw UnimplementedError('logInAppPurchase() has not been implemented.');
  }

  Future<void> logCustomPurchase({
    required TransactionType type,
    required int priceInCents,
    required String currency,
    required String productId,
    DateTime? startDate,
  }) {
    throw UnimplementedError('logCustomPurchase() has not been implemented.');
  }

  Stream<DeeplinkDetails> get onDeeplinkReceived {
    throw UnimplementedError('onDeeplinkReceived has not been implemented.');
  }
}
