import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import 'models/opengrow_purchases.dart';

typedef OpenGrowIdentityTokenProvider = Future<String?> Function();

class OpenGrowPurchasesException implements Exception {
  const OpenGrowPurchasesException(this.message);
  final String message;
  @override
  String toString() => 'OpenGrowPurchasesException: $message';
}

class OpenGrowPurchases {
  OpenGrowPurchases._();
  static final instance = OpenGrowPurchases._();

  final _iap = InAppPurchase.instance;
  final _customerInfoController =
      StreamController<OpenGrowCustomerInfo>.broadcast();
  final _purchaseCompleters = <String, Completer<OpenGrowPurchaseResult>>{};
  final _products = <String, ProductDetails>{};
  Completer<OpenGrowCustomerInfo>? _restoreCompleter;
  Timer? _restoreTimer;
  StreamSubscription<List<PurchaseDetails>>? _subscription;
  SharedPreferences? _preferences;
  OpenGrowIdentityTokenProvider? _tokenProvider;
  String? _identityToken;
  String? _projectKey;
  String? _platformIdentifier;
  String _baseUrl = 'https://sdk.vocostar.com/purchases/v1';
  String? _anonymousId;
  String? _customerId;
  OpenGrowCustomerInfo? _lastCustomerInfo;

  Stream<OpenGrowCustomerInfo> get customerInfoStream =>
      _customerInfoController.stream;
  OpenGrowCustomerInfo? get cachedCustomerInfo => _lastCustomerInfo;

  Future<OpenGrowCustomerInfo> configure({
    required String projectKey,
    required String platformIdentifier,
    String baseUrl = 'https://sdk.vocostar.com/purchases/v1',
    String? identityToken,
    OpenGrowIdentityTokenProvider? identityTokenProvider,
  }) async {
    if (kIsWeb ||
        (defaultTargetPlatform != TargetPlatform.iOS &&
            defaultTargetPlatform != TargetPlatform.android)) {
      throw const OpenGrowPurchasesException(
        'OpenGrow Purchases supports iOS and Android only',
      );
    }
    _projectKey = projectKey;
    _platformIdentifier = platformIdentifier;
    _baseUrl = baseUrl.replaceFirst(RegExp(r'/+$'), '');
    _identityToken = identityToken;
    _tokenProvider = identityTokenProvider;
    _preferences = await SharedPreferences.getInstance();
    _anonymousId = _preferences!.getString('opengrow.purchases.anonymous_id');
    if (_anonymousId == null) {
      _anonymousId = r'$opengrow_anon_' + const Uuid().v4();
      await _preferences!.setString(
        'opengrow.purchases.anonymous_id',
        _anonymousId!,
      );
    }
    final cached = _preferences!.getString('opengrow.purchases.customer_info');
    if (cached != null) {
      try {
        final info = OpenGrowCustomerInfo.fromJson(
          (jsonDecode(cached) as Map).cast<String, dynamic>(),
        );
        _lastCustomerInfo = info;
        _customerId = info.customerId;
      } catch (_) {}
    }
    _subscription ??= _iap.purchaseStream.listen(
      _handlePurchases,
      onError: _handlePurchaseStreamError,
    );
    if (!await _iap.isAvailable()) {
      throw const OpenGrowPurchasesException('The platform store is unavailable');
    }
    return getCustomerInfo();
  }

  Future<void> setIdentityToken(String? token) async => _identityToken = token;

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

  Future<OpenGrowPurchaseResult> purchasePackage(OpenGrowPackage package) async {
    _ensureConfigured();
    var product = _products[package.product.identifier];
    if (product == null) {
      final response = await _iap.queryProductDetails({
        package.product.identifier,
      });
      if (response.productDetails.isEmpty) {
        return OpenGrowPurchaseResult(
          OpenGrowPurchaseOutcome.failed,
          error: 'Store product not found',
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
    final started = package.product.type == 'consumable'
        ? await _iap.buyConsumable(purchaseParam: parameter, autoConsume: false)
        : await _iap.buyNonConsumable(purchaseParam: parameter);
    if (!started) {
      _purchaseCompleters.remove(product.id);
      return OpenGrowPurchaseResult(
        OpenGrowPurchaseOutcome.failed,
        error: 'Store purchase could not start',
      );
    }
    return completer.future.timeout(
      const Duration(minutes: 5),
      onTimeout: () {
        _purchaseCompleters.remove(product!.id);
        return OpenGrowPurchaseResult(
          OpenGrowPurchaseOutcome.failed,
          error: 'Store purchase timed out',
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
        if (completer != null && !completer.isCompleted) {
          completer.complete(
            const OpenGrowPurchaseResult(OpenGrowPurchaseOutcome.pending),
          );
        }
        _purchaseCompleters.remove(purchase.productID);
        continue;
      }
      if (purchase.status == PurchaseStatus.canceled) {
        if (completer != null && !completer.isCompleted) {
          completer.complete(
            const OpenGrowPurchaseResult(OpenGrowPurchaseOutcome.cancelled),
          );
        }
        _purchaseCompleters.remove(purchase.productID);
        continue;
      }
      if (purchase.status == PurchaseStatus.error) {
        if (completer != null && !completer.isCompleted) {
          completer.complete(
            OpenGrowPurchaseResult(
              OpenGrowPurchaseOutcome.failed,
              error: purchase.error?.message,
            ),
          );
        }
        _purchaseCompleters.remove(purchase.productID);
        continue;
      }
      try {
        final apple = purchase.verificationData.source == 'app_store';
        final productType = _productTypeFor(purchase.productID);
        final verification = purchase.verificationData.serverVerificationData;
        final restoring = purchase.status == PurchaseStatus.restored;
        final response = await _request(
          'POST',
          restoring
              ? '/restore'
              : apple
              ? '/apple/transactions'
              : '/google/purchases',
          body: restoring
              ? apple
                    ? {
                        'apple_transactions': [verification],
                      }
                    : {
                        'google_purchases': [
                          {
                            'purchase_token': verification,
                            'product_id': purchase.productID,
                            'product_type': productType,
                          },
                        ],
                      }
              : apple
              ? {'signed_transaction': verification}
              : {
                  'purchase_token': verification,
                  'product_id': purchase.productID,
                  'product_type': productType,
                },
        );
        if (response['result'] != 'pending' &&
            purchase.pendingCompletePurchase) {
          await _iap.completePurchase(purchase);
        }
        final infoJson = (response['customer_info'] as Map?)
            ?.cast<String, dynamic>();
        final info = infoJson == null
            ? await getCustomerInfo()
            : _storeCustomerInfo(infoJson);
        if (completer != null && !completer.isCompleted) {
          completer.complete(
            OpenGrowPurchaseResult(
              OpenGrowPurchaseOutcome.purchased,
              customerInfo: info,
            ),
          );
        }
      } catch (error) {
        if (completer != null && !completer.isCompleted) {
          completer.complete(
            OpenGrowPurchaseResult(
              OpenGrowPurchaseOutcome.failed,
              error: error.toString(),
            ),
          );
        }
      } finally {
        _purchaseCompleters.remove(purchase.productID);
      }
    }
    if (_restoreCompleter != null) {
      _scheduleRestoreCompletion();
    }
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
    for (final completer in _purchaseCompleters.values) {
      if (!completer.isCompleted) {
        completer.complete(
          OpenGrowPurchaseResult(
            OpenGrowPurchaseOutcome.failed,
            error: error.toString(),
          ),
        );
      }
    }
    _purchaseCompleters.clear();
  }

  String _productTypeFor(String productId) {
    return _lastOfferProductTypes[productId] ?? 'non_consumable';
  }

  final _lastOfferProductTypes = <String, String>{};

  OpenGrowCustomerInfo _storeCustomerInfo(Map<String, dynamic> value) {
    final info = OpenGrowCustomerInfo.fromJson(value);
    _lastCustomerInfo = info;
    _customerId = info.customerId ?? _customerId;
    _preferences?.setString(
      'opengrow.purchases.customer_info',
      jsonEncode(info.toJson()),
    );
    _customerInfoController.add(info);
    return info;
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
  }) async {
    _ensureConfigured();
    final token = _identityToken ?? await _tokenProvider?.call();
    final request = http.Request(method, Uri.parse('$_baseUrl$path'))
      ..headers.addAll({
        'Content-Type': 'application/json',
        'PROJECT-KEY': _projectKey!,
        'PLATFORM': defaultTargetPlatform == TargetPlatform.iOS
            ? 'ios'
            : 'android',
        'IDENTIFIER': _platformIdentifier!,
        'X-OpenGrow-Anonymous-ID': _anonymousId!,
        if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
      })
      ..body = jsonEncode(body ?? const {});
    final client = http.Client();
    final streamed = await client.send(request);
    final text = await streamed.stream.bytesToString();
    client.close();
    final decoded = text.isEmpty
        ? <String, dynamic>{}
        : (jsonDecode(text) as Map).cast<String, dynamic>();
    if (streamed.statusCode < 200 || streamed.statusCode >= 300) {
      throw OpenGrowPurchasesException(
        (decoded['error'] ?? 'HTTP ${streamed.statusCode}').toString(),
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
}
