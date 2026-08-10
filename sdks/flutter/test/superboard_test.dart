import 'package:flutter_test/flutter_test.dart';
import 'package:superboard_flutter/superboard_flutter.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';

class MockSuperBoardPlatform
    with MockPlatformInterfaceMixin
    implements SuperBoardPlatform {
  @override
  Future<String?> getPlatformVersion() => Future.value('42');

  @override
  Future<String> getPlatformIdentifier() => Future.value('com.example.app');

  @override
  Future<String> generateLink(GenerateLinkParams params) =>
      Future.value('https://github.com/mbzadev/superboard-platform/test-link');

  @override
  Future<void> setPushToken(String token) => Future.value();

  @override
  Future<void> setUserIdentifier(String identifier) => Future.value();

  @override
  Future<void> setUserAttributes(Map<String, dynamic> attributes) =>
      Future.value();

  @override
  Future<void> setDebugLevel(String level) => Future.value();

  @override
  Future<int> getUnreadMessageCount() => Future.value(3);

  @override
  Future<void> displayMessages() => Future.value();

  @override
  Future<void> logInAppPurchase(String transactionId) => Future.value();

  @override
  Future<void> logCustomPurchase({
    required TransactionType type,
    required int priceInCents,
    required String currency,
    required String productId,
    DateTime? startDate,
  }) => Future.value();

  @override
  Stream<DeeplinkDetails> get onDeeplinkReceived => Stream.empty();
}

void main() {
  final SuperBoardPlatform initialPlatform = SuperBoardPlatform.instance;

  test('$MethodChannelSuperBoard is the default instance', () {
    expect(initialPlatform, isInstanceOf<MethodChannelSuperBoard>());
  });

  test('getPlatformVersion', () async {
    SuperBoard opengrowPlugin = SuperBoard();
    MockSuperBoardPlatform fakePlatform = MockSuperBoardPlatform();
    SuperBoardPlatform.instance = fakePlatform;

    expect(await opengrowPlugin.getPlatformVersion(), '42');
  });

  test('generateLink', () async {
    SuperBoard opengrowPlugin = SuperBoard();
    MockSuperBoardPlatform fakePlatform = MockSuperBoardPlatform();
    SuperBoardPlatform.instance = fakePlatform;

    final link = await opengrowPlugin.generateLink(
      GenerateLinkParams(title: 'Test'),
    );

    expect(link, 'https://github.com/mbzadev/superboard-platform/test-link');
  });
}
