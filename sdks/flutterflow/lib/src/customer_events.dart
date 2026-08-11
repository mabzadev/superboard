import 'dart:collection';
import 'dart:convert';
import 'dart:math';

import 'package:http/http.dart' as http;

/// A customer analytics event accepted by the SuperBoard App module.
class SuperBoardCustomerEvent {
  SuperBoardCustomerEvent({
    required String type,
    String? id,
    this.customerId,
    this.referrerCustomerId,
    this.platform,
    DateTime? occurredAt,
    this.revenueCents,
    this.engagementTime,
    this.metadata = const {},
  }) : id = (id == null || id.trim().isEmpty)
           ? _uniqueCustomerEventId()
           : id.trim(),
       type = type.trim(),
       occurredAt = (occurredAt ?? DateTime.now()).toUtc() {
    _validate();
  }

  final String id;
  final String? customerId;
  final String? referrerCustomerId;
  final String type;
  final String? platform;
  final DateTime occurredAt;
  final int? revenueCents;
  final int? engagementTime;
  final Map<String, dynamic> metadata;

  factory SuperBoardCustomerEvent.fromJson(Map<String, dynamic> json) {
    final rawId = json['id']?.toString().trim() ?? '';
    if (rawId.isEmpty) {
      throw const FormatException('Customer event id is required');
    }
    final rawOccurredAt = json['occurred_at'];
    if (rawOccurredAt == null) {
      throw const FormatException('occurred_at is required');
    }
    final occurredAtValue = rawOccurredAt.toString().trim();
    if (!_absoluteIsoTimestamp.hasMatch(occurredAtValue)) {
      throw const FormatException(
        'occurred_at must be an ISO-8601 timestamp with a UTC offset',
      );
    }
    final occurredAt = DateTime.tryParse(occurredAtValue);
    if (occurredAt == null) {
      throw const FormatException('occurred_at must be a valid timestamp');
    }

    final rawMetadata = json['metadata'];
    if (rawMetadata != null && rawMetadata is! Map) {
      throw const FormatException('metadata must be a JSON object');
    }

    return SuperBoardCustomerEvent(
      id: rawId,
      customerId: _optionalString(json['customer_id']),
      referrerCustomerId: _optionalString(json['referrer_customer_id']),
      type: json['type']?.toString() ?? '',
      platform: _optionalString(json['platform']),
      occurredAt: occurredAt,
      revenueCents: _optionalInteger(json['revenue_cents'], 'revenue_cents'),
      engagementTime: _optionalInteger(
        json['engagement_time'],
        'engagement_time',
      ),
      metadata: rawMetadata == null
          ? const {}
          : rawMetadata.cast<String, dynamic>(),
    );
  }

  Map<String, dynamic> toJson({String? defaultPlatform}) => {
    'id': id,
    if (customerId != null && customerId!.trim().isNotEmpty)
      'customer_id': customerId!.trim(),
    if (referrerCustomerId != null && referrerCustomerId!.trim().isNotEmpty)
      'referrer_customer_id': referrerCustomerId!.trim(),
    'type': type,
    if (_supportedEventPlatform(platform ?? defaultPlatform) case final value?)
      'platform': value,
    'occurred_at': occurredAt.toUtc().toIso8601String(),
    if (revenueCents != null) 'revenue_cents': revenueCents,
    if (engagementTime != null) 'engagement_time': engagementTime,
    if (metadata.isNotEmpty) 'metadata': metadata,
  };

  void _validate() {
    if (id.isEmpty || id.length > 128) {
      throw const FormatException('Event id must contain 1 to 128 characters');
    }
    if (!_customerEventTypes.contains(type)) {
      throw const FormatException(
        'type must be a supported SuperBoard customer event',
      );
    }
    for (final value in [customerId, referrerCustomerId]) {
      if (value != null && value.trim().length > 128) {
        throw const FormatException(
          'Customer identifiers must not exceed 128 characters',
        );
      }
    }
    final normalizedPlatform = platform?.trim().toLowerCase();
    if (normalizedPlatform != null &&
        normalizedPlatform.isNotEmpty &&
        !const {'ios', 'android', 'web'}.contains(normalizedPlatform)) {
      throw const FormatException('platform must be ios, android or web');
    }
    if (revenueCents != null && revenueCents! < 0) {
      throw const FormatException('revenue_cents must not be negative');
    }
    if (engagementTime != null && engagementTime! < 0) {
      throw const FormatException('engagement_time must not be negative');
    }
    try {
      jsonEncode(metadata);
    } catch (_) {
      throw const FormatException('metadata must be JSON serializable');
    }
  }
}

class SuperBoardCustomerEventsException implements Exception {
  const SuperBoardCustomerEventsException(
    this.message, {
    this.code = 'customer_events_request_failed',
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

/// Access-Key authenticated client for App customer analytics.
class SuperBoardCustomerEventsClient {
  SuperBoardCustomerEventsClient({
    required this.projectKey,
    required this.platform,
    required this.identifier,
    required this.baseUrl,
    this.environment = 'production',
    http.Client? httpClient,
  }) : _http = httpClient ?? http.Client(),
       _ownsHttp = httpClient == null {
    if (projectKey.trim().isEmpty || identifier.trim().isEmpty) {
      throw const FormatException('SuperBoard SDK credentials are required');
    }
    if (!const {
      'ios',
      'android',
      'web',
    }.contains(platform.trim().toLowerCase())) {
      throw const FormatException('platform must be ios, android or web');
    }
    if (!const {'production', 'test'}.contains(environment.trim())) {
      throw const FormatException('environment must be production or test');
    }
  }

  final String projectKey;
  final String platform;
  final String identifier;
  final String environment;
  final String baseUrl;
  final http.Client _http;
  final bool _ownsHttp;
  final LinkedHashSet<String> _completedIdempotencyKeys = LinkedHashSet();
  final Map<String, Future<int>> _pendingBatches = {};

  /// Records one event. A repeated successful event is suppressed locally.
  Future<bool> record(SuperBoardCustomerEvent event) async {
    final accepted = await recordBatch([event], idempotencyKey: event.id);
    return accepted > 0;
  }

  /// Records 1 to 100 events and returns the server's accepted count.
  ///
  /// Callers that persist batches should persist and pass [idempotencyKey]. If
  /// omitted, a deterministic key derived from the ordered event identifiers
  /// is used, so an immediate retry sends the exact same key and payload.
  Future<int> recordBatch(
    List<SuperBoardCustomerEvent> events, {
    String? idempotencyKey,
  }) async {
    if (events.isEmpty || events.length > 100) {
      throw const FormatException('events must contain 1 to 100 items');
    }
    final ids = events.map((event) => event.id).toList(growable: false);
    if (ids.toSet().length != ids.length) {
      throw const FormatException('Event ids must be unique within a batch');
    }
    final key = (idempotencyKey == null || idempotencyKey.trim().isEmpty)
        ? _batchIdempotencyKey(ids)
        : idempotencyKey.trim();
    if (key.length > 255) {
      throw const FormatException(
        'Idempotency key must not exceed 255 characters',
      );
    }
    if (_completedIdempotencyKeys.contains(key)) return 0;
    final pending = _pendingBatches[key];
    if (pending != null) return pending;

    final payload = jsonEncode({
      'events': events
          .map((event) => event.toJson(defaultPlatform: platform))
          .toList(growable: false),
    });
    final request = _sendBatch(key, payload, events.length);
    _pendingBatches[key] = request;
    try {
      return await request;
    } finally {
      _pendingBatches.remove(key);
    }
  }

  Future<int> _sendBatch(String key, String payload, int eventCount) async {
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        final response = await _http
            .post(
              _eventsUri,
              headers: {..._headers, 'Idempotency-Key': key},
              body: payload,
            )
            .timeout(const Duration(seconds: 10));
        final decoded = _decode(response);
        final data = decoded['data'];
        final accepted = data is Map
            ? (data['accepted'] as num?)?.toInt() ?? eventCount
            : eventCount;
        if (_completedIdempotencyKeys.length >= 2048) {
          _completedIdempotencyKeys.remove(_completedIdempotencyKeys.first);
        }
        _completedIdempotencyKeys.add(key);
        return accepted;
      } on SuperBoardCustomerEventsException catch (error) {
        if (!error.retryable || attempt == 1) rethrow;
      } catch (_) {
        if (attempt == 1) rethrow;
      }
    }
    return 0;
  }

  Uri get _eventsUri =>
      Uri.parse('${baseUrl.replaceFirst(RegExp(r'/+$'), '')}/app/events');

  Map<String, String> get _headers => {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'PROJECT-KEY': projectKey.trim(),
    'PLATFORM': platform.trim().toLowerCase(),
    'IDENTIFIER': identifier.trim(),
    'ENVIRONMENT': environment.trim(),
  };

  Map<String, dynamic> _decode(http.Response response) {
    Map<String, dynamic> body;
    try {
      final decoded = response.body.isEmpty
          ? <String, dynamic>{}
          : jsonDecode(response.body);
      body = decoded is Map ? decoded.cast<String, dynamic>() : {};
    } catch (_) {
      throw SuperBoardCustomerEventsException(
        'SuperBoard returned an invalid response',
        statusCode: response.statusCode,
        retryable: response.statusCode >= 500,
      );
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final error = body['error'] is Map
          ? (body['error'] as Map).cast<String, dynamic>()
          : const <String, dynamic>{};
      throw SuperBoardCustomerEventsException(
        error['message']?.toString() ?? 'Customer events request failed',
        code: error['code']?.toString() ?? 'customer_events_request_failed',
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

/// Process-wide client configured by [SuperBoardBootstrap].
abstract final class SuperBoardCustomerEventsSdk {
  static SuperBoardCustomerEventsClient? _client;

  static SuperBoardCustomerEventsClient get client {
    final value = _client;
    if (value == null) {
      throw const SuperBoardCustomerEventsException(
        'SuperBoardBootstrap must configure customer events first',
        code: 'customer_events_not_configured',
      );
    }
    return value;
  }

  static void configure(SuperBoardCustomerEventsClient value) {
    _client?.close();
    _client = value;
  }

  static void resetForTesting() {
    _client?.close();
    _client = null;
  }
}

/// FlutterFlow action for one typed customer analytics event.
Future<bool> superboardRecordCustomerEvent({
  required String type,
  String eventId = '',
  String customerId = '',
  String referrerCustomerId = '',
  String platform = '',
  DateTime? occurredAt,
  int? revenueCents,
  int? engagementTime,
  String metadataJson = '{}',
}) async {
  final metadata = _metadataFromJson(metadataJson);
  return SuperBoardCustomerEventsSdk.client.record(
    SuperBoardCustomerEvent(
      id: eventId,
      customerId: customerId.trim().isEmpty ? null : customerId,
      referrerCustomerId: referrerCustomerId.trim().isEmpty
          ? null
          : referrerCustomerId,
      type: type,
      platform: platform.trim().isEmpty ? null : platform,
      occurredAt: occurredAt,
      revenueCents: revenueCents,
      engagementTime: engagementTime,
      metadata: metadata,
    ),
  );
}

/// FlutterFlow action for an offline/outbox batch represented as a JSON list.
Future<int> superboardRecordCustomerEventsJson({
  required String eventsJson,
  String idempotencyKey = '',
}) async {
  final decoded = jsonDecode(eventsJson);
  if (decoded is! List) {
    throw const FormatException('Customer events must be a JSON list');
  }
  final events = decoded
      .map((value) {
        if (value is! Map) {
          throw const FormatException(
            'Each customer event must be a JSON object',
          );
        }
        return SuperBoardCustomerEvent.fromJson(value.cast<String, dynamic>());
      })
      .toList(growable: false);
  return SuperBoardCustomerEventsSdk.client.recordBatch(
    events,
    idempotencyKey: idempotencyKey.trim().isEmpty ? null : idempotencyKey,
  );
}

Map<String, dynamic> _metadataFromJson(String value) {
  final decoded = jsonDecode(value.trim().isEmpty ? '{}' : value);
  if (decoded is! Map) {
    throw const FormatException('metadata must be a JSON object');
  }
  return decoded.cast<String, dynamic>();
}

int? _optionalInteger(Object? value, String field) {
  if (value == null) return null;
  if (value is int) return value;
  if (value is num && value == value.roundToDouble()) return value.toInt();
  throw FormatException('$field must be an integer');
}

String? _optionalString(Object? value) {
  if (value == null) return null;
  final normalized = value.toString().trim();
  return normalized.isEmpty ? null : normalized;
}

String? _supportedEventPlatform(String? value) {
  final normalized = value?.trim().toLowerCase();
  return const {'ios', 'android', 'web'}.contains(normalized)
      ? normalized
      : null;
}

String _uniqueCustomerEventId() {
  final random = Random.secure().nextInt(0x7fffffff).toRadixString(36);
  return 'customer_event_${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}_$random';
}

String _batchIdempotencyKey(List<String> ids) {
  if (ids.length == 1) return ids.single;
  final source = ids.join('\u001f');
  var first = 0x811c9dc5;
  var second = 0x9e3779b9;
  for (final unit in source.codeUnits) {
    first = ((first ^ unit) * 0x01000193) & 0xffffffff;
    second = ((second ^ unit) * 0x85ebca6b) & 0xffffffff;
  }
  return 'customer-events-${ids.length}-${first.toRadixString(16).padLeft(8, '0')}${second.toRadixString(16).padLeft(8, '0')}';
}

final RegExp _absoluteIsoTimestamp = RegExp(
  r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$',
);

const Set<String> _customerEventTypes = {
  'view',
  'open',
  'install',
  'reinstall',
  'reactivation',
  'app_open',
  'user_referred',
  'time_spent',
  'purchase',
  'refund',
};
