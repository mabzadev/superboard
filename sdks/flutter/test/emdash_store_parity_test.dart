import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Flutter preserves the public contract across EmDash Store authority', () {
    final fixture =
        jsonDecode(
              File(
                '../../packages/contracts/fixtures/emdash-store-parity/v1.json',
              ).readAsStringSync(),
            )
            as Map<String, dynamic>;
    expect(fixture['after'], fixture['before']);
    expect(
      (fixture['aliases'] as Map<String, dynamic>)['projectId'],
      fixture['instance_id'],
    );
    expect(
      (fixture['aliases'] as Map<String, dynamic>)['pid'],
      fixture['instance_id'],
    );
  });
}
