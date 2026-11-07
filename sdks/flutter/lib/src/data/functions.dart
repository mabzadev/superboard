import 'dart:convert';
import 'dart:typed_data';

import 'transport.dart';

final RegExp _functionNamePattern = RegExp(r'^[a-z][a-z0-9-]{0,47}$');

class SuperBoardFunctionResponse {
  const SuperBoardFunctionResponse({
    required this.statusCode,
    required this.headers,
    required this.bodyBytes,
  });

  final int statusCode;
  final Map<String, String> headers;
  final Uint8List bodyBytes;

  bool get ok => statusCode >= 200 && statusCode < 300;

  String get text => utf8.decode(bodyBytes, allowMalformed: true);

  /// Decodes the body as JSON; throws a [FormatException] when it is not.
  Object? json() => bodyBytes.isEmpty ? null : jsonDecode(text);
}

/// Thrown when a function answers with a status outside 200-299. The function
/// response stays available in [response].
class SuperBoardFunctionException extends SuperBoardDataException {
  const SuperBoardFunctionException(
    super.code,
    super.message, {
    required this.response,
    super.statusCode,
    super.retryable,
    super.requestId,
    super.details,
  });

  final SuperBoardFunctionResponse response;
}

class SuperBoardFunctions {
  SuperBoardFunctions(this._transport);

  final SuperBoardDataTransport _transport;

  /// Calls the function [name] at [path]. A map or list [body] is sent as
  /// JSON, a string as text and a [Uint8List] as raw bytes.
  Future<SuperBoardFunctionResponse> invoke(
    String name, {
    String method = 'POST',
    String path = '',
    Object? body,
    Map<String, String> headers = const {},
    Map<String, String>? query,
  }) async {
    if (!_functionNamePattern.hasMatch(name)) {
      throw ArgumentError.value(name, 'name', 'Invalid function name');
    }
    final requestHeaders = {...headers};
    Object? json;
    Uint8List? bytes;
    switch (body) {
      case null:
        break;
      case Uint8List():
        bytes = body;
      case String():
        bytes = utf8.encode(body);
        requestHeaders.putIfAbsent(
          'Content-Type',
          () => 'text/plain; charset=utf-8',
        );
      case Map() || List():
        json = body;
      default:
        throw ArgumentError.value(body, 'body', 'Unsupported body type');
    }
    final segments = path.split('/').where((segment) => segment.isNotEmpty);
    final response = await _transport.send(
      method.toUpperCase(),
      _transport.uri(['functions', name, ...segments], query),
      json: json,
      bytes: bytes,
      headers: requestHeaders,
    );
    final result = SuperBoardFunctionResponse(
      statusCode: response.statusCode,
      headers: response.headers,
      bodyBytes: response.bodyBytes,
    );
    if (!result.ok) {
      final error = errorFromResponse(response);
      throw SuperBoardFunctionException(
        error.code,
        error.message,
        response: result,
        statusCode: error.statusCode,
        retryable: error.retryable,
        requestId: error.requestId,
        details: error.details,
      );
    }
    return result;
  }
}
