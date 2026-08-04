import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:opengrow_flutter/models/opengrow_purchases.dart';
import 'package:opengrow_flutter/opengrow_purchases.dart';
import 'package:opengrow_flutter/src/customer_info_verifier.dart';
import 'package:opengrow_flutter/src/purchase_outbox.dart';
import 'package:opengrow_flutter/src/purchase_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    SharedPreferences.setMockInitialValues({});
  });

  tearDown(() {
    debugDefaultTargetPlatformOverride = null;
  });

  test(
    'completes the store transaction only after durable server validation',
    () async {
      final events = <String>[];
      final store = FakePurchaseStore(events);
      final storage = MemoryPurchaseStorage(events);
      final purchases = testPurchases(store, storage, (request) async {
        if (request.url.path.endsWith('/receipts')) {
          events.add('server.validated');
          return jsonResponse(verifiedPurchaseResponse());
        }
        return jsonResponse(customerInfo());
      });
      addTearDown(() async {
        await purchases.disposeForTesting();
        await store.close();
      });
      await configure(purchases);
      events.clear();

      final resultFuture = purchases.purchaseResultStream.firstWhere(
        (result) => result.code == 'purchase_verified',
      );
      store.emit(purchased());
      final result = await resultFuture;

      expect(result.outcome, OpenGrowPurchaseOutcome.purchased);
      expect(store.completed, hasLength(1));
      expect(
        events.indexOf('outbox.persisted'),
        lessThan(events.indexOf('server.validated')),
      );
      expect(
        events.indexOf('server.validated'),
        lessThan(events.indexOf('customer_info.persisted')),
      );
      expect(
        events.indexOf('customer_info.persisted'),
        lessThan(events.indexOf('store.completed')),
      );
      expect(storage.outboxEntries, isEmpty);
    },
  );

  test(
    'keeps an unfinished purchase in the encrypted outbox across a network failure',
    () async {
      var receiptAttempts = 0;
      final store = FakePurchaseStore([]);
      final storage = MemoryPurchaseStorage([]);
      final purchases = testPurchases(store, storage, (request) async {
        if (request.url.path.endsWith('/receipts')) {
          receiptAttempts += 1;
          if (receiptAttempts == 1) {
            return jsonResponse({
              'error': {
                'code': 'billing_temporarily_unavailable',
                'message': 'Billing is temporarily unavailable',
                'retryable': true,
              },
            }, 503);
          }
          return jsonResponse(verifiedPurchaseResponse());
        }
        return jsonResponse(customerInfo());
      });
      addTearDown(() async {
        await purchases.disposeForTesting();
        await store.close();
      });
      await configure(purchases);

      final failedFuture = purchases.purchaseResultStream.firstWhere(
        (result) => result.code == 'billing_temporarily_unavailable',
      );
      store.emit(purchased());
      final failed = await failedFuture;
      expect(failed.retryable, isTrue);
      expect(store.completed, isEmpty);
      expect(storage.outboxEntries, hasLength(1));

      final recoveredFuture = purchases.purchaseResultStream.firstWhere(
        (result) => result.code == 'purchase_verified',
      );
      store.emit(purchased());
      final recovered = await recoveredFuture;
      expect(recovered.outcome, OpenGrowPurchaseOutcome.purchased);
      expect(receiptAttempts, 2);
      expect(store.completed, hasLength(1));
      expect(storage.outboxEntries, isEmpty);
    },
  );

  test(
    'rejects an oversized server response without completing the Store transaction',
    () async {
      final store = FakePurchaseStore([]);
      final storage = MemoryPurchaseStorage([]);
      final purchases = testPurchases(store, storage, (request) async {
        if (request.url.path.endsWith('/receipts')) {
          return http.Response(List.filled(1024 * 1024 + 1, 'x').join(), 200);
        }
        return jsonResponse(customerInfo());
      });
      addTearDown(() async {
        await purchases.disposeForTesting();
        await store.close();
      });
      await configure(purchases);

      final failedFuture = purchases.purchaseResultStream.firstWhere(
        (result) => result.code == 'server_response_too_large',
      );
      store.emit(purchased());
      expect((await failedFuture).outcome, OpenGrowPurchaseOutcome.failed);
      expect(store.completed, isEmpty);
      expect(storage.outboxEntries, hasLength(1));
    },
  );

  test(
    'does not complete a pending purchase and publishes its terminal resolution',
    () async {
      var receiptAttempts = 0;
      final store = FakePurchaseStore([]);
      final storage = MemoryPurchaseStorage([]);
      final purchases = testPurchases(store, storage, (request) async {
        if (request.url.path.endsWith('/receipts')) {
          receiptAttempts += 1;
          if (receiptAttempts == 1) {
            return jsonResponse({
              'status': 'pending',
              'transaction_id': 'transaction-1',
            });
          }
          return jsonResponse(verifiedPurchaseResponse());
        }
        return jsonResponse(customerInfo());
      });
      addTearDown(() async {
        await purchases.disposeForTesting();
        await store.close();
      });
      await configure(purchases);

      final pendingFuture = purchases.purchaseResultStream.firstWhere(
        (result) => result.outcome == OpenGrowPurchaseOutcome.pending,
      );
      store.emit(purchased());
      expect((await pendingFuture).code, 'purchase_pending');
      expect(store.completed, isEmpty);
      expect(storage.outboxEntries, hasLength(1));

      final resolvedFuture = purchases.purchaseResultStream.firstWhere(
        (result) => result.code == 'purchase_verified',
      );
      store.emit(purchased());
      expect((await resolvedFuture).outcome, OpenGrowPurchaseOutcome.purchased);
      expect(store.completed, hasLength(1));
      expect(storage.outboxEntries, isEmpty);
    },
  );

  test(
    'retries Store completion after server validation without validating twice',
    () async {
      var receiptAttempts = 0;
      final store = FakePurchaseStore([])..completeFailuresRemaining = 1;
      final storage = MemoryPurchaseStorage([]);
      final purchases = testPurchases(store, storage, (request) async {
        if (request.url.path.endsWith('/receipts')) {
          receiptAttempts += 1;
          return jsonResponse(verifiedPurchaseResponse());
        }
        return jsonResponse(customerInfo());
      });
      addTearDown(() async {
        await purchases.disposeForTesting();
        await store.close();
      });
      await configure(purchases);

      final failedFuture = purchases.purchaseResultStream.firstWhere(
        (result) => result.code == 'purchases_failed',
      );
      store.emit(purchased());
      expect((await failedFuture).retryable, isTrue);
      expect(storage.outboxEntries.single['server_validated'], isTrue);
      expect(store.completed, isEmpty);

      final recoveredFuture = purchases.purchaseResultStream.firstWhere(
        (result) => result.code == 'purchase_verified',
      );
      await purchases.resumeOutboxForTesting();
      expect(
        (await recoveredFuture).outcome,
        OpenGrowPurchaseOutcome.purchased,
      );
      expect(receiptAttempts, 1);
      expect(store.completed, hasLength(1));
      expect(storage.outboxEntries, isEmpty);
    },
  );

  test(
    'resumes server validation after restart before completing the replayed store purchase',
    () async {
      var online = false;
      var validationAttempts = 0;
      final events = <String>[];
      final store = FakePurchaseStore(events);
      final storage = MemoryPurchaseStorage(events);

      OpenGrowPurchases createPurchases() =>
          testPurchases(store, storage, (request) async {
            if (request.url.path.endsWith('/receipts')) {
              validationAttempts += 1;
              if (!online) {
                return jsonResponse({
                  'error': {
                    'code': 'network_unavailable',
                    'message': 'Network unavailable',
                    'retryable': true,
                  },
                }, 503);
              }
              events.add('server.validated.after_restart');
              return jsonResponse(verifiedPurchaseResponse());
            }
            return jsonResponse(customerInfo());
          });

      final first = createPurchases();
      await configure(first);
      final failedFuture = first.purchaseResultStream.firstWhere(
        (result) => result.code == 'network_unavailable',
      );
      store.emit(purchased());
      await failedFuture;
      expect(storage.outboxEntries, hasLength(1));
      await first.disposeForTesting();

      storage.makeOutboxRetriesDue();
      online = true;
      final second = createPurchases();
      addTearDown(() async {
        await second.disposeForTesting();
        await store.close();
      });
      final serverRecovery = second.purchaseResultStream.firstWhere(
        (result) => result.code == 'purchase_verified_waiting_store_completion',
      );
      await configure(second);
      await serverRecovery;
      expect(store.completed, isEmpty);

      final terminal = second.purchaseResultStream.firstWhere(
        (result) => result.code == 'purchase_verified',
      );
      store.emit(purchased());
      await terminal;
      expect(validationAttempts, 2);
      expect(store.completed, hasLength(1));
      expect(
        events.indexOf('server.validated.after_restart'),
        lessThan(events.indexOf('store.completed')),
      );
      expect(storage.outboxEntries, isEmpty);
    },
  );

  test(
    'refuses to open the store when authenticated identity preflight fails',
    () async {
      var identityAvailable = true;
      final store = FakePurchaseStore([]);
      final purchases = testPurchases(store, MemoryPurchaseStorage([]), (
        request,
      ) async {
        if (request.url.path.endsWith('/customer-info')) {
          if (!identityAvailable) {
            return jsonResponse({
              'error': {
                'code': 'invalid_identity',
                'message': 'Identity is invalid',
                'retryable': false,
                'request_id': 'request-identity-1',
              },
            }, 401);
          }
          return jsonResponse(customerInfo());
        }
        return jsonResponse(customerInfo());
      });
      addTearDown(() async {
        await purchases.disposeForTesting();
        await store.close();
      });
      await configure(purchases);
      identityAvailable = false;

      final result = await purchases.purchasePackage(
        const OpenGrowPackage(
          identifier: 'weekly',
          packageType: 'weekly',
          product: OpenGrowStoreProduct(
            identifier: 'premium-weekly',
            type: 'subscription',
          ),
        ),
      );
      expect(result.outcome, OpenGrowPurchaseOutcome.failed);
      expect(result.code, 'identity_sync_failed');
      expect(result.requestId, 'request-identity-1');
      expect(store.productQueryCount, 0);
      expect(store.purchaseStartCount, 0);
    },
  );

  test(
    'submits challenge-bound certification evidence with build context',
    () async {
      http.Request? certificationRequest;
      final store = FakePurchaseStore([]);
      final purchases = testPurchases(store, MemoryPurchaseStorage([]), (
        request,
      ) async {
        if (request.url.path.endsWith('/certification/device-results')) {
          certificationRequest = request;
          return jsonResponse({
            'data': {
              'id': 'device-result-104',
              'run_id': 'run-device-1',
              'check_key': 'cross_platform.identity_sync',
              'outcome': 'passed',
              'evidence_sha256': List.filled(64, 'a').join(),
              'observed_at': '2026-08-04T12:00:00.000Z',
              'received_at': '2026-08-04T12:00:01.000Z',
              'duplicate': false,
            },
          }, 201);
        }
        return jsonResponse(customerInfo());
      });
      addTearDown(() async {
        await purchases.disposeForTesting();
        await store.close();
      });
      await configure(purchases);

      final result = await purchases.submitCertificationResult(
        runId: 'run-device-1',
        challenge: 'device-challenge',
        checkKey: 'cross_platform.identity_sync',
        passed: true,
        deviceModel: 'Pixel 10',
        osVersion: 'Android 17',
        assertions: const {
          'authenticated_identity_verified': true,
          'purchase_blocked_without_identity': true,
        },
        resultId: 'device-result-104',
        observedAt: DateTime.parse('2026-08-04T12:00:00.000Z'),
      );

      expect(result.id, 'device-result-104');
      expect(result.duplicate, isFalse);
      expect(certificationRequest?.headers['x-opengrow-build-number'], '104');
      expect(certificationRequest?.headers['x-opengrow-app-version'], '1.4.0');
      final body =
          jsonDecode(certificationRequest!.body) as Map<String, dynamic>;
      expect(body, containsPair('challenge', 'device-challenge'));
      expect(
        body['assertions'],
        containsPair('purchase_blocked_without_identity', true),
      );
    },
  );
}

OpenGrowPurchases testPurchases(
  FakePurchaseStore store,
  MemoryPurchaseStorage storage,
  Future<http.Response> Function(http.Request request) handler,
) => OpenGrowPurchases.forTesting(
  purchaseStore: store,
  secureStorage: storage,
  customerInfoVerifier: AcceptingCustomerInfoVerifier(),
  httpClientFactory: () => MockClient(handler),
);

Future<void> configure(OpenGrowPurchases purchases) => purchases.configure(
  projectKey: 'project-key',
  platformIdentifier: 'com.example.app',
  baseUrl: 'https://sdk.example.com/purchases/v2',
  identityToken: 'identity-token',
  appVersion: '1.4.0',
  buildNumber: '104',
  sdkVersion: '2.1.3',
);

Map<String, dynamic> customerInfo() => {
  'signature': 'test-signature',
  'original_app_user_id': 'user-1',
  'customer_id': 'customer-1',
  'request_date': DateTime.now().toUtc().toIso8601String(),
  'entitlements': {
    'premium': {
      'identifier': 'premium',
      'is_active': true,
      'status': 'active',
      'expires_at': DateTime.now()
          .toUtc()
          .add(const Duration(days: 7))
          .toIso8601String(),
    },
  },
};

Map<String, dynamic> verifiedPurchaseResponse() => {
  'status': 'active',
  'transaction_id': 'transaction-1',
  'customer_info': customerInfo(),
};

http.Response jsonResponse(Map<String, dynamic> value, [int status = 200]) =>
    http.Response(
      jsonEncode(value),
      status,
      headers: {'content-type': 'application/json'},
    );

PurchaseDetails purchased() {
  final value = PurchaseDetails(
    purchaseID: 'store-transaction-1',
    productID: 'premium-weekly',
    verificationData: PurchaseVerificationData(
      localVerificationData: 'local',
      serverVerificationData: 'purchase-token-1',
      source: 'google_play',
    ),
    transactionDate: DateTime.now().millisecondsSinceEpoch.toString(),
    status: PurchaseStatus.purchased,
  );
  value.pendingCompletePurchase = true;
  return value;
}

class AcceptingCustomerInfoVerifier extends OpenGrowCustomerInfoVerifier {
  @override
  Future<Map<String, dynamic>> verify({
    required Map<String, dynamic> envelope,
    required String purchasesBaseUrl,
    required SharedPreferences preferences,
    bool allowExpiredSignatureForOfflineEntitlements = false,
  }) async => envelope;
}

class MemoryPurchaseStorage implements OpenGrowPurchaseStorage {
  MemoryPurchaseStorage(this.events);

  final List<String> events;
  final values = <String, String>{};

  @override
  Future<void> delete({required String key}) async {
    values.remove(key);
  }

  @override
  Future<String?> read({required String key}) async => values[key];

  @override
  Future<void> write({required String key, required String? value}) async {
    if (value == null) {
      values.remove(key);
    } else {
      values[key] = value;
    }
    events.add(
      key == 'opengrow.purchases.outbox.v1'
          ? 'outbox.persisted'
          : 'customer_info.persisted',
    );
  }

  List<dynamic> get outboxEntries =>
      jsonDecode(values['opengrow.purchases.outbox.v1'] ?? '[]')
          as List<dynamic>;

  void makeOutboxRetriesDue() {
    final entries = outboxEntries.cast<Map<String, dynamic>>();
    for (final entry in entries) {
      entry['next_attempt_at'] = DateTime.now()
          .toUtc()
          .subtract(const Duration(minutes: 1))
          .toIso8601String();
    }
    values['opengrow.purchases.outbox.v1'] = jsonEncode(entries);
  }
}

class FakePurchaseStore implements OpenGrowPurchaseStore {
  FakePurchaseStore(this.events);

  final List<String> events;
  final controller = StreamController<List<PurchaseDetails>>.broadcast();
  final completed = <PurchaseDetails>[];
  int productQueryCount = 0;
  int purchaseStartCount = 0;
  int completeFailuresRemaining = 0;

  void emit(PurchaseDetails purchase) => controller.add([purchase]);

  Future<void> close() => controller.close();

  @override
  Stream<List<PurchaseDetails>> get purchaseStream => controller.stream;

  @override
  Future<bool> isAvailable() async => true;

  @override
  Future<ProductDetailsResponse> queryProductDetails(
    Set<String> identifiers,
  ) async {
    productQueryCount += 1;
    return ProductDetailsResponse(
      productDetails: const [],
      notFoundIDs: identifiers.toList(),
    );
  }

  @override
  Future<bool> buyNonConsumable({required PurchaseParam purchaseParam}) async {
    purchaseStartCount += 1;
    return true;
  }

  @override
  Future<bool> buyConsumable({
    required PurchaseParam purchaseParam,
    bool autoConsume = true,
  }) async {
    purchaseStartCount += 1;
    return true;
  }

  @override
  Future<void> completePurchase(PurchaseDetails purchase) async {
    if (completeFailuresRemaining > 0) {
      completeFailuresRemaining -= 1;
      throw StateError('Store completion failed');
    }
    events.add('store.completed');
    completed.add(purchase);
  }

  @override
  Future<void> restorePurchases({String? applicationUserName}) async {}
}
