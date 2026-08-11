import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import 'superboard_platform_interface.dart';
import 'models/superboard_link.dart';

/// An implementation of [SuperBoardPlatform] that uses method channels.
class MethodChannelSuperBoard extends SuperBoardPlatform {
  MethodChannelSuperBoard({
    MethodChannel? methodChannel,
    EventChannel? eventChannel,
    MethodChannel? legacyMethodChannel,
    EventChannel? legacyEventChannel,
  }) : methodChannel = methodChannel ?? const MethodChannel('superboard'),
       eventChannel =
           eventChannel ?? const EventChannel('superboard/deeplinks'),
       legacyMethodChannel =
           legacyMethodChannel ?? const MethodChannel('opengrow'),
       legacyEventChannel =
           legacyEventChannel ?? const EventChannel('opengrow/deeplinks');

  /// The method channel used to interact with the native platform.
  @visibleForTesting
  final MethodChannel methodChannel;

  /// The event channel for receiving deeplink events
  @visibleForTesting
  final EventChannel eventChannel;

  /// The OpenGrow 2.x method channel used only when a stale native wrapper is
  /// still present after a package upgrade. New native wrappers register only
  /// the canonical channel and one plugin instance.
  @visibleForTesting
  final MethodChannel legacyMethodChannel;

  /// The OpenGrow 2.x event-channel fallback for stale native build caches.
  @visibleForTesting
  final EventChannel legacyEventChannel;

  Stream<DeeplinkDetails>? _onDeeplinkReceived;

  @override
  Future<String?> getPlatformVersion() async {
    final version = await _invokeMethod<String>('getPlatformVersion');
    return version;
  }

  @override
  Future<String> getPlatformIdentifier() async {
    final identifier = await _invokeMethod<String>('getPlatformIdentifier');
    if (identifier == null || identifier.trim().isEmpty) {
      throw SuperBoardException('The native application identifier is missing');
    }
    return identifier;
  }

  @override
  Future<String> generateLink(GenerateLinkParams params) async {
    try {
      final result = await _invokeMethod<String>(
        'generateLink',
        params.toMap(),
      );
      if (result == null) {
        throw SuperBoardException('Failed to generate link: null result');
      }
      return result;
    } on PlatformException catch (e) {
      throw SuperBoardException(
        e.message ?? 'Failed to generate link',
        code: e.code,
      );
    }
  }

  @override
  Future<void> setPushToken(String token) async {
    try {
      await _invokeMethod<void>('setPushToken', {'token': token});
    } on PlatformException catch (e) {
      throw SuperBoardException(
        e.message ?? 'Failed to set push token',
        code: e.code,
      );
    }
  }

  @override
  Future<void> setUserIdentifier(String identifier) async {
    try {
      await _invokeMethod<void>('setUserIdentifier', {
        'identifier': identifier,
      });
    } on PlatformException catch (e) {
      throw SuperBoardException(
        e.message ?? 'Failed to set user identifier',
        code: e.code,
      );
    }
  }

  @override
  Future<void> setUserAttributes(Map<String, dynamic> attributes) async {
    try {
      await _invokeMethod<void>('setUserAttributes', {
        'attributes': attributes,
      });
    } on PlatformException catch (e) {
      throw SuperBoardException(
        e.message ?? 'Failed to set user attributes',
        code: e.code,
      );
    }
  }

  @override
  Future<void> setDebugLevel(String level) async {
    try {
      await _invokeMethod<void>('setDebugLevel', {'level': level});
    } on PlatformException catch (e) {
      throw SuperBoardException(
        e.message ?? 'Failed to set debug level',
        code: e.code,
      );
    }
  }

  @override
  Future<int> getUnreadMessageCount() async {
    try {
      return await _invokeMethod<int>('numberOfUnreadMessages') ?? 0;
    } on PlatformException catch (e) {
      throw SuperBoardException(
        e.message ?? 'Failed to get unread message count',
        code: e.code,
      );
    }
  }

  @override
  Future<void> displayMessages() async {
    try {
      await _invokeMethod<void>('displayMessages');
    } on PlatformException catch (e) {
      throw SuperBoardException(
        e.message ?? 'Failed to display messages',
        code: e.code,
      );
    }
  }

  @override
  Future<void> logInAppPurchase(String transactionId) async {
    try {
      await _invokeMethod<void>('logInAppPurchase', {
        'transactionId': transactionId,
      });
    } on PlatformException catch (e) {
      throw SuperBoardException(
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
      await _invokeMethod<void>('logCustomPurchase', {
        'type': type.name,
        'priceInCents': priceInCents,
        'currency': currency,
        'productId': productId,
        'startDate': startDate?.toIso8601String(),
      });
    } on PlatformException catch (e) {
      throw SuperBoardException(
        e.message ?? 'Failed to log custom purchase',
        code: e.code,
      );
    }
  }

  @override
  Stream<DeeplinkDetails> get onDeeplinkReceived {
    _onDeeplinkReceived ??= _receiveEvents().map(
      (event) => DeeplinkDetails.fromMap(event as Map<dynamic, dynamic>),
    );
    return _onDeeplinkReceived!;
  }

  Future<T?> _invokeMethod<T>(String method, [Object? arguments]) async {
    try {
      return await methodChannel.invokeMethod<T>(method, arguments);
    } on MissingPluginException {
      return legacyMethodChannel.invokeMethod<T>(method, arguments);
    }
  }

  Stream<dynamic> _receiveEvents() async* {
    try {
      await for (final event in eventChannel.receiveBroadcastStream()) {
        yield event;
      }
    } on MissingPluginException {
      await for (final event in legacyEventChannel.receiveBroadcastStream()) {
        yield event;
      }
    }
  }
}

/// Compatibility alias for the OpenGrow 2.x method-channel implementation.
@Deprecated(
  'Use MethodChannelSuperBoard. This compatibility alias will be removed in 4.0.0.',
)
typedef MethodChannelOpenGrow = MethodChannelSuperBoard;
