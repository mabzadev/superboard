import 'package:flutter_test/flutter_test.dart';
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart';

void main() {
  test('FlutterFlow package serializes stable field names', () {
    const value = OpenGrowFlutterFlowPackage(
      identifier: 'monthly',
      productId: 'premium_monthly',
      productType: 'subscription',
      price: r'$9.99',
      title: 'Premium monthly',
    );

    expect(value.toMap(), {
      'identifier': 'monthly',
      'productId': 'premium_monthly',
      'productType': 'subscription',
      'price': r'$9.99',
      'title': 'Premium monthly',
    });
  });
}
