import 'package:flutter_test/flutter_test.dart';
import 'package:superboard_flutter/models/superboard_link.dart';
import 'package:superboard_flutter/superboard_platform_interface.dart';
import 'package:superboard_flutterflow/superboard_flutterflow.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';

class FakeSuperBoardPlatform
    with MockPlatformInterfaceMixin
    implements SuperBoardPlatform {
  GenerateLinkParams? generatedLinkParams;
  Map<String, dynamic>? attributes;
  String? pushToken;

  @override
  Future<String?> getPlatformVersion() async => 'test';

  @override
  Future<String> getPlatformIdentifier() async => 'com.example.app';

  @override
  Future<String> generateLink(GenerateLinkParams params) async {
    generatedLinkParams = params;
    return 'https://in.example.com/test';
  }

  @override
  Future<void> setPushToken(String token) async => pushToken = token;

  @override
  Future<void> setUserIdentifier(String identifier) async {}

  @override
  Future<void> setUserAttributes(Map<String, dynamic> value) async {
    attributes = value;
  }

  @override
  Future<void> setDebugLevel(String level) async {}

  @override
  Future<int> getUnreadMessageCount() async => 4;

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

  @override
  Stream<DeeplinkDetails> get onDeeplinkReceived => const Stream.empty();
}

void main() {
  late FakeSuperBoardPlatform platform;

  setUp(() {
    platform = FakeSuperBoardPlatform();
    SuperBoardPlatform.instance = platform;
  });

  test('sets JSON attributes', () async {
    expect(
      await superboardSetUserAttributesJson('{"plan":"premium","age":42}'),
      isTrue,
    );
    expect(platform.attributes, {'plan': 'premium', 'age': 42});
  });

  test('generates a typed link from JSON', () async {
    final link = await superboardGenerateLinkJson(
      '{"title":"Invite","data":{"screen":"home"},'
      '"tracking":{"utm_source":"flutterflow"}}',
    );
    expect(link, 'https://in.example.com/test');
    expect(platform.generatedLinkParams?.title, 'Invite');
    expect(platform.generatedLinkParams?.data, {'screen': 'home'});
    expect(platform.generatedLinkParams?.tracking?.utmSource, 'flutterflow');
  });

  test('forwards messaging calls', () async {
    expect(await superboardGetUnreadMessageCount(), 4);
    expect(await superboardDisplayMessages(), isTrue);
  });
}
