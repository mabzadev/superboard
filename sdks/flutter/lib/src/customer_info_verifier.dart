import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:jose/jose.dart';
import 'package:shared_preferences/shared_preferences.dart';

class OpenGrowCustomerInfoVerificationException implements Exception {
  const OpenGrowCustomerInfoVerificationException(this.message);
  final String message;

  @override
  String toString() => 'OpenGrowCustomerInfoVerificationException: $message';
}

class OpenGrowCustomerInfoVerifier {
  OpenGrowCustomerInfoVerifier({http.Client? client}) : _client = client;

  final http.Client? _client;

  Future<Map<String, dynamic>> verify({
    required Map<String, dynamic> envelope,
    required String purchasesBaseUrl,
    required SharedPreferences preferences,
    bool allowExpiredSignatureForOfflineEntitlements = false,
  }) async {
    final compact = envelope['signature']?.toString() ?? '';
    if (compact.isEmpty) {
      throw const OpenGrowCustomerInfoVerificationException(
        'CustomerInfo signature is missing',
      );
    }
    final parts = compact.split('.');
    if (parts.length != 3) {
      throw const OpenGrowCustomerInfoVerificationException(
        'CustomerInfo signature is malformed',
      );
    }
    final header = _decodePart(parts[0]);
    if (header['alg'] != 'ES256' ||
        (header['kid']?.toString().isEmpty ?? true)) {
      throw const OpenGrowCustomerInfoVerificationException(
        'CustomerInfo signature algorithm is not allowed',
      );
    }

    try {
      return await _verifyWithKeys(
        compact,
        await _loadJwks(purchasesBaseUrl, preferences),
        allowExpiredSignatureForOfflineEntitlements:
            allowExpiredSignatureForOfflineEntitlements,
      );
    } catch (_) {
      return _verifyWithKeys(
        compact,
        await _loadJwks(purchasesBaseUrl, preferences, forceRefresh: true),
        allowExpiredSignatureForOfflineEntitlements:
            allowExpiredSignatureForOfflineEntitlements,
      );
    }
  }

  Future<Map<String, dynamic>> _verifyWithKeys(
    String compact,
    Map<String, dynamic> jwks, {
    required bool allowExpiredSignatureForOfflineEntitlements,
  }) async {
    final rawKeys = jwks['keys'];
    if (rawKeys is! List || rawKeys.isEmpty) {
      throw const OpenGrowCustomerInfoVerificationException(
        'Purchases verification keys are unavailable',
      );
    }
    final store = JsonWebKeyStore();
    for (final value in rawKeys) {
      if (value is Map) {
        store.addKey(JsonWebKey.fromJson(value.cast<String, dynamic>()));
      }
    }
    final jws = JsonWebSignature.fromCompactSerialization(compact);
    if (!await jws.verify(store)) {
      throw const OpenGrowCustomerInfoVerificationException(
        'CustomerInfo signature is invalid',
      );
    }
    final claims = jsonDecode(jws.unverifiedPayload.stringContent);
    if (claims is! Map) {
      throw const OpenGrowCustomerInfoVerificationException(
        'CustomerInfo claims are invalid',
      );
    }
    final values = claims.cast<String, dynamic>();
    final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    final expiresAt = (values['exp'] as num?)?.toInt() ?? 0;
    final issuedAt = (values['iat'] as num?)?.toInt() ?? 0;
    final audience = values['aud'];
    final audienceMatches =
        audience == 'opengrow-sdk' ||
        (audience is List && audience.contains('opengrow-sdk'));
    if (values['iss'] != 'opengrow-purchases' ||
        !audienceMatches ||
        expiresAt == 0 ||
        issuedAt == 0 ||
        issuedAt > now + 30) {
      throw const OpenGrowCustomerInfoVerificationException(
        'CustomerInfo claims are invalid or expired',
      );
    }
    final customerInfo = values['customer_info'];
    if (customerInfo is! Map) {
      throw const OpenGrowCustomerInfoVerificationException(
        'Signed CustomerInfo payload is missing',
      );
    }
    final verified = customerInfo.cast<String, dynamic>();
    if (values['sub']?.toString() !=
        verified['original_app_user_id']?.toString()) {
      throw const OpenGrowCustomerInfoVerificationException(
        'CustomerInfo subject does not match the customer',
      );
    }
    if (expiresAt < now - 5 &&
        (!allowExpiredSignatureForOfflineEntitlements ||
            !_hasOnlyFiniteUnexpiredActiveEntitlements(verified, now))) {
      throw const OpenGrowCustomerInfoVerificationException(
        'CustomerInfo claims are invalid or expired',
      );
    }
    return {...verified, 'signature': compact, 'signature_algorithm': 'ES256'};
  }

  bool _hasOnlyFiniteUnexpiredActiveEntitlements(
    Map<String, dynamic> customerInfo,
    int now,
  ) {
    final entitlements = customerInfo['entitlements'];
    if (entitlements is! Map) return false;
    var hasActive = false;
    for (final value in entitlements.values) {
      if (value is! Map || value['is_active'] != true) continue;
      hasActive = true;
      final expiresAt = DateTime.tryParse(
        value['expires_at']?.toString() ?? '',
      );
      if (expiresAt == null ||
          expiresAt.millisecondsSinceEpoch ~/ 1000 <= now) {
        return false;
      }
    }
    return hasActive;
  }

  Future<Map<String, dynamic>> _loadJwks(
    String purchasesBaseUrl,
    SharedPreferences preferences, {
    bool forceRefresh = false,
  }) async {
    final base = Uri.parse(purchasesBaseUrl);
    final uri = base.replace(
      path: '/.well-known/purchases-jwks.json',
      query: null,
      fragment: null,
    );
    final cacheKey = 'opengrow.purchases.jwks.${uri.host}';
    if (!forceRefresh) {
      final cached = preferences.getString(cacheKey);
      if (cached != null) {
        final value = jsonDecode(cached);
        if (value is Map) return value.cast<String, dynamic>();
      }
    }
    final ownsClient = _client == null;
    final client = _client ?? http.Client();
    try {
      final response = await client
          .get(uri, headers: const {'Accept': 'application/json'})
          .timeout(const Duration(seconds: 10));
      if (response.statusCode != 200 || response.bodyBytes.length > 256000) {
        throw const OpenGrowCustomerInfoVerificationException(
          'Purchases verification keys could not be loaded',
        );
      }
      final value = jsonDecode(response.body);
      if (value is! Map || value['keys'] is! List) {
        throw const OpenGrowCustomerInfoVerificationException(
          'Purchases verification keys are invalid',
        );
      }
      final result = value.cast<String, dynamic>();
      await preferences.setString(cacheKey, jsonEncode(result));
      return result;
    } finally {
      if (ownsClient) client.close();
    }
  }

  Map<String, dynamic> _decodePart(String value) {
    final normalized = base64Url.normalize(value);
    final decoded = jsonDecode(utf8.decode(base64Url.decode(normalized)));
    if (decoded is! Map) {
      throw const OpenGrowCustomerInfoVerificationException(
        'CustomerInfo signature header is invalid',
      );
    }
    return decoded.cast<String, dynamic>();
  }
}
