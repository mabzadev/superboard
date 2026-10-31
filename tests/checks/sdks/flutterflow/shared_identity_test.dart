import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:superboard_flutterflow/superboard_flutterflow.dart';

void main() {
  test(
    'custom identity tokens are cached, single-flight and rotatable',
    () async {
      var exchanges = 0;
      final client = SuperBoardApplicationClient(
        apiBaseUrl: 'https://api.example.test',
        filesBaseUrl: 'https://files.example.test',
        applicationAccessToken: 'application-access',
        httpClient: MockClient((request) async {
          exchanges += 1;
          await Future<void>.delayed(const Duration(milliseconds: 5));
          return http.Response(
            jsonEncode({
              'access_token': 'identity-$exchanges',
              'expires_in': 300,
            }),
            200,
          );
        }),
      );
      addTearDown(client.close);

      final tokens = await Future.wait([
        client.customIdentityToken(),
        client.customIdentityToken(),
      ]);
      expect(tokens, ['identity-1', 'identity-1']);
      expect(await client.customIdentityToken(), 'identity-1');
      expect(exchanges, 1);

      final rotated = await Future.wait([
        client.customIdentityToken(rejectedToken: 'identity-1'),
        client.customIdentityToken(rejectedToken: 'identity-1'),
      ]);
      expect(rotated, ['identity-2', 'identity-2']);
      expect(exchanges, 2);
    },
  );

  test(
    'Support actions reuse the application session identity token',
    () async {
      final exchanges = <String?>[];
      var configurationCalls = 0;
      final mock = MockClient((request) async {
        if (request.url.path == '/v1/auth/superboard-token') {
          exchanges.add(request.headers['authorization']);
          return http.Response(
            jsonEncode({
              'access_token': 'identity-${exchanges.length}',
              'expires_in': 300,
            }),
            200,
          );
        }
        if (request.url.path.endsWith('/configuration')) {
          configurationCalls += 1;
          if (request.headers['authorization'] == 'Bearer identity-1') {
            return http.Response(
              jsonEncode({
                'error': {'code': 'identity_expired', 'message': 'expired'},
              }),
              401,
            );
          }
          return http.Response(
            jsonEncode({
              'data': {'locale': 'fr'},
            }),
            200,
          );
        }
        return http.Response('{}', 404);
      });

      await http.runWithClient(() async {
        addTearDown(superboardApplicationDispose);
        addTearDown(superboardMessagingDispose);
        await superboardApplicationInitialize(
          apiBaseUrl: 'https://api.example.test',
          filesBaseUrl: 'https://files.example.test',
          applicationAccessToken: 'application-1',
        );
        await superboardMessagingInitializeAuthenticated(
          applicationAccessToken: 'application-1',
          projectId: 42,
          authGatewayUrl: 'https://api.example.test/',
          messagingUrl: 'https://support.example.test/api/v1/support-client',
        );
        expect(exchanges, ['Bearer application-1']);

        // The application session rotates; the Support provider must follow
        // it instead of reusing the access token captured at initialization.
        await superboardApplicationSetAccessToken('application-2');
        expect(
          jsonDecode(await superboardMessagingGetConfigurationJson()),
          containsPair('locale', 'fr'),
        );
        expect(exchanges, ['Bearer application-1', 'Bearer application-2']);
        expect(configurationCalls, 2);
      }, () => mock);
    },
  );
}
