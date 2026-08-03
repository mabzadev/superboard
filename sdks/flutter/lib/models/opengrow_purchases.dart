enum OpenGrowPurchaseOutcome { purchased, cancelled, pending, failed }

class OpenGrowSubscriptionInfo {
  const OpenGrowSubscriptionInfo({
    required this.identifier,
    required this.store,
    required this.environment,
    required this.status,
    required this.periodType,
    required this.willRenew,
    this.startedAt,
    this.expiresAt,
    this.managementUrl,
  });

  final String identifier;
  final String store;
  final String environment;
  final String status;
  final String periodType;
  final bool willRenew;
  final DateTime? startedAt;
  final DateTime? expiresAt;
  final String? managementUrl;

  factory OpenGrowSubscriptionInfo.fromJson(Map<String, dynamic> json) {
    return OpenGrowSubscriptionInfo(
      identifier: (json['store_product_id'] ?? json['product_id'] ?? '').toString(),
      store: (json['store'] ?? '').toString(),
      environment: (json['environment'] ?? '').toString(),
      status: (json['status'] ?? 'inactive').toString(),
      periodType: (json['period_type'] ?? 'normal').toString(),
      willRenew: json['will_renew'] == true || json['will_renew'] == 1,
      startedAt: DateTime.tryParse(json['starts_at']?.toString() ?? ''),
      expiresAt: DateTime.tryParse(json['expires_at']?.toString() ?? ''),
      managementUrl: json['management_url']?.toString(),
    );
  }

  Map<String, dynamic> toJson() => {
    'store_product_id': identifier,
    'store': store,
    'environment': environment,
    'status': status,
    'period_type': periodType,
    'will_renew': willRenew,
    'starts_at': startedAt?.toIso8601String(),
    'expires_at': expiresAt?.toIso8601String(),
    'management_url': managementUrl,
  };
}

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
    this.subscriptions = const [],
    this.activeSubscriptions = const [],
    this.managementUrl,
  });

  final String originalAppUserId;
  final String? customerId;
  final Map<String, OpenGrowEntitlementInfo> entitlements;
  final DateTime requestDate;
  final String? signature;
  final Map<String, int> balances;
  final List<OpenGrowSubscriptionInfo> subscriptions;
  final List<String> activeSubscriptions;
  final String? managementUrl;

  bool isEntitled(String identifier) =>
      entitlements[identifier]?.isActive == true;

  factory OpenGrowCustomerInfo.fromJson(Map<String, dynamic> json) {
    final raw =
        (json['entitlements'] as Map?)?.cast<String, dynamic>() ?? const {};
    final balanceJson =
        (json['balances'] as Map?)?.cast<String, dynamic>() ?? const {};
    final subscriptions = (json['subscriptions'] as List? ?? const [])
        .whereType<Map>()
        .map((value) => OpenGrowSubscriptionInfo.fromJson(value.cast<String, dynamic>()))
        .toList();
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
      subscriptions: subscriptions,
      activeSubscriptions: (json['active_subscriptions'] as List? ?? const [])
          .map((value) => value.toString())
          .toList(),
      managementUrl: json['management_url']?.toString() ??
          subscriptions.map((value) => value.managementUrl).whereType<String>().firstOrNull,
    );
  }

  Map<String, dynamic> toJson() => {
    'original_app_user_id': originalAppUserId,
    'customer_id': customerId,
    'request_date': requestDate.toIso8601String(),
    'signature': signature,
    'balances': balances,
    'subscriptions': subscriptions.map((value) => value.toJson()).toList(),
    'active_subscriptions': activeSubscriptions,
    'management_url': managementUrl,
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

class OpenGrowPlacement {
  const OpenGrowPlacement({
    required this.identifier,
    required this.displayName,
  });
  final String identifier;
  final String displayName;

  factory OpenGrowPlacement.fromJson(Map<String, dynamic> json) =>
      OpenGrowPlacement(
        identifier: (json['identifier'] ?? 'default').toString(),
        displayName: (json['display_name'] ?? json['identifier'] ?? 'Default').toString(),
      );
}

class OpenGrowExperimentAssignment {
  const OpenGrowExperimentAssignment({
    required this.experimentId,
    required this.variantId,
    required this.variantIdentifier,
    required this.isControl,
  });
  final String experimentId;
  final String variantId;
  final String variantIdentifier;
  final bool isControl;

  factory OpenGrowExperimentAssignment.fromJson(Map<String, dynamic> json) =>
      OpenGrowExperimentAssignment(
        experimentId: (json['experiment_id'] ?? '').toString(),
        variantId: (json['variant_id'] ?? '').toString(),
        variantIdentifier: (json['identifier'] ?? '').toString(),
        isControl: json['is_control'] == true || json['is_control'] == 1,
      );
}

class OpenGrowPaywallConfiguration {
  const OpenGrowPaywallConfiguration({
    required this.id,
    required this.identifier,
    required this.versionId,
    required this.version,
    required this.configuration,
    required this.localizations,
  });

  final String id;
  final String identifier;
  final String versionId;
  final int version;
  final Map<String, dynamic> configuration;
  final Map<String, dynamic> localizations;

  factory OpenGrowPaywallConfiguration.fromJson(Map<String, dynamic> json) =>
      OpenGrowPaywallConfiguration(
        id: (json['id'] ?? '').toString(),
        identifier: (json['identifier'] ?? '').toString(),
        versionId: (json['version_id'] ?? '').toString(),
        version: (json['version'] as num?)?.toInt() ?? 0,
        configuration: (json['configuration'] as Map?)?.cast<String, dynamic>() ?? const {},
        localizations: (json['localizations'] as Map?)?.cast<String, dynamic>() ?? const {},
      );

  Map<String, dynamic> toJson() => {
    'id': id,
    'identifier': identifier,
    'version_id': versionId,
    'version': version,
    'configuration': configuration,
    'localizations': localizations,
  };
}

class OpenGrowPurchaseConfiguration {
  const OpenGrowPurchaseConfiguration({
    required this.placement,
    required this.offerings,
    required this.fetchedAt,
    this.offering,
    this.paywall,
    this.experimentAssignment,
    this.fromCache = false,
  });

  final OpenGrowPlacement placement;
  final OpenGrowOfferings offerings;
  final OpenGrowOffering? offering;
  final OpenGrowPaywallConfiguration? paywall;
  final OpenGrowExperimentAssignment? experimentAssignment;
  final DateTime fetchedAt;
  final bool fromCache;
}

class OpenGrowVirtualCurrency {
  const OpenGrowVirtualCurrency({
    required this.code,
    required this.name,
    required this.balance,
    this.description,
    this.icon,
  });
  final String code;
  final String name;
  final int balance;
  final String? description;
  final String? icon;

  factory OpenGrowVirtualCurrency.fromJson(Map<String, dynamic> json) =>
      OpenGrowVirtualCurrency(
        code: (json['code'] ?? '').toString(),
        name: (json['name'] ?? json['code'] ?? '').toString(),
        balance: (json['balance'] as num?)?.toInt() ?? 0,
        description: json['description']?.toString(),
        icon: json['icon']?.toString(),
      );
}

class OpenGrowVirtualCurrencies {
  const OpenGrowVirtualCurrencies({required this.all, required this.fetchedAt});
  final Map<String, OpenGrowVirtualCurrency> all;
  final DateTime fetchedAt;
}
