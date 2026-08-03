import 'package:plugin_platform_interface/plugin_platform_interface.dart';

import 'opengrow_method_channel.dart';
import 'models/opengrow_link.dart';

abstract class OpenGrowPlatform extends PlatformInterface {
  /// Constructs a OpenGrowPlatform.
  OpenGrowPlatform() : super(token: _token);

  static final Object _token = Object();

  static OpenGrowPlatform _instance = MethodChannelOpenGrow();

  /// The default instance of [OpenGrowPlatform] to use.
  ///
  /// Defaults to [MethodChannelOpenGrow].
  static OpenGrowPlatform get instance => _instance;

  /// Platform-specific implementations should set this with their own
  /// platform-specific class that extends [OpenGrowPlatform] when
  /// they register themselves.
  static set instance(OpenGrowPlatform instance) {
    PlatformInterface.verifyToken(instance, _token);
    _instance = instance;
  }

  Future<String?> getPlatformVersion() {
    throw UnimplementedError('platformVersion() has not been implemented.');
  }

  /// Returns the app Bundle ID on iOS or package name on Android.
  Future<String> getPlatformIdentifier() {
    throw UnimplementedError(
      'getPlatformIdentifier() has not been implemented.',
    );
  }

  /// Generate a OpenGrow link with the specified parameters
  Future<String> generateLink(GenerateLinkParams params) {
    throw UnimplementedError('generateLink() has not been implemented.');
  }

  /// Set the push token for receiving push notifications
  Future<void> setPushToken(String token) {
    throw UnimplementedError('setPushToken() has not been implemented.');
  }

  /// Set user identifier
  Future<void> setUserIdentifier(String identifier) {
    throw UnimplementedError('setUserIdentifier() has not been implemented.');
  }

  /// Set user attributes
  Future<void> setUserAttributes(Map<String, dynamic> attributes) {
    throw UnimplementedError('setUserAttributes() has not been implemented.');
  }

  /// Set debug level
  Future<void> setDebugLevel(String level) {
    throw UnimplementedError('setDebugLevel() has not been implemented.');
  }

  /// Returns the number of unread OpenGrow messages.
  Future<int> getUnreadMessageCount() {
    throw UnimplementedError(
      'getUnreadMessageCount() has not been implemented.',
    );
  }

  /// Presents the native OpenGrow message center.
  Future<void> displayMessages() {
    throw UnimplementedError('displayMessages() has not been implemented.');
  }

  /// Log an in-app purchase from the platform store
  Future<void> logInAppPurchase(String transactionId) {
    throw UnimplementedError('logInAppPurchase() has not been implemented.');
  }

  /// Log a custom purchase
  Future<void> logCustomPurchase({
    required TransactionType type,
    required int priceInCents,
    required String currency,
    required String productId,
    DateTime? startDate,
  }) {
    throw UnimplementedError('logCustomPurchase() has not been implemented.');
  }

  /// Stream of deeplink events
  Stream<DeeplinkDetails> get onDeeplinkReceived {
    throw UnimplementedError('onDeeplinkReceived has not been implemented.');
  }
}
