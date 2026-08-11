import 'package:superboard_flutter/models/superboard_purchases.dart';

class SuperBoardFlutterFlowPackage {
  const SuperBoardFlutterFlowPackage({
    required this.identifier,
    required this.productId,
    required this.productType,
    required this.price,
    required this.title,
  });

  final String identifier;
  final String productId;
  final String productType;
  final String price;
  final String title;

  Map<String, dynamic> toMap() => {
    'identifier': identifier,
    'productId': productId,
    'productType': productType,
    'price': price,
    'title': title,
  };

  factory SuperBoardFlutterFlowPackage.fromSuperBoard(
    SuperBoardPackage package,
  ) {
    return SuperBoardFlutterFlowPackage(
      identifier: package.identifier,
      productId: package.product.identifier,
      productType: package.product.type,
      price: package.product.localizedPrice ?? '',
      title: package.product.title ?? package.identifier,
    );
  }
}

class SuperBoardFlutterFlowOffering {
  const SuperBoardFlutterFlowOffering({
    required this.identifier,
    required this.title,
    required this.description,
    required this.packages,
  });

  final String identifier;
  final String title;
  final String description;
  final List<SuperBoardFlutterFlowPackage> packages;

  Map<String, dynamic> toMap() => {
    'identifier': identifier,
    'title': title,
    'description': description,
    'packages': packages.map((value) => value.toMap()).toList(),
  };

  factory SuperBoardFlutterFlowOffering.fromSuperBoard(
    SuperBoardOffering offering,
  ) {
    return SuperBoardFlutterFlowOffering(
      identifier: offering.identifier,
      title: offering.displayName ?? offering.identifier,
      description: offering.description ?? '',
      packages: offering.packages
          .map(SuperBoardFlutterFlowPackage.fromSuperBoard)
          .toList(),
    );
  }
}

class SuperBoardFlutterFlowEntitlement {
  const SuperBoardFlutterFlowEntitlement({
    required this.identifier,
    required this.active,
    required this.status,
    required this.productId,
    required this.expirationIso,
  });

  final String identifier;
  final bool active;
  final String status;
  final String productId;
  final String expirationIso;

  factory SuperBoardFlutterFlowEntitlement.fromSuperBoard(
    SuperBoardEntitlementInfo value,
  ) {
    return SuperBoardFlutterFlowEntitlement(
      identifier: value.identifier,
      active: value.isActive,
      status: value.status,
      productId: value.productId ?? '',
      expirationIso: value.expiresAt?.toIso8601String() ?? '',
    );
  }
}
