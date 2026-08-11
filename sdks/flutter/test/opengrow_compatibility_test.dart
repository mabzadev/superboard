// ignore_for_file: deprecated_member_use_from_same_package

import 'package:flutter_test/flutter_test.dart';
import 'package:superboard_flutter/opengrow.dart';
import 'package:superboard_flutter/opengrow_method_channel.dart'
    as legacy_method;
import 'package:superboard_flutter/opengrow_platform_interface.dart'
    as legacy_platform;

void main() {
  test('OpenGrow 2.x symbols resolve to the canonical SuperBoard types', () {
    final OpenGrow client = OpenGrow();
    final OpenGrowException exception = OpenGrowException('migration');
    final OpenGrowPurchaseOutcome outcome = OpenGrowPurchaseOutcome.purchased;
    final legacy_platform.OpenGrowPlatform platform =
        legacy_method.MethodChannelOpenGrow();

    expect(client, isA<SuperBoard>());
    expect(exception, isA<SuperBoardException>());
    expect(outcome, SuperBoardPurchaseOutcome.purchased);
    expect(platform, isA<MethodChannelSuperBoard>());
  });
}
