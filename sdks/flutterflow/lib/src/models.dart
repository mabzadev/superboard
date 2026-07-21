import 'package:opengrow_flutter/models/opengrow_purchases.dart';

class OpenGrowFlutterFlowPackage {
  const OpenGrowFlutterFlowPackage({
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

  factory OpenGrowFlutterFlowPackage.fromOpenGrow(OpenGrowPackage package) {
    return OpenGrowFlutterFlowPackage(
      identifier: package.identifier,
      productId: package.product.identifier,
      productType: package.product.type,
      price: package.product.localizedPrice ?? '',
      title: package.product.title ?? package.identifier,
    );
  }
}

class OpenGrowFlutterFlowOffering {
  const OpenGrowFlutterFlowOffering({
    required this.identifier,
    required this.title,
    required this.description,
    required this.packages,
  });

  final String identifier;
  final String title;
  final String description;
  final List<OpenGrowFlutterFlowPackage> packages;

  Map<String, dynamic> toMap() => {
    'identifier': identifier,
    'title': title,
    'description': description,
    'packages': packages.map((value) => value.toMap()).toList(),
  };

  factory OpenGrowFlutterFlowOffering.fromOpenGrow(OpenGrowOffering offering) {
    return OpenGrowFlutterFlowOffering(
      identifier: offering.identifier,
      title: offering.displayName ?? offering.identifier,
      description: offering.description ?? '',
      packages: offering.packages
          .map(OpenGrowFlutterFlowPackage.fromOpenGrow)
          .toList(),
    );
  }
}

class OpenGrowFlutterFlowEntitlement {
  const OpenGrowFlutterFlowEntitlement({
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

  factory OpenGrowFlutterFlowEntitlement.fromOpenGrow(OpenGrowEntitlementInfo value) {
    return OpenGrowFlutterFlowEntitlement(
      identifier: value.identifier,
      active: value.isActive,
      status: value.status,
      productId: value.productId ?? '',
      expirationIso: value.expiresAt?.toIso8601String() ?? '',
    );
  }
}
