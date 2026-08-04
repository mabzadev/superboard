import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import 'models/opengrow_purchases.dart';
import 'src/customer_info_verifier.dart';
import 'src/purchase_outbox.dart';
import 'src/purchase_store.dart';

typedef OpenGrowIdentityTokenProvider = Future<String?> Function();

class OpenGrowPurchasesException implements Exception {
  const OpenGrowPurchasesException(
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
  String toString() => 'OpenGrowPurchasesException: $message';
}

class OpenGrowPurchases {
  OpenGrowPurchases._({
    OpenGrowPurchaseStore? purchaseStore,
    OpenGrowPurchaseStorage? secureStorage,
    OpenGrowCustomerInfoVerifier? customerInfoVerifier,
    http.Client Function()? httpClientFactory,
  }) : _iap = purchaseStore ?? FlutterOpenGrowPurchaseStore(),
       _secureStorage = secureStorage ?? const FlutterOpenGrowPurchaseStorage(),
       _customerInfoVerifier =
           customerInfoVerifier ?? OpenGrowCustomerInfoVerifier(),
       _httpClientFactory = httpClientFactory ?? http.Client.new {
    _outbox = OpenGrowPurchaseOutbox(_secureStorage);
  }

  @visibleForTesting
  factory OpenGrowPurchases.forTesting({
    required OpenGrowPurchaseStore purchaseStore,
    required OpenGrowPurchaseStorage secureStorage,
    required OpenGrowCustomerInfoVerifier customerInfoVerifier,
    required http.Client Function() httpClientFactory,
  }) => OpenGrowPurchases._(
    purchaseStore: purchaseStore,
    secureStorage: secureStorage,
    customerInfoVerifier: customerInfoVerifier,
    httpClientFactory: httpClientFactory,
  );

  static final instance = OpenGrowPurchases._();

  final OpenGrowPurchaseStore _iap;
  final OpenGrowPurchaseStorage _secureStorage;
  final OpenGrowCustomerInfoVerifier _customerInfoVerifier;
  final http.Client Function() _httpClientFactory;
  late final OpenGrowPurchaseOutbox _outbox;
  final _customerInfoController =
      StreamController<OpenGrowCustomerInfo>.broadcast();
  final _purchaseCompleters = <String, Completer<OpenGrowPurchaseResult>>{};
  final _purchaseResultController =
      StreamController<OpenGrowPurchaseResult>.broadcast();
  final _products = <String, ProductDetails>{};
  Completer<OpenGrowCustomerInfo>? _restoreCompleter;
  Timer? _restoreTimer;
  Timer? _outboxRetryTimer;
  bool _retryingOutbox = false;
  StreamSubscription<List<PurchaseDetails>>? _subscription;
  SharedPreferences? _preferences;
  OpenGrowIdentityTokenProvider? _tokenProvider;
  String? _identityToken;
  String? _projectKey;
  String? _platformIdentifier;
  String _baseUrl = 'https://sdk.vocostar.com/purchases/v2';
  String _appVersion = '';
  String _buildNumber = '';
  String _sdkVersion = '2.1.3';
  String _storefront = '';
  String _campaign = '';
  String? _anonymousId;
  String? _customerId;
  OpenGrowCustomerInfo? _lastCustomerInfo;

  Stream<OpenGrowCustomerInfo> get customerInfoStream =>
      _customerInfoController.stream;
  Stream<OpenGrowPurchaseResult> get purchaseResultStream =>
      _purchaseResultController.stream;
  OpenGrowCustomerInfo? get cachedCustomerInfo => _lastCustomerInfo;

  Future<OpenGrowCustomerInfo> configure({
    required String projectKey,
    required String platformIdentifier,
    String baseUrl = 'https://sdk.vocostar.com/purchases/v2',
    String? identityToken,
    OpenGrowIdentityTokenProvider? identityTokenProvider,
    String appVersion = '',
    String buildNumber = '',
    String sdkVersion = '2.1.3',
    String storefront = '',
    String campaign = '',
  }) async {
    if (kIsWeb ||
        (defaultTargetPlatform != TargetPlatform.iOS &&
            defaultTargetPlatform != TargetPlatform.android)) {
      throw const OpenGrowPurchasesException(
        'OpenGrow Purchases supports iOS and Android only',
      );
    }
    _subscription ??= _iap.purchaseStream.listen(
      _handlePurchases,
      onError: _handlePurchaseStreamError,
    );
    _projectKey = projectKey;
    _platformIdentifier = platformIdentifier;
    _baseUrl = baseUrl.replaceFirst(RegExp(r'/+$'), '');
    _identityToken = identityToken;
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
        final info = OpenGrowCustomerInfo.fromJson(verified);
        _lastCustomerInfo = info;
        _customerId = info.customerId;
      } catch (_) {
        await _secureStorage.delete(
          key: 'opengrow.purchases.customer_info.verified',
        );
      }
    }
    if (!await _iap.isAvailable()) {
      throw const OpenGrowPurchasesException(
        'The platform store is unavailable',
      );
    }
    unawaited(_resumeOutbox());
    return getCustomerInfo();
  }

  Future<void> setIdentityToken(String? token) async => _identityToken = token;

  /// Records an authenticated, challenge-bound result for a live purchase
  /// certification run. The server accepts only a verified application
  /// identity and stores the structured result as immutable evidence.
  Future<OpenGrowCertificationResult> submitCertificationResult({
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
    final response = await _request(
      'POST',
      '/certification/device-results',
      body: {
        'id': resultId ?? const Uuid().v4(),
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
      throw const OpenGrowPurchasesException(
        'Certification server returned an invalid device result',
        code: 'device_certification_response_invalid',
      );
    }
    return OpenGrowCertificationResult.fromJson(data);
  }

  Future<OpenGrowCustomerInfo> logIn(String identityToken) async {
    _identityToken = identityToken;
    final response = await _request(
      'POST',
      '/identify',
      body: {'current_app_user_id': _anonymousId},
    );
    return _storeCustomerInfo(response);
  }

  Future<OpenGrowCustomerInfo> logOut() async {
    _identityToken = null;
    _tokenProvider = null;
    _anonymousId = r'$opengrow_anon_' + const Uuid().v4();
    await _preferences?.setString(
      'opengrow.purchases.anonymous_id',
      _anonymousId!,
    );
    _customerId = null;
    return getCustomerInfo();
  }

  Future<OpenGrowOfferings> getOfferings({String placement = 'default'}) async {
    final response = await _request(
      'GET',
      '/offerings?placement=${Uri.encodeQueryComponent(placement)}',
    );
    return _offeringsFromResponse(response);
  }

  Future<OpenGrowOfferings> _offeringsFromResponse(
    Map<String, dynamic> response,
  ) async {
    _customerId = response['customer_id']?.toString() ?? _customerId;
    final allJson =
        (response['all'] as Map?)?.cast<String, dynamic>() ?? const {};
    final offerings = <String, OpenGrowOffering>{};
    final productIds = <String>{};
    for (final entry in allJson.entries) {
      final value = (entry.value as Map).cast<String, dynamic>();
      final packageList = <OpenGrowPackage>[];
      for (final raw in (value['packages'] as List? ?? const [])) {
        final package = (raw as Map).cast<String, dynamic>();
        final product = (package['product'] as Map).cast<String, dynamic>();
        final id = product['store_product_id'].toString();
        productIds.add(id);
        packageList.add(
          OpenGrowPackage(
            identifier: package['identifier'].toString(),
            packageType: (package['package_type'] ?? 'custom').toString(),
            product: OpenGrowStoreProduct(
              identifier: id,
              type: product['product_type'].toString(),
            ),
          ),
        );
      }
      offerings[entry.key] = OpenGrowOffering(
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
        offerings[entry.key] = OpenGrowOffering(
          identifier: entry.value.identifier,
          displayName: entry.value.displayName,
          description: entry.value.description,
          packages: entry.value.packages.map((package) {
            final detail = _products[package.product.identifier];
            return OpenGrowPackage(
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
    return OpenGrowOfferings(
      all: offerings,
      current: currentId == null ? null : offerings[currentId],
    );
  }

  /// Fetches the offering, published remote paywall, targeting result and
  /// deterministic experiment assignment for a placement.
  ///
  /// The last successful response is cached per placement and returned during
  /// transient network failures so the application can still monetize offline.
  Future<OpenGrowPurchaseConfiguration> getPurchaseConfiguration({
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

  Future<OpenGrowPurchaseConfiguration> _purchaseConfigurationFromJson(
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
    final placement = OpenGrowPlacement.fromJson(
      (json['placement'] as Map?)?.cast<String, dynamic>() ??
          {'identifier': 'default', 'display_name': 'Default'},
    );
    final paywallJson = (json['paywall'] as Map?)?.cast<String, dynamic>();
    final assignmentJson = (json['experiment_assignment'] as Map?)
        ?.cast<String, dynamic>();
    return OpenGrowPurchaseConfiguration(
      placement: placement,
      offerings: offerings,
      offering: selectedIdentifier == null
          ? offerings.current
          : offerings.all[selectedIdentifier],
      paywall: paywallJson == null
          ? null
          : OpenGrowPaywallConfiguration.fromJson(paywallJson),
      experimentAssignment: assignmentJson == null
          ? null
          : OpenGrowExperimentAssignment.fromJson(assignmentJson),
      fetchedAt:
          DateTime.tryParse(json['fetched_at']?.toString() ?? '') ??
          DateTime.now().toUtc(),
      fromCache: fromCache,
    );
  }

  Future<void> trackPaywallEvent(
    String type, {
    required OpenGrowPurchaseConfiguration configuration,
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

  Future<OpenGrowVirtualCurrencies> getVirtualCurrencies() async {
    final response = await _request('GET', '/virtual-currencies');
    final raw = (response['all'] as Map?)?.cast<String, dynamic>() ?? const {};
    return OpenGrowVirtualCurrencies(
      all: raw.map(
        (key, value) => MapEntry(
          key,
          OpenGrowVirtualCurrency.fromJson(
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

  Future<OpenGrowCustomerInfo> getCustomerInfo() async {
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

  Future<OpenGrowPurchaseResult> purchasePackage(
    OpenGrowPackage package,
  ) async {
    try {
      return await _purchasePackage(package);
    } on OpenGrowPurchasesException catch (error) {
      return OpenGrowPurchaseResult(
        OpenGrowPurchaseOutcome.failed,
        code: error.code,
        error: error.message,
        retryable: error.retryable,
        productIdentifier: package.product.identifier,
        requestId: error.requestId,
      );
    } catch (_) {
      return OpenGrowPurchaseResult(
        OpenGrowPurchaseOutcome.failed,
        code: 'purchase_failed',
        error: 'Purchase could not start',
        retryable: true,
        productIdentifier: package.product.identifier,
      );
    }
  }

  Future<OpenGrowPurchaseResult> _purchasePackage(
    OpenGrowPackage package,
  ) async {
    _ensureConfigured();
    await _assertPurchaseIdentitySynchronized();
    var product = _products[package.product.identifier];
    if (product == null) {
      final response = await _iap.queryProductDetails({
        package.product.identifier,
      });
      if (response.productDetails.isEmpty) {
        return OpenGrowPurchaseResult(
          OpenGrowPurchaseOutcome.failed,
          code: 'store_product_not_found',
          error: 'Store product not found',
          productIdentifier: package.product.identifier,
        );
      }
      product = response.productDetails.first;
      _products[product.id] = product;
    }
    final completer = Completer<OpenGrowPurchaseResult>();
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
      return OpenGrowPurchaseResult(
        OpenGrowPurchaseOutcome.failed,
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
        return OpenGrowPurchaseResult(
          OpenGrowPurchaseOutcome.failed,
          code: 'store_purchase_timeout',
          error: 'Store purchase timed out',
          retryable: true,
          productIdentifier: purchasedProductId,
        );
      },
    );
  }

  Future<OpenGrowCustomerInfo> restorePurchases() async {
    _ensureConfigured();
    _restoreTimer?.cancel();
    _restoreCompleter = Completer<OpenGrowCustomerInfo>();
    await _iap.restorePurchases(applicationUserName: _customerId);
    _scheduleRestoreCompletion();
    return _restoreCompleter!.future.timeout(
      const Duration(seconds: 30),
      onTimeout: getCustomerInfo,
    );
  }

  Future<OpenGrowCustomerInfo> syncPurchases() => restorePurchases();

  Future<void> _handlePurchases(List<PurchaseDetails> purchases) async {
    for (final purchase in purchases) {
      final completer = _purchaseCompleters[purchase.productID];
      if (purchase.status == PurchaseStatus.pending) {
        _completeAndPublish(
          completer,
          OpenGrowPurchaseResult(
            OpenGrowPurchaseOutcome.pending,
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
          OpenGrowPurchaseResult(
            OpenGrowPurchaseOutcome.cancelled,
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
          OpenGrowPurchaseResult(
            OpenGrowPurchaseOutcome.failed,
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
          OpenGrowPurchaseOutboxEntry.create(
            store: apple ? 'apple' : 'google',
            productId: purchase.productID,
            productType: productType,
            verificationData: verification,
            restoring: restoring,
            transactionId: purchase.purchaseID,
          ),
        );
        Map<String, dynamic>? response;
        OpenGrowCustomerInfo? validatedInfo;
        if (!entry.serverValidated) {
          response = await _validateOutboxEntry(entry);
          final pending =
              response['result'] == 'pending' ||
              response['status'] == 'pending';
          final responseInfo = (response['customer_info'] as Map?)
              ?.cast<String, dynamic>();
          if (!pending) {
            if (responseInfo == null) {
              throw const OpenGrowPurchasesException(
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
            final result = OpenGrowPurchaseResult(
              OpenGrowPurchaseOutcome.pending,
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
          await _iap.completePurchase(purchase);
        }
        await _outbox.remove(entry.id);
        final info = validatedInfo ?? await getCustomerInfo();
        _completeAndPublish(
          completer,
          OpenGrowPurchaseResult(
            OpenGrowPurchaseOutcome.purchased,
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
        final purchaseError = error is OpenGrowPurchasesException
            ? error
            : OpenGrowPurchasesException(error.toString(), retryable: true);
        _completeAndPublish(
          completer,
          OpenGrowPurchaseResult(
            OpenGrowPurchaseOutcome.failed,
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
    OpenGrowPurchaseOutboxEntry entry,
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
            throw const OpenGrowPurchasesException(
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
              OpenGrowPurchaseResult(
                OpenGrowPurchaseOutcome.purchased,
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
    } finally {
      _retryingOutbox = false;
      if ((await _outbox.readAll()).any((entry) => !entry.serverValidated)) {
        _scheduleOutboxRetry();
      }
    }
  }

  void _scheduleOutboxRetry() {
    _outboxRetryTimer?.cancel();
    _outboxRetryTimer = Timer(
      const Duration(seconds: 15),
      () => unawaited(_resumeOutbox()),
    );
  }

  void _completeAndPublish(
    Completer<OpenGrowPurchaseResult>? completer,
    OpenGrowPurchaseResult result,
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
    final result = OpenGrowPurchaseResult(
      OpenGrowPurchaseOutcome.failed,
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

  Future<OpenGrowCustomerInfo> _storeCustomerInfo(
    Map<String, dynamic> value,
  ) async {
    final preferences = _preferences;
    if (preferences == null) {
      throw const OpenGrowPurchasesException(
        'Purchases storage is unavailable',
      );
    }
    final verified = await _customerInfoVerifier.verify(
      envelope: value,
      purchasesBaseUrl: _baseUrl,
      preferences: preferences,
    );
    final info = OpenGrowCustomerInfo.fromJson(verified);
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
      throw const OpenGrowPurchasesException(
        'Verified identity synchronization is required before purchasing',
        code: 'identity_required',
        retryable: true,
      );
    }
    try {
      await _storeCustomerInfo(
        await _request('GET', '/customer-info', authorizationToken: token),
      );
    } on OpenGrowPurchasesException catch (error) {
      throw OpenGrowPurchasesException(
        'Identity synchronization failed',
        code: 'identity_sync_failed',
        retryable: error.retryable,
        requestId: error.requestId,
      );
    } on OpenGrowCustomerInfoVerificationException {
      throw const OpenGrowPurchasesException(
        'Identity synchronization returned unverified customer information',
        code: 'identity_verification_failed',
      );
    } catch (_) {
      throw const OpenGrowPurchasesException(
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
      streamed = await client.send(request);
      text = await streamed.stream.bytesToString();
    } finally {
      client.close();
    }
    final decoded = text.isEmpty
        ? <String, dynamic>{}
        : (jsonDecode(text) as Map).cast<String, dynamic>();
    if (streamed.statusCode < 200 || streamed.statusCode >= 300) {
      final error = decoded['error'];
      final message = error is Map
          ? error['message']?.toString()
          : error?.toString();
      throw OpenGrowPurchasesException(
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

  void _ensureConfigured() {
    if (_projectKey == null ||
        _platformIdentifier == null ||
        _anonymousId == null) {
      throw const OpenGrowPurchasesException(
        'Call OpenGrowPurchases.instance.configure first',
      );
    }
  }

  Future<String?> _identityTokenForRequest() async {
    final provided = await _tokenProvider?.call();
    if (provided != null && provided.isNotEmpty) {
      _identityToken = provided;
      return provided;
    }
    return _identityToken;
  }

  @visibleForTesting
  Future<void> disposeForTesting() async {
    _restoreTimer?.cancel();
    _outboxRetryTimer?.cancel();
    await _subscription?.cancel();
    await _customerInfoController.close();
    await _purchaseResultController.close();
  }
}
