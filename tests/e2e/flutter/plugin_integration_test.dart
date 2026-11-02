import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'package:superboard_flutter/superboard_flutter.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('getPlatformVersion test', (WidgetTester tester) async {
    final SuperBoard plugin = SuperBoard();
    final String? version = await plugin.getPlatformVersion();
    expect(version?.isNotEmpty, true);
  });
}
