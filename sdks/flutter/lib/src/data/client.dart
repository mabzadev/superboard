import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import 'database.dart';
import 'functions.dart';
import 'realtime.dart';
import 'storage.dart';
import 'transport.dart';
import 'vectors.dart';

/// Client for the application database, storage, realtime, functions and
/// vectors served under `/v1/data` of the SuperBoard SDK origin.
class SuperBoardData {
  factory SuperBoardData({
    required String baseUrl,
    required String projectKey,
    required String platformIdentifier,
    String? platform,
    String? accessToken,
    SuperBoardDataAccessTokenProvider? accessTokenProvider,
    String sdkVersion = '4.0.0',
    http.Client? httpClient,
    SuperBoardRealtimeConnector? webSocketConnector,
    Duration requestTimeout = const Duration(seconds: 20),
    Duration heartbeatInterval = const Duration(seconds: 25),
    List<Duration>? reconnectDelays,
  }) {
    final key = projectKey.trim();
    final identifier = platformIdentifier.trim();
    if (key.isEmpty) {
      throw ArgumentError.value(projectKey, 'projectKey', 'Cannot be empty');
    }
    if (identifier.isEmpty) {
      throw ArgumentError.value(
        platformIdentifier,
        'platformIdentifier',
        'Cannot be empty',
      );
    }
    final resolvedPlatform = (platform ?? _currentPlatform()).toLowerCase();
    if (!const {
      'ios',
      'android',
      'web',
      'desktop',
    }.contains(resolvedPlatform)) {
      throw ArgumentError.value(
        platform,
        'platform',
        'Expected ios, android, web or desktop',
      );
    }
    if (requestTimeout <= Duration.zero) {
      throw ArgumentError.value(
        requestTimeout,
        'requestTimeout',
        'Must be positive',
      );
    }
    final client = httpClient ?? http.Client();
    final transport = SuperBoardDataTransport(
      baseUri: _normalizedBaseUri(baseUrl),
      sdkHeaders: {
        'PROJECT-KEY': key,
        'PLATFORM': resolvedPlatform,
        'IDENTIFIER': identifier,
        'X-SuperBoard-SDK-Version': sdkVersion,
      },
      httpClient: client,
      requestTimeout: requestTimeout,
      accessToken: accessToken,
      accessTokenProvider: accessTokenProvider,
    );
    return SuperBoardData._(
      transport,
      httpClient == null ? client : null,
      SuperBoardRealtime(
        transport,
        connector: webSocketConnector,
        heartbeatInterval: heartbeatInterval,
        reconnectDelays:
            reconnectDelays ??
            const [
              Duration(seconds: 1),
              Duration(seconds: 2),
              Duration(seconds: 5),
              Duration(seconds: 10),
              Duration(seconds: 30),
            ],
      ),
    );
  }

  SuperBoardData._(this._transport, this._ownedHttp, this.realtime)
    : storage = SuperBoardStorage(_transport),
      functions = SuperBoardFunctions(_transport),
      vectors = SuperBoardVectors(_transport),
      ai = SuperBoardAi(_transport);

  final SuperBoardDataTransport _transport;
  final http.Client? _ownedHttp;
  final SuperBoardStorage storage;
  final SuperBoardRealtime realtime;
  final SuperBoardFunctions functions;
  final SuperBoardVectors vectors;
  final SuperBoardAi ai;

  /// Starts a query on the application table [table].
  SuperBoardDataQuery from(String table) =>
      SuperBoardDataQuery(_transport, table);

  /// Replaces the application access token sent with each request. Pass null
  /// to call as an anonymous user.
  void setAccessToken(String? token) => _transport.setAccessToken(token);

  Future<void> dispose() async {
    await realtime.dispose();
    _ownedHttp?.close();
  }
}

String _currentPlatform() {
  if (kIsWeb) return 'web';
  return switch (defaultTargetPlatform) {
    TargetPlatform.iOS => 'ios',
    TargetPlatform.android => 'android',
    _ => 'desktop',
  };
}

Uri _normalizedBaseUri(String baseUrl) {
  final parsed = Uri.tryParse(baseUrl.trim());
  if (parsed == null ||
      !const {'http', 'https'}.contains(parsed.scheme) ||
      parsed.host.isEmpty) {
    throw ArgumentError.value(baseUrl, 'baseUrl', 'Expected an HTTP(S) URL');
  }
  final segments = parsed.pathSegments
      .where((segment) => segment.isNotEmpty)
      .toList();
  if (segments.length >= 2 &&
      segments[segments.length - 2] == 'v1' &&
      segments.last == 'data') {
    segments.removeRange(segments.length - 2, segments.length);
  }
  return Uri(
    scheme: parsed.scheme,
    host: parsed.host,
    port: parsed.hasPort ? parsed.port : null,
    pathSegments: segments,
  );
}
