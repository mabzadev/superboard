import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:superboard_flutterflow/superboard_flutterflow.dart';

void main() {
  test('uses Access Key headers, canonical route and UTC payload', () async {
    late http.Request captured;
    final client = SuperBoardCustomerEventsClient(
      projectKey: 'test_access_key',
      platform: 'ios',
      identifier: 'com.example.app',
      baseUrl: 'https://api.example.com/api/v1',
      environment: 'test',
      httpClient: MockClient((request) async {
        captured = request;
        return http.Response('{"data":{"accepted":1}}', 200);
      }),
    );

    final accepted = await client.record(
      SuperBoardCustomerEvent(
        id: 'event-1',
        customerId: 'customer-1',
        referrerCustomerId: 'referrer-1',
        type: 'purchase',
        occurredAt: DateTime.parse('2026-08-07T14:30:00+02:00'),
        revenueCents: 1299,
        metadata: const {'product_id': 'premium'},
      ),
    );

    expect(accepted, isTrue);
    expect(captured.url.path, '/api/v1/app/events');
    expect(captured.headers['PROJECT-KEY'], 'test_access_key');
    expect(captured.headers['PLATFORM'], 'ios');
    expect(captured.headers['IDENTIFIER'], 'com.example.app');
    expect(captured.headers['ENVIRONMENT'], 'test');
    expect(captured.headers['Idempotency-Key'], 'event-1');
    final body = jsonDecode(captured.body) as Map<String, dynamic>;
    final event = (body['events'] as List).single as Map<String, dynamic>;
    expect(event, {
      'id': 'event-1',
      'customer_id': 'customer-1',
      'referrer_customer_id': 'referrer-1',
      'type': 'purchase',
      'platform': 'ios',
      'occurred_at': '2026-08-07T12:30:00.000Z',
      'revenue_cents': 1299,
      'metadata': {'product_id': 'premium'},
    });
  });

  test('suppresses a successful idempotency key locally', () async {
    var calls = 0;
    final client = SuperBoardCustomerEventsClient(
      projectKey: 'key',
      platform: 'web',
      identifier: 'example.com',
      baseUrl: 'https://api.example.com/api/v1',
      httpClient: MockClient((_) async {
        calls++;
        return http.Response('{"data":{"accepted":2}}', 200);
      }),
    );
    final events = [
      SuperBoardCustomerEvent(id: 'one', type: 'view'),
      SuperBoardCustomerEvent(id: 'two', type: 'open'),
    ];

    expect(await client.recordBatch(events, idempotencyKey: 'outbox-1'), 2);
    expect(await client.recordBatch(events, idempotencyKey: 'outbox-1'), 0);
    expect(calls, 1);
  });

  test('deduplicates concurrent requests with the same key', () async {
    var calls = 0;
    final client = SuperBoardCustomerEventsClient(
      projectKey: 'key',
      platform: 'web',
      identifier: 'example.com',
      baseUrl: 'https://api.example.com/api/v1',
      httpClient: MockClient((_) async {
        calls++;
        await Future<void>.delayed(const Duration(milliseconds: 1));
        return http.Response('{"data":{"accepted":1}}', 200);
      }),
    );
    final events = [SuperBoardCustomerEvent(id: 'one', type: 'view')];

    final results = await Future.wait([
      client.recordBatch(events, idempotencyKey: 'concurrent-1'),
      client.recordBatch(events, idempotencyKey: 'concurrent-1'),
    ]);

    expect(results, [1, 1]);
    expect(calls, 1);
  });

  test('retries once with the same idempotency key and payload', () async {
    final requests = <http.Request>[];
    final client = SuperBoardCustomerEventsClient(
      projectKey: 'key',
      platform: 'android',
      identifier: 'com.example.app',
      baseUrl: 'https://api.example.com/api/v1',
      httpClient: MockClient((request) async {
        requests.add(request);
        return requests.length == 1
            ? http.Response(
                '{"error":{"code":"unavailable","retryable":true}}',
                503,
              )
            : http.Response('{"data":{"accepted":1}}', 200);
      }),
    );

    expect(
      await client.recordBatch([
        SuperBoardCustomerEvent(id: 'retry-event', type: 'app_open'),
      ], idempotencyKey: 'retry-batch'),
      1,
    );
    expect(requests, hasLength(2));
    expect(
      requests.map((request) => request.headers['Idempotency-Key']).toList(),
      ['retry-batch', 'retry-batch'],
    );
    expect(requests[0].body, requests[1].body);
  });

  test('JSON action validates date and sends at most 100 events', () async {
    final client = SuperBoardCustomerEventsClient(
      projectKey: 'key',
      platform: 'ios',
      identifier: 'com.example.app',
      baseUrl: 'https://api.example.com/api/v1',
      httpClient: MockClient(
        (_) async => http.Response('{"data":{"accepted":1}}', 200),
      ),
    );
    SuperBoardCustomerEventsSdk.configure(client);
    addTearDown(SuperBoardCustomerEventsSdk.resetForTesting);

    await expectLater(
      superboardRecordCustomerEventsJson(
        eventsJson: jsonEncode([
          {
            'id': 'invalid-date',
            'type': 'view',
            'occurred_at': '2026-08-07T12:30:00',
          },
        ]),
      ),
      throwsFormatException,
    );
    await expectLater(
      superboardRecordCustomerEventsJson(
        eventsJson: jsonEncode([
          {'type': 'view', 'occurred_at': '2026-08-07T12:30:00Z'},
        ]),
      ),
      throwsFormatException,
    );
    expect(
      () => client.recordBatch(
        List.generate(
          101,
          (index) => SuperBoardCustomerEvent(id: 'event-$index', type: 'view'),
        ),
      ),
      throwsFormatException,
    );
    expect(
      () => SuperBoardCustomerEvent(id: 'unsupported', type: 'cancellation'),
      throwsFormatException,
    );
    expect(
      () => SuperBoardCustomerEventsClient(
        projectKey: 'key',
        platform: 'desktop',
        identifier: 'desktop-app',
        baseUrl: 'https://api.example.com/api/v1',
      ),
      throwsFormatException,
    );
  });

  test(
    'FlutterFlow action validates metadata and uses configured client',
    () async {
      late Map<String, dynamic> payload;
      SuperBoardCustomerEventsSdk.configure(
        SuperBoardCustomerEventsClient(
          projectKey: 'key',
          platform: 'web',
          identifier: 'example.com',
          baseUrl: 'https://api.example.com/api/v1',
          httpClient: MockClient((request) async {
            payload = jsonDecode(request.body) as Map<String, dynamic>;
            return http.Response('{"data":{"accepted":1}}', 200);
          }),
        ),
      );
      addTearDown(SuperBoardCustomerEventsSdk.resetForTesting);

      expect(
        await superboardRecordCustomerEvent(
          eventId: 'action-event',
          type: 'time_spent',
          engagementTime: 42,
          metadataJson: '{"screen":"home"}',
        ),
        isTrue,
      );
      expect((payload['events'] as List).single['engagement_time'], 42);
      expect(
        () => superboardRecordCustomerEvent(type: 'view', metadataJson: '[]'),
        throwsFormatException,
      );
    },
  );
}
