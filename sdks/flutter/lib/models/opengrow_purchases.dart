enum OpenGrowPurchaseOutcome { purchased, cancelled, pending, failed }

class OpenGrowEntitlementInfo {
  const OpenGrowEntitlementInfo({
    required this.identifier,
    required this.isActive,
    required this.status,
    this.productId,
    this.expiresAt,
    this.willRenew = false,
  });

  final String identifier;
  final bool isActive;
  final String status;
  final String? productId;
  final DateTime? expiresAt;
  final bool willRenew;

  factory OpenGrowEntitlementInfo.fromJson(String key, Map<String, dynamic> json) {
    return OpenGrowEntitlementInfo(
      identifier: (json['identifier'] ?? key).toString(),
      isActive: json['is_active'] == true,
      status: (json['status'] ?? 'inactive').toString(),
      productId: json['product_id']?.toString(),
      expiresAt: DateTime.tryParse(json['expires_at']?.toString() ?? ''),
      willRenew: json['will_renew'] == true,
    );
  }
}

class OpenGrowCustomerInfo {
  const OpenGrowCustomerInfo({
    required this.originalAppUserId,
    required this.entitlements,
    required this.requestDate,
    this.customerId,
    this.signature,
    this.balances = const {},
  });

  final String originalAppUserId;
  final String? customerId;
  final Map<String, OpenGrowEntitlementInfo> entitlements;
  final DateTime requestDate;
  final String? signature;
  final Map<String, int> balances;

  bool isEntitled(String identifier) =>
      entitlements[identifier]?.isActive == true;

  factory OpenGrowCustomerInfo.fromJson(Map<String, dynamic> json) {
    final raw =
        (json['entitlements'] as Map?)?.cast<String, dynamic>() ?? const {};
    final balanceJson =
        (json['balances'] as Map?)?.cast<String, dynamic>() ?? const {};
    return OpenGrowCustomerInfo(
      originalAppUserId: (json['original_app_user_id'] ?? '').toString(),
      customerId: json['customer_id']?.toString(),
      entitlements: raw.map(
        (key, value) => MapEntry(
          key,
          OpenGrowEntitlementInfo.fromJson(
            key,
            (value as Map).cast<String, dynamic>(),
          ),
        ),
      ),
      requestDate:
          DateTime.tryParse(json['request_date']?.toString() ?? '') ??
          DateTime.now().toUtc(),
      signature: json['signature']?.toString(),
      balances: balanceJson.map(
        (key, value) => MapEntry(key, (value as num?)?.toInt() ?? 0),
      ),
    );
  }

  Map<String, dynamic> toJson() => {
    'original_app_user_id': originalAppUserId,
    'customer_id': customerId,
    'request_date': requestDate.toIso8601String(),
    'signature': signature,
    'balances': balances,
    'entitlements': entitlements.map(
      (key, value) => MapEntry(key, {
        'identifier': value.identifier,
        'is_active': value.isActive,
        'status': value.status,
        'product_id': value.productId,
        'expires_at': value.expiresAt?.toIso8601String(),
        'will_renew': value.willRenew,
      }),
    ),
  };
}

class OpenGrowStoreProduct {
  const OpenGrowStoreProduct({
    required this.identifier,
    required this.type,
    this.title,
    this.description,
    this.localizedPrice,
    this.currencyCode,
    this.rawPrice,
  });

  final String identifier;
  final String type;
  final String? title;
  final String? description;
  final String? localizedPrice;
  final String? currencyCode;
  final double? rawPrice;

  OpenGrowStoreProduct copyWithPrice({
    String? title,
    String? description,
    String? localizedPrice,
    String? currencyCode,
    double? rawPrice,
  }) {
    return OpenGrowStoreProduct(
      identifier: identifier,
      type: type,
      title: title ?? this.title,
      description: description ?? this.description,
      localizedPrice: localizedPrice ?? this.localizedPrice,
      currencyCode: currencyCode ?? this.currencyCode,
      rawPrice: rawPrice ?? this.rawPrice,
    );
  }
}

class OpenGrowPackage {
  const OpenGrowPackage({
    required this.identifier,
    required this.packageType,
    required this.product,
  });
  final String identifier;
  final String packageType;
  final OpenGrowStoreProduct product;
}

class OpenGrowOffering {
  const OpenGrowOffering({
    required this.identifier,
    required this.packages,
    this.displayName,
    this.description,
  });
  final String identifier;
  final String? displayName;
  final String? description;
  final List<OpenGrowPackage> packages;
}

class OpenGrowOfferings {
  const OpenGrowOfferings({required this.all, this.current});
  final OpenGrowOffering? current;
  final Map<String, OpenGrowOffering> all;
}

class OpenGrowPurchaseResult {
  const OpenGrowPurchaseResult(this.outcome, {this.customerInfo, this.error});
  final OpenGrowPurchaseOutcome outcome;
  final OpenGrowCustomerInfo? customerInfo;
  final String? error;
}
