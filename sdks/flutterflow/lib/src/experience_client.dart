import 'dart:convert';
import 'dart:math';

import 'package:http/http.dart' as http;

enum OpenGrowExperienceKind { paywall, onboarding }

class OpenGrowResolvedExperience {
  const OpenGrowResolvedExperience({
    required this.kind,
    required this.placement,
    required this.contentId,
    required this.placementId,
    required this.versionId,
    required this.version,
    required this.definition,
    required this.resolvedAt,
    this.experienceId,
    this.variantId,
    this.variant,
    this.fromCache = false,
  });

  final OpenGrowExperienceKind kind;
  final String placement;
  final String contentId;
  final String placementId;
  final String versionId;
  final int version;
  final Map<String, dynamic> definition;
  final DateTime resolvedAt;
  final String? experienceId;
  final String? variantId;
  final String? variant;
  final bool fromCache;

  OpenGrowResolvedExperience copyWith({bool? fromCache}) =>
      OpenGrowResolvedExperience(
        kind: kind,
        placement: placement,
        contentId: contentId,
        placementId: placementId,
        versionId: versionId,
        version: version,
        definition: definition,
        resolvedAt: resolvedAt,
        experienceId: experienceId,
        variantId: variantId,
        variant: variant,
        fromCache: fromCache ?? this.fromCache,
      );

  factory OpenGrowResolvedExperience.fromJson(
    OpenGrowExperienceKind kind,
    Map<String, dynamic> json,
  ) {
    final definition = json['definition'];
    if (definition is! Map ||
        json['placement_id'] == null ||
        json['version_id'] == null) {
      throw const FormatException('Invalid resolved experience response');
    }
    final contentKey = kind == OpenGrowExperienceKind.paywall
        ? 'paywall_id'
        : 'onboarding_id';
    return OpenGrowResolvedExperience(
      kind: kind,
      placement: json['placement']?.toString() ?? 'default',
      contentId: json[contentKey]?.toString() ?? '',
      placementId: json['placement_id'].toString(),
      versionId: json['version_id'].toString(),
      version: (json['version'] as num?)?.toInt() ?? 0,
      definition: definition.cast<String, dynamic>(),
      resolvedAt: DateTime.now().toUtc(),
      experienceId: json['experience_id']?.toString(),
      variantId: json['variant_id']?.toString(),
      variant: json['variant']?.toString(),
    );
  }
}

class OpenGrowExperienceEvent {
  OpenGrowExperienceEvent({
    required this.type,
    required this.resolved,
    required this.platform,
    this.stepId,
    this.customerId,
    this.revenueMicros = 0,
    this.currency,
    this.payload = const {},
    String? id,
    DateTime? occurredAt,
  }) : id = id ?? _uniqueId('event'),
       occurredAt = occurredAt ?? DateTime.now().toUtc();

  final String id;
  final String type;
  final OpenGrowResolvedExperience resolved;
  final String platform;
  final String? stepId;
  final String? customerId;
  final int revenueMicros;
  final String? currency;
  final Map<String, dynamic> payload;
  final DateTime occurredAt;

  Map<String, dynamic> toJson() => {
    'id': id,
    'type': type,
    'placement': resolved.placement,
    'occurred_at': occurredAt.toIso8601String(),
    'platform': platform,
    if (resolved.kind == OpenGrowExperienceKind.paywall)
      'paywall_id': resolved.contentId
    else
      'onboarding_id': resolved.contentId,
    'version_id': resolved.versionId,
    if (resolved.experienceId != null) 'experience_id': resolved.experienceId,
    if (resolved.variantId != null) 'variant_id': resolved.variantId,
    if (stepId != null) 'step_id': stepId,
    if (customerId != null) 'customer_id': customerId,
    if (resolved.kind == OpenGrowExperienceKind.paywall) ...{
      'session_id': payload['session_id'],
      'revenue_micros': revenueMicros,
      if (currency != null) 'currency': currency,
    },
    'payload': payload,
  };
}

abstract interface class OpenGrowExperienceCache {
  OpenGrowCacheEntry? read(String key);
  void write(String key, OpenGrowCacheEntry entry);
  void remove(String key);
}

class OpenGrowCacheEntry {
  const OpenGrowCacheEntry(this.value, this.cachedAt);
  final OpenGrowResolvedExperience? value;
  final DateTime cachedAt;
}

class OpenGrowMemoryExperienceCache implements OpenGrowExperienceCache {
  final Map<String, OpenGrowCacheEntry> _entries = {};
  @override
  OpenGrowCacheEntry? read(String key) => _entries[key];
  @override
  void remove(String key) => _entries.remove(key);
  @override
  void write(String key, OpenGrowCacheEntry entry) => _entries[key] = entry;
}

class OpenGrowExperienceException implements Exception {
  const OpenGrowExperienceException(
    this.message, {
    this.code = 'experience_request_failed',
    this.statusCode,
    this.retryable = false,
    this.requestId,
  });
  final String message;
  final String code;
  final int? statusCode;
  final bool retryable;
  final String? requestId;
  @override
  String toString() => message;
}

class OpenGrowExperienceClient {
  OpenGrowExperienceClient({
    required this.projectKey,
    required this.platform,
    required this.identifier,
    required this.baseUrl,
    this.environment = 'production',
    this.cacheTtl = const Duration(minutes: 5),
    this.maxStale = const Duration(days: 7),
    http.Client? httpClient,
    OpenGrowExperienceCache? cache,
    DateTime Function()? now,
  }) : _http = httpClient ?? http.Client(),
       _ownsHttp = httpClient == null,
       _cache = cache ?? OpenGrowMemoryExperienceCache(),
       _now = now ?? DateTime.now;

  final String projectKey;
  final String platform;
  final String identifier;
  final String environment;
  final String baseUrl;
  final Duration cacheTtl;
  final Duration maxStale;
  final http.Client _http;
  final bool _ownsHttp;
  final OpenGrowExperienceCache _cache;
  final DateTime Function() _now;
  final Set<String> _sentEventIds = {};

  Future<OpenGrowResolvedExperience?> resolvePaywall({
    required String placement,
    String? customerId,
    String? sessionId,
    String? locale,
    String? country,
    Map<String, dynamic> attributes = const {},
    bool forceRefresh = false,
  }) => _resolve(
    OpenGrowExperienceKind.paywall,
    placement: placement,
    customerId: customerId,
    anonymousId: sessionId,
    locale: locale,
    country: country,
    attributes: attributes,
    forceRefresh: forceRefresh,
  );

  Future<OpenGrowResolvedExperience?> resolveOnboarding({
    required String placement,
    String? customerId,
    String? anonymousId,
    String? appVersion,
    String? locale,
    Map<String, dynamic> attributes = const {},
    bool forceRefresh = false,
  }) => _resolve(
    OpenGrowExperienceKind.onboarding,
    placement: placement,
    customerId: customerId,
    anonymousId: anonymousId,
    appVersion: appVersion,
    locale: locale,
    attributes: attributes,
    forceRefresh: forceRefresh,
  );

  Future<OpenGrowResolvedExperience?> _resolve(
    OpenGrowExperienceKind kind, {
    required String placement,
    String? customerId,
    String? anonymousId,
    String? appVersion,
    String? locale,
    String? country,
    required Map<String, dynamic> attributes,
    required bool forceRefresh,
  }) async {
    final cacheKey = jsonEncode({
      'kind': kind.name,
      'placement': placement,
      'platform': platform,
      'customer_id': customerId ?? '',
      'anonymous_id': anonymousId ?? '',
      'app_version': appVersion ?? '',
      'locale': locale ?? '',
      'country': country ?? '',
      'attributes': _canonicalJson(attributes),
    });
    final cached = _cache.read(cacheKey);
    final now = _now().toUtc();
    if (!forceRefresh &&
        cached != null &&
        now.difference(cached.cachedAt) <= cacheTtl) {
      return cached.value?.copyWith(fromCache: true);
    }
    try {
      final response = await _http
          .post(
            _uri(kind, 'resolve'),
            headers: _headers(),
            body: jsonEncode({
              'placement': placement,
              'platform': platform,
              if (customerId != null && customerId.isNotEmpty)
                'customer_id': customerId,
              if (anonymousId != null && anonymousId.isNotEmpty)
                kind == OpenGrowExperienceKind.paywall
                        ? 'session_id'
                        : 'anonymous_id':
                    anonymousId,
              if (appVersion != null && appVersion.isNotEmpty)
                'app_version': appVersion,
              if (locale != null && locale.isNotEmpty) 'locale': locale,
              if (country != null && country.isNotEmpty) 'country': country,
              'attributes': attributes,
            }),
          )
          .timeout(const Duration(seconds: 10));
      final body = _decode(response);
      final raw = body['data'];
      final resolved = raw is Map
          ? OpenGrowResolvedExperience.fromJson(
              kind,
              raw.cast<String, dynamic>(),
            )
          : null;
      _cache.write(cacheKey, OpenGrowCacheEntry(resolved, now));
      return resolved;
    } catch (error) {
      if (cached != null && now.difference(cached.cachedAt) <= maxStale) {
        return cached.value?.copyWith(fromCache: true);
      }
      rethrow;
    }
  }

  Future<bool> track(OpenGrowExperienceEvent event) async {
    if (_sentEventIds.contains(event.id)) return false;
    final kind = event.resolved.kind;
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        final response = await _http
            .post(
              _uri(kind, 'events'),
              headers: {..._headers(), 'Idempotency-Key': event.id},
              body: jsonEncode({
                'events': [event.toJson()],
              }),
            )
            .timeout(const Duration(seconds: 10));
        _decode(response);
        _sentEventIds.add(event.id);
        return true;
      } on OpenGrowExperienceException catch (error) {
        if (!error.retryable) return false;
      } catch (_) {
        // Retry once using the exact same event and idempotency key.
      }
    }
    return false;
  }

  Map<String, String> _headers() => {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'PROJECT-KEY': projectKey,
    'PLATFORM': platform,
    'IDENTIFIER': identifier,
    'ENVIRONMENT': environment,
  };

  Uri _uri(OpenGrowExperienceKind kind, String resource) => Uri.parse(
    '${baseUrl.replaceFirst(RegExp(r'/+$'), '')}/${kind == OpenGrowExperienceKind.paywall ? 'paywalls' : 'onboardings'}/$resource',
  );

  Map<String, dynamic> _decode(http.Response response) {
    Map<String, dynamic> body;
    try {
      final decoded = response.body.isEmpty
          ? <String, dynamic>{}
          : jsonDecode(response.body);
      body = decoded is Map ? decoded.cast<String, dynamic>() : {};
    } catch (_) {
      throw OpenGrowExperienceException(
        'OpenGrow returned an invalid response',
        statusCode: response.statusCode,
        retryable: response.statusCode >= 500,
      );
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final error = body['error'] is Map
          ? (body['error'] as Map).cast<String, dynamic>()
          : const <String, dynamic>{};
      throw OpenGrowExperienceException(
        error['message']?.toString() ?? 'OpenGrow experience request failed',
        code: error['code']?.toString() ?? 'experience_request_failed',
        statusCode: response.statusCode,
        retryable: error['retryable'] == true || response.statusCode >= 500,
        requestId:
            error['request_id']?.toString() ?? response.headers['x-request-id'],
      );
    }
    return body;
  }

  void close() {
    if (_ownsHttp) _http.close();
  }
}

abstract final class OpenGrowExperienceSdk {
  static OpenGrowExperienceClient? _client;
  static OpenGrowExperienceClient get client {
    final value = _client;
    if (value == null) {
      throw const OpenGrowExperienceException(
        'OpenGrowBootstrap must configure experiences before rendering a widget',
        code: 'experience_not_configured',
      );
    }
    return value;
  }

  static void configure(OpenGrowExperienceClient value) {
    _client?.close();
    _client = value;
  }

  static void resetForTesting() {
    _client?.close();
    _client = null;
  }
}

String _uniqueId(String prefix) {
  final random = Random.secure().nextInt(0x7fffffff).toRadixString(36);
  return '${prefix}_${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}_$random';
}

Object? _canonicalJson(Object? value) {
  if (value is Map) {
    final keys = value.keys.map((key) => key.toString()).toList()..sort();
    return {for (final key in keys) key: _canonicalJson(value[key])};
  }
  if (value is List) return value.map(_canonicalJson).toList();
  return value;
}
