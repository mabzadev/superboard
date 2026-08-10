import 'package:flutter_test/flutter_test.dart';
import 'package:superboard_reference/src/model/sdk_catalog_status.dart';

void main() {
  test('catalogue status exposes pending active candidates', () {
    final catalogue = ReferenceSdkCatalogue.parse('''
{
  "schemaVersion": 2,
  "catalogueSchemaVersion": 4,
  "libraries": [
    {
      "id": "flutter",
      "lifecycle": "active",
      "packageName": "opengrow_flutter",
      "baselineVersion": "2.1.4",
      "sourceVersion": "3.0.0",
      "catalogueStatus": "pending-release",
      "candidatePackageName": "superboard_flutter"
    },
    {
      "id": "flutterflow",
      "lifecycle": "active",
      "packageName": "opengrow_flutterflow",
      "baselineVersion": "2.2.5",
      "sourceVersion": "3.0.0",
      "catalogueStatus": "pending-release",
      "candidatePackageName": "superboard_flutterflow"
    }
  ]
}
''');

    expect(catalogue.summary, '2 active · v3 pending');
    expect(catalogue.promotionReady, isFalse);
    expect(catalogue.active.map((library) => library.id), [
      'flutter',
      'flutterflow',
    ]);
  });
}
