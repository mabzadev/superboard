import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:superboard_flutterflow/superboard_flutterflow.dart';

void main() {
  test('FlutterFlow round-trips the shared fixture with the real SDK model', () {
    final fixture =
        jsonDecode(
              File(
                '../../packages/contracts/fixtures/emdash-store-parity/v1.json',
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    final event = SuperBoardCustomerEvent.fromJson(
      (fixture['customer_event'] as Map).cast<String, dynamic>(),
    );
    expect(event.toJson(), fixture['customer_event']);
    expect(
      (fixture['aliases'] as Map<String, dynamic>)['projectId'],
      fixture['instance_id'],
    );
  });
}
