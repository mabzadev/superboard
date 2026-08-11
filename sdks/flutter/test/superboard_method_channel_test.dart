import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:superboard_flutter/superboard_method_channel.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  final platform = MethodChannelSuperBoard();
  const channel = MethodChannel('superboard');
  const legacyChannel = MethodChannel('opengrow');

  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (MethodCall methodCall) async {
          switch (methodCall.method) {
            case 'getPlatformVersion':
              return '42';
            case 'getPlatformIdentifier':
              return 'com.example.app';
            case 'numberOfUnreadMessages':
              return 3;
            default:
              return null;
          }
        });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(legacyChannel, null);
  });

  test('getPlatformVersion', () async {
    expect(await platform.getPlatformVersion(), '42');
  });

  test('getPlatformIdentifier', () async {
    expect(await platform.getPlatformIdentifier(), 'com.example.app');
  });

  test('getUnreadMessageCount', () async {
    expect(await platform.getUnreadMessageCount(), 3);
  });

  test('displayMessages', () async {
    await expectLater(platform.displayMessages(), completes);
  });

  test(
    'falls back to the OpenGrow 2.x channel for a stale native build',
    () async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, null);
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(legacyChannel, (methodCall) async {
            expect(methodCall.method, 'getPlatformVersion');
            return 'legacy-42';
          });

      expect(await MethodChannelSuperBoard().getPlatformVersion(), 'legacy-42');
    },
  );
}
