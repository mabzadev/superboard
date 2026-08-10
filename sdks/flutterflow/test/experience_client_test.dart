import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:superboard_flutterflow/superboard_flutterflow.dart';

Map<String, dynamic> resolvedJson({String kind = 'paywall'}) => {
  'data': {
    '${kind}_id': '${kind}_1',
    'placement_id': 'placement_1',
    'placement': 'default',
    'version_id': 'version_1',
    'version': 2,
    'experience_id': 'experiment_1',
    'variant_id': 'variant_a',
    'definition': {
      'theme': {'accent_color': '#112233'},
      if (kind == 'paywall')
        'components': <dynamic>[]
      else
        'screens': <dynamic>[],
    },
  },
};

void main() {
  test('resolves with PROJECT-KEY headers and serves the TTL cache', () async {
    var calls = 0;
    late http.Request request;
    final client = SuperBoardExperienceClient(
      projectKey: 'test_project_key',
      platform: 'ios',
      identifier: 'com.example.app',
      baseUrl: 'https://api.example.com/api/v1',
      httpClient: MockClient((value) async {
        calls++;
        request = value;
        return http.Response(jsonEncode(resolvedJson()), 200);
      }),
    );

    final first = await client.resolvePaywall(placement: 'default');
    final cached = await client.resolvePaywall(placement: 'default');

    expect(calls, 1);
    expect(request.url.path, '/api/v1/paywalls/resolve');
    expect(request.headers['PROJECT-KEY'], 'test_project_key');
    expect(request.headers['PLATFORM'], 'ios');
    expect(request.headers['IDENTIFIER'], 'com.example.app');
    expect(first?.version, 2);
    expect(first?.fromCache, isFalse);
    expect(cached?.fromCache, isTrue);
  });

  test(
    'returns a stale successful resolution during a transient failure',
    () async {
      var calls = 0;
      var now = DateTime.utc(2026, 1, 1);
      final client = SuperBoardExperienceClient(
        projectKey: 'key',
        platform: 'android',
        identifier: 'com.example.app',
        baseUrl: 'https://api.example.com/api/v1',
        cacheTtl: const Duration(minutes: 1),
        maxStale: const Duration(days: 1),
        now: () => now,
        httpClient: MockClient((_) async {
          calls++;
          if (calls == 1) return http.Response(jsonEncode(resolvedJson()), 200);
          return http.Response('{"error":{"message":"Unavailable"}}', 503);
        }),
      );
      await client.resolvePaywall(placement: 'default');
      now = now.add(const Duration(minutes: 2));
      final fallback = await client.resolvePaywall(placement: 'default');
      expect(fallback?.fromCache, isTrue);
      expect(fallback?.versionId, 'version_1');
    },
  );

  test(
    'partitions cache by targeting context with stable attribute ordering',
    () async {
      var calls = 0;
      final client = SuperBoardExperienceClient(
        projectKey: 'key',
        platform: 'ios',
        identifier: 'com.example.app',
        baseUrl: 'https://api.example.com/api/v1',
        httpClient: MockClient((_) async {
          calls++;
          return http.Response(jsonEncode(resolvedJson()), 200);
        }),
      );
      await client.resolvePaywall(
        placement: 'default',
        locale: 'en-US',
        attributes: {'plan': 'free', 'age': 30},
      );
      await client.resolvePaywall(
        placement: 'default',
        locale: 'en-US',
        attributes: {'age': 30, 'plan': 'free'},
      );
      await client.resolvePaywall(
        placement: 'default',
        locale: 'fr-FR',
        attributes: {'age': 30, 'plan': 'free'},
      );
      expect(calls, 2);
    },
  );

  test('treats no active version as a cacheable empty result', () async {
    var calls = 0;
    final client = SuperBoardExperienceClient(
      projectKey: 'key',
      platform: 'web',
      identifier: 'example.com',
      baseUrl: 'https://api.example.com/api/v1',
      httpClient: MockClient((_) async {
        calls++;
        return http.Response('{"data":null}', 200);
      }),
    );
    expect(await client.resolveOnboarding(placement: 'launch'), isNull);
    expect(await client.resolveOnboarding(placement: 'launch'), isNull);
    expect(calls, 1);
  });

  test('sends events once with a stable idempotency key', () async {
    final requests = <http.Request>[];
    final client = SuperBoardExperienceClient(
      projectKey: 'key',
      platform: 'ios',
      identifier: 'com.example.app',
      baseUrl: 'https://api.example.com/api/v1',
      httpClient: MockClient((request) async {
        requests.add(request);
        return http.Response('{"data":{"accepted":1}}', 202);
      }),
    );
    final resolved = SuperBoardResolvedExperience.fromJson(
      SuperBoardExperienceKind.paywall,
      (resolvedJson()['data'] as Map).cast<String, dynamic>(),
    );
    final event = SuperBoardExperienceEvent(
      id: 'event_stable_1',
      type: 'impression',
      resolved: resolved,
      platform: 'ios',
    );
    expect(await client.track(event), isTrue);
    expect(await client.track(event), isFalse);
    expect(requests, hasLength(1));
    expect(requests.single.headers['Idempotency-Key'], 'event_stable_1');
    final body = jsonDecode(requests.single.body) as Map<String, dynamic>;
    expect((body['events'] as List).single['version_id'], 'version_1');
  });

  test('retries transient telemetry with the same idempotency key', () async {
    final keys = <String?>[];
    final client = SuperBoardExperienceClient(
      projectKey: 'key',
      platform: 'android',
      identifier: 'com.example.app',
      baseUrl: 'https://api.example.com/api/v1',
      httpClient: MockClient((request) async {
        keys.add(request.headers['Idempotency-Key']);
        return keys.length == 1
            ? http.Response('{"error":{"retryable":true}}', 503)
            : http.Response('{"data":{"accepted":1}}', 202);
      }),
    );
    final resolved = SuperBoardResolvedExperience.fromJson(
      SuperBoardExperienceKind.paywall,
      (resolvedJson()['data'] as Map).cast<String, dynamic>(),
    );
    final event = SuperBoardExperienceEvent(
      id: 'event_retry_1',
      type: 'view',
      resolved: resolved,
      platform: 'android',
    );
    expect(await client.track(event), isTrue);
    expect(keys, ['event_retry_1', 'event_retry_1']);
  });
}
