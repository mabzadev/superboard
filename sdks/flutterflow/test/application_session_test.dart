import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:opengrow_flutterflow/opengrow_flutterflow.dart';

void main() {
  test(
    'persists a complete identity session outside FlutterFlow App State',
    () async {
      final storage = MemoryApplicationSessionStorage();
      final now = DateTime.utc(2026, 8, 10, 8);
      final client = OpenGrowApplicationClient(
        apiBaseUrl: 'https://api.example.test',
        filesBaseUrl: 'https://files.example.test',
        httpClient: MockClient(
          (_) async => http.Response(
            jsonEncode({
              'access_token': 'access-1',
              'refresh_token': 'refresh-1',
              'expires_in': 300,
              'user_id': 'user-1',
              'user': {'email': 'user@example.test'},
            }),
            200,
          ),
        ),
      );
      final manager = OpenGrowApplicationSessionManager(
        client: client,
        storage: storage,
        storageKey: 'session-key',
        clock: () => now,
      );

      final session = await manager.signInPassword(
        email: 'user@example.test',
        password: 'long-test-password',
      );

      expect(session.accessToken, 'access-1');
      expect(client.applicationAccessToken, 'access-1');
      expect(storage.values, hasLength(1));
      final persisted = jsonDecode(storage.values['session-key']!);
      expect(persisted['refresh_token'], 'refresh-1');
      expect(persisted['expires_at'], '2026-08-10T08:05:00.000Z');
    },
  );

  test('restores a valid secure session without a network request', () async {
    final storage = MemoryApplicationSessionStorage({
      'session-key': jsonEncode({
        'version': 1,
        'access_token': 'stored-access',
        'refresh_token': 'stored-refresh',
        'expires_at': '2026-08-10T09:00:00.000Z',
        'user_id': 'user-1',
        'user': {'email': 'user@example.test'},
      }),
    });
    var requests = 0;
    final client = OpenGrowApplicationClient(
      apiBaseUrl: 'https://api.example.test',
      filesBaseUrl: 'https://files.example.test',
      httpClient: MockClient((_) async {
        requests += 1;
        return http.Response('{}', 500);
      }),
    );
    final manager = OpenGrowApplicationSessionManager(
      client: client,
      storage: storage,
      storageKey: 'session-key',
      clock: () => DateTime.utc(2026, 8, 10, 8),
    );

    final restored = await manager.restore();

    expect(restored?.userId, 'user-1');
    expect(client.applicationAccessToken, 'stored-access');
    expect(requests, 0);
  });

  test(
    'rotates an expired refresh token and replaces the secure record',
    () async {
      final storage = MemoryApplicationSessionStorage({
        'session-key': jsonEncode({
          'version': 1,
          'access_token': 'expired-access',
          'refresh_token': 'refresh-1',
          'expires_at': '2026-08-10T07:59:00.000Z',
          'user_id': 'user-1',
          'user': const {},
        }),
      });
      late http.Request refreshRequest;
      final client = OpenGrowApplicationClient(
        apiBaseUrl: 'https://api.example.test',
        filesBaseUrl: 'https://files.example.test',
        httpClient: MockClient((request) async {
          refreshRequest = request;
          return http.Response(
            jsonEncode({
              'access_token': 'access-2',
              'refresh_token': 'refresh-2',
              'expires_in': 600,
              'user_id': 'user-1',
              'user': const {},
            }),
            200,
          );
        }),
      );
      final manager = OpenGrowApplicationSessionManager(
        client: client,
        storage: storage,
        storageKey: 'session-key',
        clock: () => DateTime.utc(2026, 8, 10, 8),
      );

      final restored = await manager.restore();

      expect(refreshRequest.url.path, '/auth/refresh');
      expect(jsonDecode(refreshRequest.body), {'refresh_token': 'refresh-1'});
      expect(restored?.accessToken, 'access-2');
      expect(
        jsonDecode(storage.values['session-key']!)['refresh_token'],
        'refresh-2',
      );
    },
  );

  test('clears an invalid or revoked secure session fail-closed', () async {
    final storage = MemoryApplicationSessionStorage({
      'session-key': jsonEncode({
        'version': 1,
        'access_token': 'expired-access',
        'refresh_token': 'revoked-refresh',
        'expires_at': '2026-08-10T07:59:00.000Z',
        'user_id': 'user-1',
        'user': const {},
      }),
    });
    final client = OpenGrowApplicationClient(
      apiBaseUrl: 'https://api.example.test',
      filesBaseUrl: 'https://files.example.test',
      httpClient: MockClient(
        (_) async => http.Response(
          jsonEncode({
            'error': {
              'code': 'refresh_token_invalid',
              'message': 'Invalid refresh token',
              'retryable': false,
            },
          }),
          401,
        ),
      ),
    );
    final manager = OpenGrowApplicationSessionManager(
      client: client,
      storage: storage,
      storageKey: 'session-key',
      clock: () => DateTime.utc(2026, 8, 10, 8),
    );

    expect(await manager.restore(), isNull);
    expect(storage.values, isEmpty);
    expect(client.applicationAccessToken, isEmpty);
  });

  test(
    'logout removes local credentials even when the network fails',
    () async {
      final storage = MemoryApplicationSessionStorage();
      final client = OpenGrowApplicationClient(
        apiBaseUrl: 'https://api.example.test',
        filesBaseUrl: 'https://files.example.test',
        httpClient: MockClient((request) async {
          if (request.url.path == '/auth/signin/password') {
            return http.Response(
              jsonEncode({
                'access_token': 'access-1',
                'refresh_token': 'refresh-1',
                'expires_in': 300,
                'user_id': 'user-1',
                'user': const {},
              }),
              200,
            );
          }
          return http.Response('temporary failure', 503);
        }),
      );
      final manager = OpenGrowApplicationSessionManager(
        client: client,
        storage: storage,
        storageKey: 'session-key',
      );
      await manager.signInPassword(
        email: 'user@example.test',
        password: 'long-test-password',
      );

      await expectLater(
        manager.logout(),
        throwsA(isA<OpenGrowApplicationException>()),
      );
      expect(storage.values, isEmpty);
      expect(client.applicationAccessToken, isEmpty);
    },
  );

  test('session storage keys are isolated by target and environment', () {
    final production = OpenGrowApplicationSessionManager.scopedStorageKey(
      apiBaseUri: Uri.parse('https://api.example.test'),
      projectKey: 'project-a',
      environment: 'production',
    );
    final development = OpenGrowApplicationSessionManager.scopedStorageKey(
      apiBaseUri: Uri.parse('https://api.example.test'),
      projectKey: 'project-a',
      environment: 'development',
    );
    final anotherProject = OpenGrowApplicationSessionManager.scopedStorageKey(
      apiBaseUri: Uri.parse('https://api.example.test'),
      projectKey: 'project-b',
      environment: 'production',
    );

    expect({production, development, anotherProject}, hasLength(3));
  });
}

class MemoryApplicationSessionStorage
    implements OpenGrowApplicationSessionStorage {
  MemoryApplicationSessionStorage([Map<String, String>? initial])
    : values = {...?initial};

  final Map<String, String> values;

  @override
  Future<void> delete({required String key}) async {
    values.remove(key);
  }

  @override
  Future<String?> read({required String key}) async => values[key];

  @override
  Future<void> write({required String key, required String value}) async {
    values[key] = value;
  }
}
