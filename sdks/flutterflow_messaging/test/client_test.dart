import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:opengrow_flutterflow_messaging/opengrow_flutterflow_messaging.dart';

void main() {
  test('sends VocoStar identity and project headers', () async {
    final client = OpenGrowMessagingClient(
      baseUri: Uri.parse('https://messages.example'),
      projectId: 11,
      identityToken: 'signed-token',
      httpClient: MockClient((request) async {
        expect(request.headers['authorization'], 'Bearer signed-token');
        expect(request.headers['x-opengrow-project-id'], '11');
        return http.Response(jsonEncode({'data': [{
          'id': 'conversation-1', 'status': 'open', 'priority': 'normal',
        }]}), 200);
      }),
    );
    expect((await client.conversations()).single.id, 'conversation-1');
  });

  test('surfaces stable server errors', () async {
    final client = OpenGrowMessagingClient(
      baseUri: Uri.parse('https://messages.example'), projectId: 11, identityToken: 'token',
      httpClient: MockClient((_) async => http.Response(jsonEncode({
        'code': 'identity_invalid', 'message': 'expired', 'retryable': false,
      }), 401)),
    );
    expect(client.conversations, throwsA(isA<OpenGrowMessagingException>()));
  });
}
