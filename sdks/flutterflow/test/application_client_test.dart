import 'dart:convert';
import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart';

void main() {
  test(
    'sign-in keeps the access token in memory and authenticates profile reads',
    () async {
      final requests = <http.Request>[];
      final client = OpenGrowApplicationClient(
        apiBaseUrl: 'https://api.example.test',
        filesBaseUrl: 'https://files.example.test',
        projectKey: 'project-key',
        platform: 'ios',
        identifier: 'com.example.app',
        httpClient: MockClient((request) async {
          requests.add(request);
          if (request.url.path == '/auth/signin/password') {
            return http.Response(
              jsonEncode({
                'access_token': 'access-1',
                'refresh_token': 'refresh-1',
                'user_id': 'user-1',
              }),
              200,
            );
          }
          return http.Response(
            jsonEncode({
              'user': {'id': 'user-1'},
            }),
            200,
          );
        }),
      );

      final session = await client.signInPassword(
        email: 'user@example.test',
        password: 'long-test-password',
      );
      expect(session['user_id'], 'user-1');
      expect(requests[0].headers['project-key'], 'project-key');
      expect(requests[0].headers['platform'], 'ios');
      expect(requests[0].headers['identifier'], 'com.example.app');
      await client.profile();
      expect(requests[1].headers['authorization'], 'Bearer access-1');
    },
  );

  test('uploads bytes only to the configured Files origin', () async {
    late http.Request uploaded;
    final client = OpenGrowApplicationClient(
      apiBaseUrl: 'https://api.example.test',
      filesBaseUrl: 'https://files.example.test',
      applicationAccessToken: 'access-1',
      httpClient: MockClient((request) async {
        uploaded = request;
        return http.Response(
          jsonEncode({
            'file': {'id': 'file-1'},
          }),
          201,
        );
      }),
    );
    final result = await client.uploadFile(
      bytes: Uint8List.fromList([1, 2, 3]),
      filename: 'voice.wav',
      contentType: 'audio/wav',
    );
    expect(result['file'], {'id': 'file-1'});
    expect(uploaded.url.origin, 'https://files.example.test');
    expect(uploaded.url.path, '/v1/files');
    expect(uploaded.headers['x-filename'], 'voice.wav');
    expect(uploaded.bodyBytes, [1, 2, 3]);
  });

  test(
    'links a provider only through the authenticated Identity authority',
    () async {
      late http.Request observed;
      final client = OpenGrowApplicationClient(
        apiBaseUrl: 'https://api.example.test',
        filesBaseUrl: 'https://files.example.test',
        projectKey: 'project-key',
        platform: 'ios',
        identifier: 'com.example.app',
        applicationAccessToken: 'application-access',
        httpClient: MockClient((request) async {
          observed = request;
          return http.Response(
            jsonEncode({'linked': true, 'provider': 'google'}),
            200,
          );
        }),
      );

      final result = await client.linkProvider(
        provider: 'google',
        idToken: 'verified-google-token',
      );
      expect(result, {'linked': true, 'provider': 'google'});
      expect(observed.method, 'POST');
      expect(observed.url.path, '/auth/link/google');
      expect(observed.headers['authorization'], 'Bearer application-access');
      expect(jsonDecode(observed.body), {'token': 'verified-google-token'});
    },
  );

  test('loads runtime policy with project-scoped SDK headers', () async {
    late http.Request observed;
    final client = OpenGrowApplicationClient(
      apiBaseUrl: 'https://api.example.test',
      filesBaseUrl: 'https://files.example.test',
      projectKey: 'test_project-key',
      platform: 'ios',
      identifier: 'com.example.app',
      environment: 'test',
      httpClient: MockClient((request) async {
        observed = request;
        return http.Response(
          jsonEncode({
            'data': {
              'status': 'update_required',
              'update': {'required': true},
            },
          }),
          200,
        );
      }),
    );
    final policy = await client.runtimePolicy(appVersion: '1.0.5', build: '1');
    expect(policy['data']['status'], 'update_required');
    expect(observed.url.path, '/api/v1/app/runtime-policy');
    expect(observed.headers['project-key'], 'test_project-key');
    expect(observed.headers['platform'], 'ios');
    expect(observed.headers['identifier'], 'com.example.app');
    expect(observed.headers['environment'], 'test');
    expect(jsonDecode(observed.body), {'app_version': '1.0.5', 'build': '1'});
  });

  test(
    'exchanges application identity and submits owner-scoped custom jobs',
    () async {
      final requests = <http.Request>[];
      final client = OpenGrowApplicationClient(
        apiBaseUrl: 'https://api.example.test',
        filesBaseUrl: 'https://files.example.test',
        applicationAccessToken: 'application-access',
        projectKey: 'project-key',
        platform: 'android',
        identifier: 'com.example.app',
        environment: 'production',
        httpClient: MockClient((request) async {
          requests.add(request);
          if (request.url.path == '/auth/opengrow-token') {
            return http.Response(
              jsonEncode({
                'access_token': 'short-lived-identity',
                'expires_in': 300,
              }),
              200,
            );
          }
          if (request.url.path.endsWith('/jobs/job-1/cancel')) {
            return http.Response(
              jsonEncode({'id': 'job-1', 'status': 'cancelled'}),
              202,
            );
          }
          if (request.method == 'POST') {
            return http.Response(
              jsonEncode({'id': 'job-1', 'status': 'queued'}),
              202,
            );
          }
          if (request.url.path.endsWith('/jobs/job-1')) {
            return http.Response(
              jsonEncode({'id': 'job-1', 'status': 'completed'}),
              200,
            );
          }
          return http.Response(
            jsonEncode({
              'jobs': [
                {'id': 'job-1', 'status': 'running'},
              ],
              'nextCursor': null,
            }),
            200,
          );
        }),
      );

      final created = await client.createCustomJob(
        capability: 'vocostar.media.convert',
        payload: {
          'mediaType': 'text',
          'input': {'text': 'Bonjour'},
        },
        idempotencyKey: 'mobile-job-1',
      );
      expect(created['id'], 'job-1');
      final listed = await client.listCustomJobs(
        status: 'running',
        capability: 'vocostar.media.convert',
      );
      expect((listed['jobs'] as List).single['id'], 'job-1');
      final detail = await client.customJob('job-1');
      expect(detail, {'id': 'job-1', 'status': 'completed'});
      final cancelled = await client.cancelCustomJob('job-1');
      expect(cancelled, {'id': 'job-1', 'status': 'cancelled'});

      expect(requests, hasLength(5));
      expect(requests[0].url.path, '/auth/opengrow-token');
      expect(requests[0].headers['authorization'], 'Bearer application-access');
      expect(requests[1].url.path, '/api/v1/sdk/custom/v1/jobs');
      expect(
        requests[1].headers['authorization'],
        'Bearer short-lived-identity',
      );
      expect(requests[1].headers['project-key'], 'project-key');
      expect(requests[1].headers['platform'], 'android');
      expect(requests[1].headers['identifier'], 'com.example.app');
      expect(requests[1].headers['idempotency-key'], 'mobile-job-1');
      expect(jsonDecode(requests[1].body), {
        'capability': 'vocostar.media.convert',
        'payload': {
          'mediaType': 'text',
          'input': {'text': 'Bonjour'},
        },
      });
      expect(requests[2].url.queryParameters, {
        'limit': '25',
        'status': 'running',
        'capability': 'vocostar.media.convert',
      });
      expect(
        requests[2].headers['authorization'],
        'Bearer short-lived-identity',
      );
      expect(requests[3].url.path, '/api/v1/sdk/custom/v1/jobs/job-1');
      expect(
        requests[3].headers['authorization'],
        'Bearer short-lived-identity',
      );
      expect(requests[4].url.path, '/api/v1/sdk/custom/v1/jobs/job-1/cancel');
      expect(requests[4].method, 'POST');
      expect(
        requests[4].headers['authorization'],
        'Bearer short-lived-identity',
      );
    },
  );

  test('reads and updates project-scoped Marketing preferences', () async {
    final requests = <http.Request>[];
    final client = OpenGrowApplicationClient(
      apiBaseUrl: 'https://api.example.test',
      filesBaseUrl: 'https://files.example.test',
      applicationAccessToken: 'application-access',
      projectKey: 'test_project-key',
      platform: 'web',
      identifier: 'reference.example.test',
      environment: 'test',
      httpClient: MockClient((request) async {
        requests.add(request);
        return http.Response(
          jsonEncode({
            'data': {'consented': request.method == 'PUT'},
          }),
          200,
        );
      }),
    );

    expect((await client.marketingPreferences())['data']['consented'], false);
    expect(
      (await client.updateMarketingConsent(
        consented: true,
        idempotencyKey: 'consent-reference-1',
        attributes: {'locale': 'fr-CH'},
        listIds: ['product-news'],
      ))['data']['consented'],
      true,
    );

    expect(requests, hasLength(2));
    for (final request in requests) {
      expect(request.url.path, '/api/v1/sdk/marketing/v1/preferences');
      expect(request.headers['authorization'], 'Bearer application-access');
      expect(request.headers['project-key'], 'test_project-key');
      expect(request.headers['platform'], 'web');
      expect(request.headers['identifier'], 'reference.example.test');
      expect(request.headers['environment'], 'test');
    }
    expect(requests[0].method, 'GET');
    expect(requests[1].method, 'PUT');
    expect(requests[1].headers['idempotency-key'], 'consent-reference-1');
    expect(jsonDecode(requests[1].body), {
      'consented': true,
      'attributes': {'locale': 'fr-CH'},
      'list_ids': ['product-news'],
    });
  });

  test(
    'deletes the complete application account through the SDK coordinator',
    () async {
      late http.Request observed;
      final client = OpenGrowApplicationClient(
        apiBaseUrl: 'https://api.example.test',
        filesBaseUrl: 'https://files.example.test',
        applicationAccessToken: 'application-access',
        projectKey: 'test_project-key',
        platform: 'ios',
        identifier: 'com.example.app',
        environment: 'test',
        httpClient: MockClient((request) async {
          observed = request;
          return http.Response(
            jsonEncode({
              'data': {
                'deleted': true,
                'status': 'completed',
                'operation_id': 'erasure-1',
              },
            }),
            200,
          );
        }),
      );

      final result = await client.deleteAccount();
      expect(result['data']['deleted'], true);
      expect(observed.method, 'DELETE');
      expect(observed.url.path, '/api/v1/sdk/account/v1');
      expect(observed.headers['authorization'], 'Bearer application-access');
      expect(observed.headers['project-key'], 'test_project-key');
      expect(observed.headers['platform'], 'ios');
      expect(observed.headers['identifier'], 'com.example.app');
      expect(observed.headers['environment'], 'test');
      expect(client.applicationAccessToken, isEmpty);
    },
  );

  test('deduplicates concurrent custom identity exchanges', () async {
    var exchanges = 0;
    final exchangeStarted = Completer<void>();
    final releaseExchange = Completer<void>();
    final client = OpenGrowApplicationClient(
      apiBaseUrl: 'https://api.example.test',
      filesBaseUrl: 'https://files.example.test',
      applicationAccessToken: 'application-access',
      projectKey: 'project-key',
      platform: 'ios',
      identifier: 'com.example.app',
      httpClient: MockClient((request) async {
        if (request.url.path == '/auth/opengrow-token') {
          exchanges += 1;
          if (!exchangeStarted.isCompleted) exchangeStarted.complete();
          await releaseExchange.future;
          return http.Response(
            jsonEncode({
              'access_token': 'short-lived-identity',
              'expires_in': 300,
            }),
            200,
          );
        }
        return http.Response(jsonEncode({'jobs': [], 'nextCursor': null}), 200);
      }),
    );

    final first = client.listCustomJobs();
    await exchangeStarted.future;
    final second = client.listCustomJobs();
    await Future<void>.delayed(Duration.zero);
    expect(exchanges, 1);
    releaseExchange.complete();
    await Future.wait([first, second]);
    expect(exchanges, 1);
  });

  test(
    'surfaces stable API errors and does not accept unknown providers',
    () async {
      final client = OpenGrowApplicationClient(
        apiBaseUrl: 'https://api.example.test',
        filesBaseUrl: 'https://files.example.test',
        projectKey: 'project-key',
        platform: 'ios',
        identifier: 'com.example.app',
        httpClient: MockClient(
          (_) async => http.Response(
            jsonEncode({
              'error': {
                'code': 'credentials_invalid',
                'message': 'Invalid',
                'retryable': false,
              },
            }),
            401,
          ),
        ),
      );
      await expectLater(
        client.signInPassword(
          email: 'user@example.test',
          password: 'wrong-password',
        ),
        throwsA(
          isA<OpenGrowApplicationException>().having(
            (error) => error.code,
            'code',
            'credentials_invalid',
          ),
        ),
      );
      expect(
        () => client.signInProvider(provider: 'microsoft', idToken: 'token'),
        throwsA(isA<OpenGrowApplicationException>()),
      );
      expect(
        () => client.linkProvider(provider: 'microsoft', idToken: 'token'),
        throwsA(isA<OpenGrowApplicationException>()),
      );
    },
  );
}
