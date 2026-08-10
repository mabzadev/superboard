import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import 'models/superboard_purchases.dart';
import 'src/customer_info_verifier.dart';
import 'src/purchase_outbox.dart';
import 'src/purchase_store.dart';

typedef SuperBoardIdentityTokenProvider = Future<String?> Function();

class SuperBoardPurchasesException implements Exception {
  const SuperBoardPurchasesException(
    this.message, {
    this.code = 'purchases_failed',
    this.retryable = false,
    this.requestId,
  });
  final String message;
  final String code;
  final bool retryable;
  final String? requestId;
  @override
  String toString() => 'SuperBoardPurchasesException: $message';
}

class SuperBoardPurchases {
  static const _requestTimeout = Duration(seconds: 20);
  static const _maximumResponseBytes = 1024 * 1024;

  SuperBoardPurchases._({
    SuperBoardPurchaseStore? purchaseStore,
    SuperBoardPurchaseStorage? secureStorage,
    SuperBoardCustomerInfoVerifier? customerInfoVerifier,
    http.Client Function()? httpClientFactory,
  }) : _iap = purchaseStore ?? FlutterSuperBoardPurchaseStore(),
       _secureStorage =
           secureStorage ?? const FlutterSuperBoardPurchaseStorage(),
       _customerInfoVerifier =
           customerInfoVerifier ?? SuperBoardCustomerInfoVerifier(),
       _httpClientFactory = httpClientFactory ?? http.Client.new {
    _outbox = SuperBoardPurchaseOutbox(_secureStorage);
  }

  @visibleForTesting
  factory SuperBoardPurchases.forTesting({
    required SuperBoardPurchaseStore purchaseStore,
    required SuperBoardPurchaseStorage secureStorage,
    required SuperBoardCustomerInfoVerifier customerInfoVerifier,
    required http.Client Function() httpClientFactory,
  }) => SuperBoardPurchases._(
    purchaseStore: purchaseStore,
    secureStorage: secureStorage,
    customerInfoVerifier: customerInfoVerifier,
    httpClientFactory: httpClientFactory,
  );

  static final instance = SuperBoardPurchases._();

  final SuperBoardPurchaseStore _iap;
  final SuperBoardPurchaseStorage _secureStorage;
  final SuperBoardCustomerInfoVerifier _customerInfoVerifier;
  final http.Client Function() _httpClientFactory;
  late final SuperBoardPurchaseOutbox _outbox;
  final _customerInfoController =
      StreamController<SuperBoardCustomerInfo>.broadcast();
  final _purchaseCompleters = <String, Completer<SuperBoardPurchaseResult>>{};
  final _pendingStoreCompletions = <String, PurchaseDetails>{};
  final _bufferedPurchaseBatches = <List<PurchaseDetails>>[];
  final _purchaseResultController =
      StreamController<SuperBoardPurchaseResult>.broadcast();
  final _products = <String, ProductDetails>{};
  Completer<SuperBoardCustomerInfo>? _restoreCompleter;
  Timer? _restoreTimer;
  Timer? _outboxRetryTimer;
  bool _retryingOutbox = false;
  bool _configurationReady = false;
  Future<void> _purchaseHandlingTail = Future<void>.value();
  StreamSubscription<List<PurchaseDetails>>? _subscription;
  SharedPreferences? _preferences;
  SuperBoardIdentityTokenProvider? _tokenProvider;
  String? _identityToken;
  DateTime? _identityTokenExpiresAt;
  Future<String?>? _identityTokenRefresh;
  String? _projectKey;
  String? _platformIdentifier;
  String _baseUrl = '';
  String _appVersion = '';
  String _buildNumber = '';
  String _sdkVersion = '3.0.0';
  String _storefront = '';
  String _campaign = '';
  String? _anonymousId;
  String? _customerId;
  SuperBoardCustomerInfo? _lastCustomerInfo;

  Stream<SuperBoardCustomerInfo> get customerInfoStream =>
      _customerInfoController.stream;
  Stream<SuperBoardPurchaseResult> get purchaseResultStream =>
      _purchaseResultController.stream;
  SuperBoardCustomerInfo? get cachedCustomerInfo => _lastCustomerInfo;

  Future<SuperBoardCustomerInfo> configure({
    required String projectKey,
    required String platformIdentifier,
    required String baseUrl,
    String? identityToken,
    SuperBoardIdentityTokenProvider? identityTokenProvider,
    String appVersion = '',
    String buildNumber = '',
    String sdkVersion = '3.0.0',
    String storefront = '',
    String campaign = '',
  }) async {
    if (kIsWeb ||
        (defaultTargetPlatform != TargetPlatform.iOS &&
            defaultTargetPlatform != TargetPlatform.android)) {
      throw const SuperBoardPurchasesException(
        'SuperBoard Purchases supports iOS and Android only',
      );
    }
    _configurationReady = false;
    _subscription ??= _iap.purchaseStream.listen(
      _receivePurchaseBatch,
      onError: _handlePurchaseStreamError,
    );
    _projectKey = projectKey;
    _platformIdentifier = platformIdentifier;
    final parsedBaseUrl = Uri.tryParse(baseUrl);
    if (parsedBaseUrl == null ||
        !parsedBaseUrl.hasScheme ||
        !const {'http', 'https'}.contains(parsedBaseUrl.scheme)) {
      throw const SuperBoardPurchasesException(
        'A valid SuperBoard Purchases base URL is required',
        code: 'base_url_invalid',
      );
    }
    _baseUrl = baseUrl.replaceFirst(RegExp(r'/+$'), '');
    _setIdentityToken(identityToken);
    _tokenProvider = identityTokenProvider;
    _appVersion = appVersion;
    _buildNumber = buildNumber;
    _sdkVersion = sdkVersion;
    _storefront = storefront;
    _campaign = campaign;
    _preferences = await SharedPreferences.getInstance();
    _anonymousId = _preferences!.getString('opengrow.purchases.anonymous_id');
    if (_anonymousId == null) {
      _anonymousId = r'$opengrow_anon_' + const Uuid().v4();
      await _preferences!.setString(
        'opengrow.purchases.anonymous_id',
        _anonymousId!,
      );
    }
    final cached = await _secureStorage.read(
      key: 'opengrow.purchases.customer_info.verified',
    );
    if (cached != null) {
      try {
        final envelope = (jsonDecode(cached) as Map).cast<String, dynamic>();
        final verified = await _customerInfoVerifier.verify(
          envelope: envelope,
          purchasesBaseUrl: _baseUrl,
          preferences: _preferences!,
          allowExpiredSignatureForOfflineEntitlements: true,
        );
        final info = SuperBoardCustomerInfo.fromJson(verified);
        _lastCustomerInfo = info;
        _customerId = info.customerId;
      } catch (_) {
        await _secureStorage.delete(
          key: 'opengrow.purchases.customer_info.verified',
        );
      }
    }
    if (!await _iap.isAvailable()) {
      throw const SuperBoardPurchasesException(
        'The platform store is unavailable',
      );
    }
    _configurationReady = true;
    _drainBufferedPurchaseBatches();
    unawaited(_enqueueOutboxResume());
    return getCustomerInfo();
  }

  Future<void> setIdentityToken(String? token) async =>
      _setIdentityToken(token);

  /// Records an authenticated, challenge-bound result for a live purchase
  /// certification run. The server accepts only a verified application
  /// identity and stores the structured result as immutable evidence.
  Future<SuperBoardCertificationResult> submitCertificationResult({
    required String runId,
    required String challenge,
    required String checkKey,
    required bool passed,
    required String deviceModel,
    required String osVersion,
    required Map<String, dynamic> assertions,
    String? resultId,
    DateTime? observedAt,
  }) async {
    final stableResultId = resultId?.trim().isNotEmpty == true
        ? resultId!.trim()
        : const Uuid().v5(
            Namespace.url.value,
            [
              'opengrow-certification-v1',
              runId.trim(),
              checkKey.trim(),
              passed ? 'passed' : 'failed',
              _buildNumber,
              _platformIdentifier ?? '',
              deviceModel.trim(),
              osVersion.trim(),
            ].join('|'),
          );
    final response = await _request(
      'POST',
      '/certification/device-results',
      body: {
        'id': stableResultId,
        'run_id': runId,
        'challenge': challenge,
        'check_key': checkKey,
        'outcome': passed ? 'passed' : 'failed',
        'build_number': _buildNumber,
        'device_model': deviceModel,
        'os_version': osVersion,
        'assertions': assertions,
        'observed_at': (observedAt ?? DateTime.now().toUtc()).toIso8601String(),
      },
    );
    final data = (response['data'] as Map?)?.cast<String, dynamic>();
    if (data == null) {
      throw const SuperBoardPurchasesException(
        'Certification server returned an invalid device result',
        code: 'device_certification_response_invalid',
      );
    }
    return SuperBoardCertificationResult.fromJson(data);
  }

  Future<SuperBoardCustomerInfo> logIn(String identityToken) async {
    _setIdentityToken(identityToken);
    final response = await _request(
      'POST',
      '/identify',
      body: {'current_app_user_id': _anonymousId},
    );
    return _storeCustomerInfo(response);
  }

  Future<SuperBoardCustomerInfo> logOut() async {
    _setIdentityToken(null);
    _tokenProvider = null;
    _anonymousId = r'$opengrow_anon_' + const Uuid().v4();
    await _preferences?.setString(
      'opengrow.purchases.anonymous_id',
      _anonymousId!,
    );
    _customerId = null;
    return getCustomerInfo();
  }

  Future<SuperBoardOfferings> getOfferings({
    String placement = 'default',
  }) async {
    final response = await _request(
      'GET',
      '/offerings?placement=${Uri.encodeQueryComponent(placement)}',
    );
    return _offeringsFromResponse(response);
  }

  Future<SuperBoardOfferings> _offeringsFromResponse(
    Map<String, dynamic> response,
  ) async {
    _customerId = response['customer_id']?.toString() ?? _customerId;
    final allJson =
        (response['all'] as Map?)?.cast<String, dynamic>() ?? const {};
    final offerings = <String, SuperBoardOffering>{};
    final productIds = <String>{};
    for (final entry in allJson.entries) {
      final value = (entry.value as Map).cast<String, dynamic>();
      final packageList = <SuperBoardPackage>[];
      for (final raw in (value['packages'] as List? ?? const [])) {
        final package = (raw as Map).cast<String, dynamic>();
        final product = (package['product'] as Map).cast<String, dynamic>();
        final id = product['store_product_id'].toString();
        productIds.add(id);
        packageList.add(
          SuperBoardPackage(
            identifier: package['identifier'].toString(),
            packageType: (package['package_type'] ?? 'custom').toString(),
            product: SuperBoardStoreProduct(
              identifier: id,
              type: product['product_type'].toString(),
            ),
          ),
        );
      }
      offerings[entry.key] = SuperBoardOffering(
        identifier: entry.key,
        displayName: value['display_name']?.toString(),
        description: value['description']?.toString(),
        packages: packageList,
      );
    }
    if (productIds.isNotEmpty) {
      final query = await _iap.queryProductDetails(productIds);
      for (final product in query.productDetails) {
        _products[product.id] = product;
      }
      for (final offering in offerings.values) {
        for (final package in offering.packages) {
          _lastOfferProductTypes[package.product.identifier] =
              package.product.type;
        }
      }
      for (final entry in offerings.entries.toList()) {
        offerings[entry.key] = SuperBoardOffering(
          identifier: entry.value.identifier,
          displayName: entry.value.displayName,
          description: entry.value.description,
          packages: entry.value.packages.map((package) {
            final detail = _products[package.product.identifier];
            return SuperBoardPackage(
              identifier: package.identifier,
              packageType: package.packageType,
              product: detail == null
                  ? package.product
                  : package.product.copyWithPrice(
                      title: detail.title,
                      description: detail.description,
                      localizedPrice: detail.price,
                      currencyCode: detail.currencyCode,
                      rawPrice: detail.rawPrice,
                    ),
            );
          }).toList(),
        );
      }
    }
    final currentJson = response['current'] as Map?;
    final currentId = currentJson?['identifier']?.toString();
    return SuperBoardOfferings(
      all: offerings,
      current: currentId == null ? null : offerings[currentId],
    );
  }

  /// Fetches the offering, published remote paywall, targeting result and
  /// deterministic experiment assignment for a placement.
  ///
  /// The last successful response is cached per placement and returned during
  /// transient network failures so the application can still monetize offline.
  Future<SuperBoardPurchaseConfiguration> getPurchaseConfiguration({
    String placement = 'default',
  }) async {
    final cacheKey = 'opengrow.purchases.configuration.$placement';
    try {
      final response = await _request(
        'GET',
        '/configuration?placement=${Uri.encodeQueryComponent(placement)}',
      );
      await _preferences?.setString(cacheKey, jsonEncode(response));
      return _purchaseConfigurationFromJson(response);
    } catch (_) {
      final cached = _preferences?.getString(cacheKey);
      if (cached == null) rethrow;
      final decoded = (jsonDecode(cached) as Map).cast<String, dynamic>();
      return _purchaseConfigurationFromJson(decoded, fromCache: true);
    }
  }

  Future<SuperBoardPurchaseConfiguration> _purchaseConfigurationFromJson(
    Map<String, dynamic> json, {
    bool fromCache = false,
  }) async {
    final rawAll =
        (json['offerings'] as Map?)?.cast<String, dynamic>() ?? const {};
    final selected = (json['offering'] as Map?)?.cast<String, dynamic>();
    final selectedIdentifier = selected?['identifier']?.toString();
    final offerings = await _offeringsFromResponse({
      'all': rawAll,
      'current': selected,
      'customer_id': json['customer_id'],
    });
    final placement = SuperBoardPlacement.fromJson(
      (json['placement'] as Map?)?.cast<String, dynamic>() ??
          {'identifier': 'default', 'display_name': 'Default'},
    );
    final paywallJson = (json['paywall'] as Map?)?.cast<String, dynamic>();
    final assignmentJson = (json['experiment_assignment'] as Map?)
        ?.cast<String, dynamic>();
    return SuperBoardPurchaseConfiguration(
      placement: placement,
      offerings: offerings,
      offering: selectedIdentifier == null
          ? offerings.current
          : offerings.all[selectedIdentifier],
      paywall: paywallJson == null
          ? null
          : SuperBoardPaywallConfiguration.fromJson(paywallJson),
      experimentAssignment: assignmentJson == null
          ? null
          : SuperBoardExperimentAssignment.fromJson(assignmentJson),
      fetchedAt:
          DateTime.tryParse(json['fetched_at']?.toString() ?? '') ??
          DateTime.now().toUtc(),
      fromCache: fromCache,
    );
  }

  Future<void> trackPaywallEvent(
    String type, {
    required SuperBoardPurchaseConfiguration configuration,
    String? packageIdentifier,
    Map<String, dynamic> metadata = const {},
  }) async {
    await _request(
      'POST',
      '/events',
      body: {
        'id': const Uuid().v4(),
        'type': type,
        'paywall_id': configuration.paywall?.id,
        'paywall_version_id': configuration.paywall?.versionId,
        'placement': configuration.placement.identifier,
        'experiment_id': configuration.experimentAssignment?.experimentId,
        'variant_id': configuration.experimentAssignment?.variantId,
        'package_identifier': packageIdentifier,
        'metadata': metadata,
        'occurred_at': DateTime.now().toUtc().toIso8601String(),
      },
    );
  }

  Future<SuperBoardVirtualCurrencies> getVirtualCurrencies() async {
    final response = await _request('GET', '/virtual-currencies');
    final raw = (response['all'] as Map?)?.cast<String, dynamic>() ?? const {};
    return SuperBoardVirtualCurrencies(
      all: raw.map(
        (key, value) => MapEntry(
          key,
          SuperBoardVirtualCurrency.fromJson(
            (value as Map).cast<String, dynamic>(),
          ),
        ),
      ),
      fetchedAt:
          DateTime.tryParse(response['fetched_at']?.toString() ?? '') ??
          DateTime.now().toUtc(),
    );
  }

  Future<Map<String, dynamic>> getCustomerCenter() =>
      _request('GET', '/customer-center');

  Future<SuperBoardCustomerInfo> getCustomerInfo() async {
    try {
      return _storeCustomerInfo(await _request('GET', '/customer-info'));
    } catch (_) {
      final cached = _lastCustomerInfo;
      if (cached != null &&
          cached.entitlements.values.every(
            (value) =>
                value.expiresAt == null ||
                value.expiresAt!.isAfter(DateTime.now()),
          )) {
        return cached;
      }
      rethrow;
    }
  }

  Future<bool> isEntitled(String identifier) async =>
      (await getCustomerInfo()).isEntitled(identifier);

  Future<SuperBoardPurchaseResult> purchasePackage(
    SuperBoardPackage package,
  ) async {
    try {
      return await _purchasePackage(package);
    } on SuperBoardPurchasesException catch (error) {
      return SuperBoardPurchaseResult(
        SuperBoardPurchaseOutcome.failed,
        code: error.code,
        error: error.message,
        retryable: error.retryable,
        productIdentifier: package.product.identifier,
        requestId: error.requestId,
      );
    } catch (_) {
      return SuperBoardPurchaseResult(
        SuperBoardPurchaseOutcome.failed,
        code: 'purchase_failed',
        error: 'Purchase could not start',
        retryable: true,
        productIdentifier: package.product.identifier,
      );
    }
  }

  Future<SuperBoardPurchaseResult> _purchasePackage(
    SuperBoardPackage package,
  ) async {
    _ensureConfigured();
    await _assertPurchaseIdentitySynchronized();
    var product = _products[package.product.identifier];
    if (product == null) {
      final response = await _iap.queryProductDetails({
        package.product.identifier,
      });
      if (response.productDetails.isEmpty) {
        return SuperBoardPurchaseResult(
          SuperBoardPurchaseOutcome.failed,
          code: 'store_product_not_found',
          error: 'Store product not found',
          productIdentifier: package.product.identifier,
        );
      }
      product = response.productDetails.first;
      _products[product.id] = product;
    }
    final completer = Completer<SuperBoardPurchaseResult>();
    _purchaseCompleters[product.id] = completer;
    final parameter = PurchaseParam(
      productDetails: product,
      applicationUserName: _customerId,
    );
    late final bool started;
    try {
      started = package.product.type == 'consumable'
          ? await _iap.buyConsumable(
              purchaseParam: parameter,
              autoConsume: false,
            )
          : await _iap.buyNonConsumable(purchaseParam: parameter);
    } catch (_) {
      _purchaseCompleters.remove(product.id);
      rethrow;
    }
    if (!started) {
      _purchaseCompleters.remove(product.id);
      return SuperBoardPurchaseResult(
        SuperBoardPurchaseOutcome.failed,
        code: 'store_purchase_not_started',
        error: 'Store purchase could not start',
        retryable: true,
        productIdentifier: product.id,
      );
    }
    final purchasedProductId = product.id;
    return completer.future.timeout(
      const Duration(minutes: 5),
      onTimeout: () {
        _purchaseCompleters.remove(purchasedProductId);
        return SuperBoardPurchaseResult(
          SuperBoardPurchaseOutcome.failed,
          code: 'store_purchase_timeout',
          error: 'Store purchase timed out',
          retryable: true,
          productIdentifier: purchasedProductId,
        );
      },
    );
  }

  Future<SuperBoardCustomerInfo> restorePurchases() async {
    _ensureConfigured();
    _restoreTimer?.cancel();
    _restoreCompleter = Completer<SuperBoardCustomerInfo>();
    await _iap.restorePurchases(applicationUserName: _customerId);
    _scheduleRestoreCompletion();
    return _restoreCompleter!.future.timeout(
      const Duration(seconds: 30),
      onTimeout: getCustomerInfo,
    );
  }

  Future<SuperBoardCustomerInfo> syncPurchases() => restorePurchases();

  void _receivePurchaseBatch(List<PurchaseDetails> purchases) {
    final batch = List<PurchaseDetails>.unmodifiable(purchases);
    if (!_configurationReady) {
      _bufferedPurchaseBatches.add(batch);
      return;
    }
    _enqueuePurchaseBatch(batch);
  }

  void _drainBufferedPurchaseBatches() {
    if (!_configurationReady || _bufferedPurchaseBatches.isEmpty) return;
    final batches = List<List<PurchaseDetails>>.of(_bufferedPurchaseBatches);
    _bufferedPurchaseBatches.clear();
    for (final batch in batches) {
      _enqueuePurchaseBatch(batch);
    }
  }

  void _enqueuePurchaseBatch(List<PurchaseDetails> purchases) {
    _purchaseHandlingTail = _purchaseHandlingTail.then((_) async {
      try {
        await _handlePurchases(purchases);
      } catch (error) {
        _handlePurchaseStreamError(error);
      }
    });
  }

  Future<void> _enqueueOutboxResume() {
    final scheduled = _purchaseHandlingTail.then((_) async {
      try {
        await _resumeOutbox();
      } catch (error) {
        _handlePurchaseStreamError(error);
      }
    });
    _purchaseHandlingTail = scheduled;
    return scheduled;
  }

  Future<void> _handlePurchases(List<PurchaseDetails> purchases) async {
    for (final purchase in purchases) {
      final completer = _purchaseCompleters[purchase.productID];
      if (purchase.status == PurchaseStatus.pending) {
        _completeAndPublish(
          completer,
          SuperBoardPurchaseResult(
            SuperBoardPurchaseOutcome.pending,
            code: 'purchase_pending',
            productIdentifier: purchase.productID,
            transactionIdentifier: purchase.purchaseID,
          ),
        );
        _purchaseCompleters.remove(purchase.productID);
        continue;
      }
      if (purchase.status == PurchaseStatus.canceled) {
        _completeAndPublish(
          completer,
          SuperBoardPurchaseResult(
            SuperBoardPurchaseOutcome.cancelled,
            code: 'purchase_cancelled',
            productIdentifier: purchase.productID,
            transactionIdentifier: purchase.purchaseID,
          ),
        );
        _purchaseCompleters.remove(purchase.productID);
        continue;
      }
      if (purchase.status == PurchaseStatus.error) {
        _completeAndPublish(
          completer,
          SuperBoardPurchaseResult(
            SuperBoardPurchaseOutcome.failed,
            code: purchase.error?.code ?? 'store_purchase_failed',
            error: purchase.error?.message,
            retryable: true,
            productIdentifier: purchase.productID,
            transactionIdentifier: purchase.purchaseID,
          ),
        );
        _purchaseCompleters.remove(purchase.productID);
        continue;
      }
      try {
        final apple = purchase.verificationData.source == 'app_store';
        final productType = _productTypeFor(purchase.productID);
        final verification = purchase.verificationData.serverVerificationData;
        final restoring = purchase.status == PurchaseStatus.restored;
        var entry = await _outbox.upsert(
          SuperBoardPurchaseOutboxEntry.create(
            store: apple ? 'apple' : 'google',
            productId: purchase.productID,
            productType: productType,
            verificationData: verification,
            restoring: restoring,
            transactionId: purchase.purchaseID,
          ),
        );
        Map<String, dynamic>? response;
        SuperBoardCustomerInfo? validatedInfo;
        if (!entry.serverValidated) {
          response = await _validateOutboxEntry(entry);
          final pending =
              response['result'] == 'pending' ||
              response['status'] == 'pending';
          final responseInfo = (response['customer_info'] as Map?)
              ?.cast<String, dynamic>();
          if (!pending) {
            if (responseInfo == null) {
              throw const SuperBoardPurchasesException(
                'Verified CustomerInfo is missing from purchase response',
                code: 'customer_info_missing',
                retryable: true,
              );
            }
            validatedInfo = await _storeCustomerInfo(responseInfo);
          }
          entry = await _outbox.upsert(
            entry.copyWith(
              serverValidated: !pending,
              transactionId: response['transaction_id']?.toString(),
            ),
          );
          if (pending) {
            final result = SuperBoardPurchaseResult(
              SuperBoardPurchaseOutcome.pending,
              code: 'purchase_pending',
              productIdentifier: purchase.productID,
              transactionIdentifier: purchase.purchaseID,
            );
            _completeAndPublish(completer, result);
            _scheduleOutboxRetry();
            continue;
          }
        }
        if (purchase.pendingCompletePurchase) {
          _pendingStoreCompletions[entry.id] = purchase;
          await _iap.completePurchase(purchase);
          _pendingStoreCompletions.remove(entry.id);
        }
        await _outbox.remove(entry.id);
        final info = validatedInfo ?? await getCustomerInfo();
        _completeAndPublish(
          completer,
          SuperBoardPurchaseResult(
            SuperBoardPurchaseOutcome.purchased,
            customerInfo: info,
            code: 'purchase_verified',
            productIdentifier: purchase.productID,
            transactionIdentifier:
                response?['transaction_id']?.toString() ??
                entry.transactionId ??
                purchase.purchaseID,
          ),
        );
      } catch (error) {
        final purchaseError = error is SuperBoardPurchasesException
            ? error
            : SuperBoardPurchasesException(error.toString(), retryable: true);
        _completeAndPublish(
          completer,
          SuperBoardPurchaseResult(
            SuperBoardPurchaseOutcome.failed,
            error: purchaseError.message,
            code: purchaseError.code,
            retryable: purchaseError.retryable,
            requestId: purchaseError.requestId,
            productIdentifier: purchase.productID,
            transactionIdentifier: purchase.purchaseID,
          ),
        );
        _scheduleOutboxRetry();
      } finally {
        _purchaseCompleters.remove(purchase.productID);
      }
    }
    if (_restoreCompleter != null) {
      _scheduleRestoreCompletion();
    }
  }

  Future<Map<String, dynamic>> _validateOutboxEntry(
    SuperBoardPurchaseOutboxEntry entry,
  ) {
    if (entry.restoring) {
      return _request(
        'POST',
        '/restore',
        body: entry.store == 'apple'
            ? {
                'apple_transactions': [entry.verificationData],
              }
            : {
                'google_purchases': [
                  {
                    'purchase_token': entry.verificationData,
                    'product_id': entry.productId,
                    'product_type': entry.productType,
                  },
                ],
              },
      );
    }
    return _request(
      'POST',
      '/receipts',
      body: entry.store == 'apple'
          ? {'store': 'apple', 'signed_transaction': entry.verificationData}
          : {
              'store': 'google',
              'purchase_token': entry.verificationData,
              'product_id': entry.productId,
              'product_type': entry.productType,
            },
    );
  }

  Future<void> _resumeOutbox() async {
    if (_retryingOutbox) return;
    _retryingOutbox = true;
    try {
      final now = DateTime.now().toUtc();
      for (var entry in await _outbox.readAll()) {
        if (entry.serverValidated ||
            (entry.nextAttemptAt?.isAfter(now) ?? false)) {
          continue;
        }
        try {
          final response = await _validateOutboxEntry(entry);
          final pending =
              response['result'] == 'pending' ||
              response['status'] == 'pending';
          final infoJson = (response['customer_info'] as Map?)
              ?.cast<String, dynamic>();
          final info = infoJson == null
              ? null
              : await _storeCustomerInfo(infoJson);
          if (!pending && info == null) {
            throw const SuperBoardPurchasesException(
              'Verified CustomerInfo is missing from purchase response',
              code: 'customer_info_missing',
              retryable: true,
            );
          }
          entry = await _outbox.upsert(
            entry.copyWith(
              serverValidated: !pending,
              transactionId: response['transaction_id']?.toString(),
            ),
          );
          if (!pending) {
            _purchaseResultController.add(
              SuperBoardPurchaseResult(
                SuperBoardPurchaseOutcome.purchased,
                customerInfo: info,
                code: 'purchase_verified_waiting_store_completion',
                productIdentifier: entry.productId,
                transactionIdentifier: entry.transactionId,
              ),
            );
          }
        } catch (_) {
          final attempts = entry.attempts + 1;
          final exponent = attempts > 6 ? 6 : attempts;
          final delaySeconds = (5 * (1 << exponent)).clamp(10, 300).toInt();
          await _outbox.upsert(
            entry.copyWith(
              attempts: attempts,
              nextAttemptAt: now.add(Duration(seconds: delaySeconds)),
            ),
          );
        }
      }
      await _retryStoreCompletions();
    } finally {
      _retryingOutbox = false;
      if (_pendingStoreCompletions.isNotEmpty ||
          (await _outbox.readAll()).any((entry) => !entry.serverValidated)) {
        _scheduleOutboxRetry();
      }
    }
  }

  Future<void> _retryStoreCompletions() async {
    for (final item in _pendingStoreCompletions.entries.toList()) {
      try {
        await _iap.completePurchase(item.value);
        await _outbox.remove(item.key);
        _pendingStoreCompletions.remove(item.key);
        final info = _lastCustomerInfo ?? await getCustomerInfo();
        _purchaseResultController.add(
          SuperBoardPurchaseResult(
            SuperBoardPurchaseOutcome.purchased,
            customerInfo: info,
            code: 'purchase_verified',
            productIdentifier: item.value.productID,
            transactionIdentifier: item.value.purchaseID,
          ),
        );
      } catch (_) {
        // The durable entry stays in the outbox and the retry timer remains active.
      }
    }
  }

  void _scheduleOutboxRetry() {
    _outboxRetryTimer?.cancel();
    _outboxRetryTimer = Timer(
      const Duration(seconds: 15),
      () => unawaited(_enqueueOutboxResume()),
    );
  }

  @visibleForTesting
  Future<void> resumeOutboxForTesting() => _enqueueOutboxResume();

  void _completeAndPublish(
    Completer<SuperBoardPurchaseResult>? completer,
    SuperBoardPurchaseResult result,
  ) {
    if (completer != null && !completer.isCompleted) completer.complete(result);
    _purchaseResultController.add(result);
  }

  void _scheduleRestoreCompletion() {
    _restoreTimer?.cancel();
    _restoreTimer = Timer(const Duration(milliseconds: 750), () async {
      final completer = _restoreCompleter;
      if (completer == null || completer.isCompleted) return;
      try {
        completer.complete(await getCustomerInfo());
      } catch (error, stackTrace) {
        completer.completeError(error, stackTrace);
      } finally {
        _restoreCompleter = null;
      }
    });
  }

  void _handlePurchaseStreamError(Object error) {
    final result = SuperBoardPurchaseResult(
      SuperBoardPurchaseOutcome.failed,
      code: 'purchase_stream_failed',
      error: error.toString(),
      retryable: true,
    );
    for (final completer in _purchaseCompleters.values) {
      if (!completer.isCompleted) {
        completer.complete(result);
      }
    }
    _purchaseCompleters.clear();
    _purchaseResultController.add(result);
    _scheduleOutboxRetry();
  }

  String _productTypeFor(String productId) {
    return _lastOfferProductTypes[productId] ?? 'non_consumable';
  }

  final _lastOfferProductTypes = <String, String>{};

  Future<SuperBoardCustomerInfo> _storeCustomerInfo(
    Map<String, dynamic> value,
  ) async {
    final preferences = _preferences;
    if (preferences == null) {
      throw const SuperBoardPurchasesException(
        'Purchases storage is unavailable',
      );
    }
    final verified = await _customerInfoVerifier.verify(
      envelope: value,
      purchasesBaseUrl: _baseUrl,
      preferences: preferences,
    );
    final info = SuperBoardCustomerInfo.fromJson(verified);
    _lastCustomerInfo = info;
    _customerId = info.customerId ?? _customerId;
    await _secureStorage.write(
      key: 'opengrow.purchases.customer_info.verified',
      value: jsonEncode({...info.toJson(), 'signature': value['signature']}),
    );
    _customerInfoController.add(info);
    return info;
  }

  Future<void> _assertPurchaseIdentitySynchronized() async {
    final token = await _identityTokenForRequest();
    if (token == null || token.isEmpty) {
      throw const SuperBoardPurchasesException(
        'Verified identity synchronization is required before purchasing',
        code: 'identity_required',
        retryable: true,
      );
    }
    try {
      await _storeCustomerInfo(
        await _request('GET', '/customer-info', authorizationToken: token),
      );
    } on SuperBoardPurchasesException catch (error) {
      throw SuperBoardPurchasesException(
        'Identity synchronization failed',
        code: 'identity_sync_failed',
        retryable: error.retryable,
        requestId: error.requestId,
      );
    } on SuperBoardCustomerInfoVerificationException {
      throw const SuperBoardPurchasesException(
        'Identity synchronization returned unverified customer information',
        code: 'identity_verification_failed',
      );
    } catch (_) {
      throw const SuperBoardPurchasesException(
        'Identity synchronization returned invalid customer information',
        code: 'identity_verification_failed',
      );
    }
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    String? authorizationToken,
  }) async {
    _ensureConfigured();
    final token = authorizationToken ?? await _identityTokenForRequest();
    final request = http.Request(method, Uri.parse('$_baseUrl$path'))
      ..headers.addAll({
        'Content-Type': 'application/json',
        'PROJECT-KEY': _projectKey!,
        'PLATFORM': defaultTargetPlatform == TargetPlatform.iOS
            ? 'ios'
            : 'android',
        'IDENTIFIER': _platformIdentifier!,
        'X-SuperBoard-Anonymous-ID': _anonymousId!,
        'X-SuperBoard-SDK-Version': _sdkVersion,
        if (_appVersion.isNotEmpty) 'X-SuperBoard-App-Version': _appVersion,
        if (_buildNumber.isNotEmpty) 'X-SuperBoard-Build-Number': _buildNumber,
        if (_storefront.isNotEmpty) 'X-SuperBoard-Storefront': _storefront,
        if (_campaign.isNotEmpty) 'X-SuperBoard-Campaign': _campaign,
        // Compatibility headers remain during the rolling Worker migration.
        'X-OpenGrow-Anonymous-ID': _anonymousId!,
        'X-OpenGrow-SDK-Version': _sdkVersion,
        if (_appVersion.isNotEmpty) 'X-OpenGrow-App-Version': _appVersion,
        if (_buildNumber.isNotEmpty) 'X-OpenGrow-Build-Number': _buildNumber,
        if (_storefront.isNotEmpty) 'X-OpenGrow-Storefront': _storefront,
        if (_campaign.isNotEmpty) 'X-OpenGrow-Campaign': _campaign,
        if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
      })
      ..body = jsonEncode(body ?? const {});
    final client = _httpClientFactory();
    late final http.StreamedResponse streamed;
    late final String text;
    try {
      streamed = await client.send(request).timeout(_requestTimeout);
      text = await _readBoundedResponse(streamed).timeout(_requestTimeout);
    } on TimeoutException {
      throw const SuperBoardPurchasesException(
        'Purchases request timed out',
        code: 'network_timeout',
        retryable: true,
      );
    } finally {
      client.close();
    }
    late final Map<String, dynamic> decoded;
    try {
      decoded = text.isEmpty
          ? <String, dynamic>{}
          : (jsonDecode(text) as Map).cast<String, dynamic>();
    } catch (_) {
      throw const SuperBoardPurchasesException(
        'Purchases server returned an invalid response',
        code: 'server_response_invalid',
        retryable: true,
      );
    }
    if (streamed.statusCode < 200 || streamed.statusCode >= 300) {
      final error = decoded['error'];
      final message = error is Map
          ? error['message']?.toString()
          : error?.toString();
      throw SuperBoardPurchasesException(
        message ?? 'HTTP ${streamed.statusCode}',
        code: error is Map
            ? error['code']?.toString() ?? 'http_${streamed.statusCode}'
            : 'http_${streamed.statusCode}',
        retryable: error is Map
            ? error['retryable'] == true
            : streamed.statusCode >= 500,
        requestId: error is Map ? error['request_id']?.toString() : null,
      );
    }
    return decoded;
  }

  Future<String> _readBoundedResponse(http.StreamedResponse response) async {
    final bytes = BytesBuilder(copy: false);
    var length = 0;
    await for (final chunk in response.stream) {
      length += chunk.length;
      if (length > _maximumResponseBytes) {
        throw const SuperBoardPurchasesException(
          'Purchases server response is too large',
          code: 'server_response_too_large',
        );
      }
      bytes.add(chunk);
    }
    return utf8.decode(bytes.takeBytes());
  }

  void _ensureConfigured() {
    if (_projectKey == null ||
        _platformIdentifier == null ||
        _anonymousId == null) {
      throw const SuperBoardPurchasesException(
        'Call SuperBoardPurchases.instance.configure first',
      );
    }
  }

  Future<String?> _identityTokenForRequest() async {
    final cached = _identityToken;
    final expiresAt = _identityTokenExpiresAt;
    if (cached != null &&
        cached.isNotEmpty &&
        (_tokenProvider == null ||
            (expiresAt != null &&
                expiresAt.isAfter(
                  DateTime.now().toUtc().add(const Duration(seconds: 30)),
                )))) {
      return cached;
    }
    final provider = _tokenProvider;
    if (provider == null) return cached;
    final activeRefresh = _identityTokenRefresh;
    if (activeRefresh != null) return activeRefresh;
    final refresh = _refreshIdentityToken(provider);
    _identityTokenRefresh = refresh;
    try {
      return await refresh;
    } finally {
      if (identical(_identityTokenRefresh, refresh)) {
        _identityTokenRefresh = null;
      }
    }
  }

  Future<String?> _refreshIdentityToken(
    SuperBoardIdentityTokenProvider provider,
  ) async {
    final provided = await provider();
    if (provided == null || provided.isEmpty) {
      _setIdentityToken(null);
      return null;
    }
    _setIdentityToken(provided);
    return provided;
  }

  void _setIdentityToken(String? token) {
    _identityToken = token;
    _identityTokenExpiresAt = _readJwtExpiration(token);
  }

  DateTime? _readJwtExpiration(String? token) {
    if (token == null || token.isEmpty) return null;
    try {
      final parts = token.split('.');
      if (parts.length != 3) return null;
      final payload = jsonDecode(
        utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))),
      );
      if (payload is! Map) return null;
      final expiresAt = payload['exp'];
      if (expiresAt is! num || expiresAt <= 0) return null;
      return DateTime.fromMillisecondsSinceEpoch(
        expiresAt.toInt() * 1000,
        isUtc: true,
      );
    } catch (_) {
      return null;
    }
  }

  @visibleForTesting
  Future<void> disposeForTesting() async {
    _configurationReady = false;
    _restoreTimer?.cancel();
    _outboxRetryTimer?.cancel();
    await _subscription?.cancel();
    await _purchaseHandlingTail;
    await _customerInfoController.close();
    await _purchaseResultController.close();
  }
}

@Deprecated('Use SuperBoardIdentityTokenProvider.')
typedef OpenGrowIdentityTokenProvider = SuperBoardIdentityTokenProvider;
@Deprecated('Use SuperBoardPurchasesException.')
typedef OpenGrowPurchasesException = SuperBoardPurchasesException;
@Deprecated('Use SuperBoardPurchases.')
typedef OpenGrowPurchases = SuperBoardPurchases;
