import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:superboard_flutter/src/customer_info_verifier.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _publicKey = {
  'kty': 'EC',
  'x': 'aZQ9Zf1PPhpXqICFH3ly09h1cx-EN064HFicy0HQyiE',
  'y': 'Q5L9djjlP6_oG9j7GpYNKkxVJpQr8cjSdaFVI4cF5Q4',
  'crv': 'P-256',
  'kid': 'test-customer-info',
  'alg': 'ES256',
  'use': 'sig',
  'key_ops': ['verify'],
};

const _signature =
    'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6InRlc3QtY3VzdG9tZXItaW5mbyJ9.eyJjdXN0b21lcl9pbmZvIjp7Im9yaWdpbmFsX2FwcF91c2VyX2lkIjoidXNlci00MiIsImN1c3RvbWVyX2lkIjoiY3VzdG9tZXItNDIiLCJyZXF1ZXN0X2RhdGUiOiIyMDI2LTA4LTAzVDAwOjAwOjAwLjAwMFoiLCJlbnRpdGxlbWVudHMiOnsicHJlbWl1bSI6eyJpZGVudGlmaWVyIjoicHJlbWl1bSIsImlzX2FjdGl2ZSI6dHJ1ZSwic3RhdHVzIjoiYWN0aXZlIn19fSwicHJvamVjdF9pZCI6IjQyIiwiaXNzIjoic3VwZXJib2FyZC1wdXJjaGFzZXMiLCJhdWQiOiJzdXBlcmJvYXJkLXNkayIsInN1YiI6InVzZXItNDIiLCJpYXQiOjE3NjAwMDAwMDAsImV4cCI6NDEwMjQ0NDgwMH0.6wy4Fre6QMciMdiCXioMN8jQ_lUkcoi4IR4-4al7nI4Z44Gre7s1KqnNTHLDpHMWASeHOBLtejihAnvRvOWibg';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('uses only the signed CustomerInfo payload', () async {
    final verifier = SuperBoardCustomerInfoVerifier(
      client: MockClient(
        (_) async => http.Response(
          jsonEncode({
            'keys': [_publicKey],
          }),
          200,
        ),
      ),
    );
    final result = await verifier.verify(
      envelope: {
        'signature': _signature,
        'original_app_user_id': 'forged-user',
        'entitlements': const {},
      },
      purchasesBaseUrl: 'https://sdk.example.com/purchases/v2',
      preferences: await SharedPreferences.getInstance(),
    );

    expect(result['original_app_user_id'], 'user-42');
    expect(result['customer_id'], 'customer-42');
    expect((result['entitlements'] as Map)['premium']['is_active'], isTrue);
  });

  test('rejects a modified signature', () async {
    final verifier = SuperBoardCustomerInfoVerifier(
      client: MockClient(
        (_) async => http.Response(
          jsonEncode({
            'keys': [_publicKey],
          }),
          200,
        ),
      ),
    );
    await expectLater(
      verifier.verify(
        envelope: {
          'signature': '${_signature.substring(0, _signature.length - 1)}A',
        },
        purchasesBaseUrl: 'https://sdk.example.com/purchases/v2',
        preferences: await SharedPreferences.getInstance(),
      ),
      throwsA(isA<SuperBoardCustomerInfoVerificationException>()),
    );
  });
}
