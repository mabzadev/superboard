import 'dart:async';
import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

abstract interface class OpenGrowPurchaseStorage {
  Future<String?> read({required String key});

  Future<void> write({required String key, required String? value});

  Future<void> delete({required String key});
}

class FlutterOpenGrowPurchaseStorage implements OpenGrowPurchaseStorage {
  const FlutterOpenGrowPurchaseStorage([
    this._storage = const FlutterSecureStorage(),
  ]);

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read({required String key}) => _storage.read(key: key);

  @override
  Future<void> write({required String key, required String? value}) =>
      _storage.write(key: key, value: value);

  @override
  Future<void> delete({required String key}) => _storage.delete(key: key);
}

class OpenGrowPurchaseOutboxEntry {
  const OpenGrowPurchaseOutboxEntry({
    required this.id,
    required this.store,
    required this.productId,
    required this.productType,
    required this.verificationData,
    required this.restoring,
    required this.createdAt,
    this.transactionId,
    this.attempts = 0,
    this.nextAttemptAt,
    this.serverValidated = false,
  });

  final String id;
  final String store;
  final String productId;
  final String productType;
  final String verificationData;
  final bool restoring;
  final String? transactionId;
  final DateTime createdAt;
  final int attempts;
  final DateTime? nextAttemptAt;
  final bool serverValidated;

  String get fingerprint => '$store\u0000$productId\u0000$verificationData';

  OpenGrowPurchaseOutboxEntry copyWith({
    int? attempts,
    DateTime? nextAttemptAt,
    bool? serverValidated,
    String? transactionId,
  }) => OpenGrowPurchaseOutboxEntry(
    id: id,
    store: store,
    productId: productId,
    productType: productType,
    verificationData: verificationData,
    restoring: restoring,
    transactionId: transactionId ?? this.transactionId,
    createdAt: createdAt,
    attempts: attempts ?? this.attempts,
    nextAttemptAt: nextAttemptAt ?? this.nextAttemptAt,
    serverValidated: serverValidated ?? this.serverValidated,
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'store': store,
    'product_id': productId,
    'product_type': productType,
    'verification_data': verificationData,
    'restoring': restoring,
    'transaction_id': transactionId,
    'created_at': createdAt.toUtc().toIso8601String(),
    'attempts': attempts,
    'next_attempt_at': nextAttemptAt?.toUtc().toIso8601String(),
    'server_validated': serverValidated,
  };

  factory OpenGrowPurchaseOutboxEntry.fromJson(Map<String, dynamic> json) =>
      OpenGrowPurchaseOutboxEntry(
        id: json['id'].toString(),
        store: json['store'].toString(),
        productId: json['product_id'].toString(),
        productType: json['product_type'].toString(),
        verificationData: json['verification_data'].toString(),
        restoring: json['restoring'] == true,
        transactionId: json['transaction_id']?.toString(),
        createdAt: DateTime.parse(json['created_at'].toString()),
        attempts: (json['attempts'] as num?)?.toInt() ?? 0,
        nextAttemptAt: DateTime.tryParse(
          json['next_attempt_at']?.toString() ?? '',
        ),
        serverValidated: json['server_validated'] == true,
      );

  static OpenGrowPurchaseOutboxEntry create({
    required String store,
    required String productId,
    required String productType,
    required String verificationData,
    required bool restoring,
    String? transactionId,
  }) => OpenGrowPurchaseOutboxEntry(
    id: const Uuid().v4(),
    store: store,
    productId: productId,
    productType: productType,
    verificationData: verificationData,
    restoring: restoring,
    transactionId: transactionId,
    createdAt: DateTime.now().toUtc(),
  );
}

class OpenGrowPurchaseOutbox {
  OpenGrowPurchaseOutbox(this._storage);

  static const _storageKey = 'opengrow.purchases.outbox.v1';
  final OpenGrowPurchaseStorage _storage;
  Future<void> _tail = Future.value();

  Future<List<OpenGrowPurchaseOutboxEntry>> readAll() => _locked(_readUnlocked);

  Future<OpenGrowPurchaseOutboxEntry> upsert(
    OpenGrowPurchaseOutboxEntry entry,
  ) => _locked(() async {
    final entries = await _readUnlocked();
    final index = entries.indexWhere(
      (value) => value.id == entry.id || value.fingerprint == entry.fingerprint,
    );
    final stored = index < 0
        ? entry
        : entry.id == entries[index].id
        ? entry
        : entries[index];
    if (index < 0) {
      entries.add(stored);
    } else {
      entries[index] = stored;
    }
    await _writeUnlocked(entries);
    return stored;
  });

  Future<void> remove(String id) => _locked(() async {
    final entries = await _readUnlocked();
    entries.removeWhere((entry) => entry.id == id);
    await _writeUnlocked(entries);
  });

  Future<T> _locked<T>(Future<T> Function() operation) async {
    final previous = _tail;
    final gate = Completer<void>();
    _tail = gate.future;
    await previous;
    try {
      return await operation();
    } finally {
      gate.complete();
    }
  }

  Future<List<OpenGrowPurchaseOutboxEntry>> _readUnlocked() async {
    final serialized = await _storage.read(key: _storageKey);
    if (serialized == null || serialized.isEmpty) return [];
    try {
      final decoded = jsonDecode(serialized);
      if (decoded is! List) return [];
      return decoded
          .whereType<Map>()
          .map(
            (value) => OpenGrowPurchaseOutboxEntry.fromJson(
              value.cast<String, dynamic>(),
            ),
          )
          .toList();
    } catch (_) {
      return [];
    }
  }

  Future<void> _writeUnlocked(List<OpenGrowPurchaseOutboxEntry> entries) =>
      _storage.write(
        key: _storageKey,
        value: jsonEncode(entries.map((entry) => entry.toJson()).toList()),
      );
}
