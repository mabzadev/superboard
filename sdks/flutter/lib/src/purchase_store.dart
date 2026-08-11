import 'package:in_app_purchase/in_app_purchase.dart';

abstract interface class SuperBoardPurchaseStore {
  Stream<List<PurchaseDetails>> get purchaseStream;

  Future<bool> isAvailable();

  Future<ProductDetailsResponse> queryProductDetails(Set<String> identifiers);

  Future<bool> buyNonConsumable({required PurchaseParam purchaseParam});

  Future<bool> buyConsumable({
    required PurchaseParam purchaseParam,
    bool autoConsume = true,
  });

  Future<void> completePurchase(PurchaseDetails purchase);

  Future<void> restorePurchases({String? applicationUserName});
}

class FlutterSuperBoardPurchaseStore implements SuperBoardPurchaseStore {
  FlutterSuperBoardPurchaseStore([InAppPurchase? purchases])
    : _purchases = purchases ?? InAppPurchase.instance;

  final InAppPurchase _purchases;

  @override
  Stream<List<PurchaseDetails>> get purchaseStream => _purchases.purchaseStream;

  @override
  Future<bool> isAvailable() => _purchases.isAvailable();

  @override
  Future<ProductDetailsResponse> queryProductDetails(Set<String> identifiers) =>
      _purchases.queryProductDetails(identifiers);

  @override
  Future<bool> buyNonConsumable({required PurchaseParam purchaseParam}) =>
      _purchases.buyNonConsumable(purchaseParam: purchaseParam);

  @override
  Future<bool> buyConsumable({
    required PurchaseParam purchaseParam,
    bool autoConsume = true,
  }) => _purchases.buyConsumable(
    purchaseParam: purchaseParam,
    autoConsume: autoConsume,
  );

  @override
  Future<void> completePurchase(PurchaseDetails purchase) =>
      _purchases.completePurchase(purchase);

  @override
  Future<void> restorePurchases({String? applicationUserName}) =>
      _purchases.restorePurchases(applicationUserName: applicationUserName);
}

@Deprecated('Use SuperBoardPurchaseStore.')
typedef OpenGrowPurchaseStore = SuperBoardPurchaseStore;
@Deprecated('Use FlutterSuperBoardPurchaseStore.')
typedef FlutterOpenGrowPurchaseStore = FlutterSuperBoardPurchaseStore;
