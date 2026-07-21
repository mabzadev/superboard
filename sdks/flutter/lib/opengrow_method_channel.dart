import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import 'opengrow_platform_interface.dart';
import 'models/opengrow_link.dart';

/// An implementation of [OpenGrowPlatform] that uses method channels.
class MethodChannelOpenGrow extends OpenGrowPlatform {
  /// The method channel used to interact with the native platform.
  @visibleForTesting
  final methodChannel = const MethodChannel('opengrow');

  /// The event channel for receiving deeplink events
  @visibleForTesting
  final eventChannel = const EventChannel('opengrow/deeplinks');

  Stream<DeeplinkDetails>? _onDeeplinkReceived;

  @override
  Future<String?> getPlatformVersion() async {
    final version = await methodChannel.invokeMethod<String>(
      'getPlatformVersion',
    );
    return version;
  }

  @override
  Future<String> generateLink(GenerateLinkParams params) async {
    try {
      final result = await methodChannel.invokeMethod<String>(
        'generateLink',
        params.toMap(),
      );
      if (result == null) {
        throw OpenGrowException('Failed to generate link: null result');
      }
      return result;
    } on PlatformException catch (e) {
      throw OpenGrowException(
        e.message ?? 'Failed to generate link',
        code: e.code,
      );
    }
  }

  @override
  Future<void> setPushToken(String token) async {
    try {
      await methodChannel.invokeMethod('setPushToken', {'token': token});
    } on PlatformException catch (e) {
      throw OpenGrowException(
        e.message ?? 'Failed to set push token',
        code: e.code,
      );
    }
  }

  @override
  Future<void> setUserIdentifier(String identifier) async {
    try {
      await methodChannel.invokeMethod('setUserIdentifier', {
        'identifier': identifier,
      });
    } on PlatformException catch (e) {
      throw OpenGrowException(
        e.message ?? 'Failed to set user identifier',
        code: e.code,
      );
    }
  }

  @override
  Future<void> setUserAttributes(Map<String, dynamic> attributes) async {
    try {
      await methodChannel.invokeMethod('setUserAttributes', {
        'attributes': attributes,
      });
    } on PlatformException catch (e) {
      throw OpenGrowException(
        e.message ?? 'Failed to set user attributes',
        code: e.code,
      );
    }
  }

  @override
  Future<void> setDebugLevel(String level) async {
    try {
      await methodChannel.invokeMethod('setDebugLevel', {'level': level});
    } on PlatformException catch (e) {
      throw OpenGrowException(
        e.message ?? 'Failed to set debug level',
        code: e.code,
      );
    }
  }

  @override
  Future<void> logInAppPurchase(String transactionId) async {
    try {
      await methodChannel.invokeMethod('logInAppPurchase', {
        'transactionId': transactionId,
      });
    } on PlatformException catch (e) {
      throw OpenGrowException(
        e.message ?? 'Failed to log in-app purchase',
        code: e.code,
      );
    }
  }

  @override
  Future<void> logCustomPurchase({
    required TransactionType type,
    required int priceInCents,
    required String currency,
    required String productId,
    DateTime? startDate,
  }) async {
    try {
      await methodChannel.invokeMethod('logCustomPurchase', {
        'type': type.name,
        'priceInCents': priceInCents,
        'currency': currency,
        'productId': productId,
        'startDate': startDate?.toIso8601String(),
      });
    } on PlatformException catch (e) {
      throw OpenGrowException(
        e.message ?? 'Failed to log custom purchase',
        code: e.code,
      );
    }
  }

  @override
  Stream<DeeplinkDetails> get onDeeplinkReceived {
    _onDeeplinkReceived ??= eventChannel.receiveBroadcastStream().map((
      dynamic event,
    ) {
      return DeeplinkDetails.fromMap(event as Map<dynamic, dynamic>);
    });
    return _onDeeplinkReceived!;
  }
}
