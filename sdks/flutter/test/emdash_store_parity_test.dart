import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:superboard_flutter/superboard_flows.dart';

void main() {
  test('Flutter round-trips the shared fixture with the real SDK model', () {
    final fixture =
        jsonDecode(
              File(
                '../../packages/contracts/fixtures/emdash-store-parity/v1.json',
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    final state = SuperBoardFlowPersistedState.fromJson(
      (fixture['flow_state'] as Map).cast<String, dynamic>(),
    );
    expect(state.toJson(), fixture['flow_state']);
    expect(state.projectId, fixture['instance_id']);
    expect(
      (fixture['aliases'] as Map<String, dynamic>)['pid'],
      state.projectId,
    );
  });
}
