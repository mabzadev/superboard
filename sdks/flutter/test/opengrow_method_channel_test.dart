import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:opengrow_flutter/opengrow_method_channel.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  MethodChannelOpenGrow platform = MethodChannelOpenGrow();
  const MethodChannel channel = MethodChannel('opengrow');

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
}
