enum SuperBoardPurchaseOutcome { purchased, cancelled, pending, failed }

class SuperBoardSubscriptionInfo {
  const SuperBoardSubscriptionInfo({
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

  factory SuperBoardSubscriptionInfo.fromJson(Map<String, dynamic> json) {
    return SuperBoardSubscriptionInfo(
      identifier: (json['store_product_id'] ?? json['product_id'] ?? '')
          .toString(),
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

class SuperBoardEntitlementInfo {
  const SuperBoardEntitlementInfo({
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

  factory SuperBoardEntitlementInfo.fromJson(
    String key,
    Map<String, dynamic> json,
  ) {
    return SuperBoardEntitlementInfo(
      identifier: (json['identifier'] ?? key).toString(),
      isActive: json['is_active'] == true,
      status: (json['status'] ?? 'inactive').toString(),
      productId: json['product_id']?.toString(),
      expiresAt: DateTime.tryParse(json['expires_at']?.toString() ?? ''),
      willRenew: json['will_renew'] == true,
    );
  }
}

class SuperBoardCustomerInfo {
  const SuperBoardCustomerInfo({
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
  final Map<String, SuperBoardEntitlementInfo> entitlements;
  final DateTime requestDate;
  final String? signature;
  final Map<String, int> balances;
  final List<SuperBoardSubscriptionInfo> subscriptions;
  final List<String> activeSubscriptions;
  final String? managementUrl;

  bool isEntitled(String identifier) =>
      entitlements[identifier]?.isActive == true;

  factory SuperBoardCustomerInfo.fromJson(Map<String, dynamic> json) {
    final raw =
        (json['entitlements'] as Map?)?.cast<String, dynamic>() ?? const {};
    final balanceJson =
        (json['balances'] as Map?)?.cast<String, dynamic>() ?? const {};
    final subscriptions = (json['subscriptions'] as List? ?? const [])
        .whereType<Map>()
        .map(
          (value) => SuperBoardSubscriptionInfo.fromJson(
            value.cast<String, dynamic>(),
          ),
        )
        .toList();
    return SuperBoardCustomerInfo(
      originalAppUserId: (json['original_app_user_id'] ?? '').toString(),
      customerId: json['customer_id']?.toString(),
      entitlements: raw.map(
        (key, value) => MapEntry(
          key,
          SuperBoardEntitlementInfo.fromJson(
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
      managementUrl:
          json['management_url']?.toString() ??
          subscriptions
              .map((value) => value.managementUrl)
              .whereType<String>()
              .firstOrNull,
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

class SuperBoardStoreProduct {
  const SuperBoardStoreProduct({
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

  SuperBoardStoreProduct copyWithPrice({
    String? title,
    String? description,
    String? localizedPrice,
    String? currencyCode,
    double? rawPrice,
  }) {
    return SuperBoardStoreProduct(
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

class SuperBoardPackage {
  const SuperBoardPackage({
    required this.identifier,
    required this.packageType,
    required this.product,
  });
  final String identifier;
  final String packageType;
  final SuperBoardStoreProduct product;
}

class SuperBoardOffering {
  const SuperBoardOffering({
    required this.identifier,
    required this.packages,
    this.displayName,
    this.description,
  });
  final String identifier;
  final String? displayName;
  final String? description;
  final List<SuperBoardPackage> packages;
}

class SuperBoardOfferings {
  const SuperBoardOfferings({required this.all, this.current});
  final SuperBoardOffering? current;
  final Map<String, SuperBoardOffering> all;
}

class SuperBoardPurchaseResult {
  const SuperBoardPurchaseResult(
    this.outcome, {
    this.customerInfo,
    this.error,
    this.code = '',
    this.retryable = false,
    this.productIdentifier,
    this.transactionIdentifier,
    this.requestId,
  });
  final SuperBoardPurchaseOutcome outcome;
  final SuperBoardCustomerInfo? customerInfo;
  final String? error;
  final String code;
  final bool retryable;
  final String? productIdentifier;
  final String? transactionIdentifier;
  final String? requestId;

  Map<String, dynamic> toJson() => {
    'state': outcome.name,
    'code': code,
    'retryable': retryable,
    'message': error,
    'product_id': productIdentifier,
    'transaction_id': transactionIdentifier,
    'request_id': requestId,
    'customer_info': customerInfo?.toJson(),
  };
}

class SuperBoardCertificationResult {
  const SuperBoardCertificationResult({
    required this.id,
    required this.runId,
    required this.checkKey,
    required this.outcome,
    required this.evidenceSha256,
    required this.observedAt,
    required this.receivedAt,
    required this.duplicate,
  });

  final String id;
  final String runId;
  final String checkKey;
  final String outcome;
  final String evidenceSha256;
  final DateTime observedAt;
  final DateTime receivedAt;
  final bool duplicate;

  factory SuperBoardCertificationResult.fromJson(Map<String, dynamic> json) =>
      SuperBoardCertificationResult(
        id: (json['id'] ?? '').toString(),
        runId: (json['run_id'] ?? '').toString(),
        checkKey: (json['check_key'] ?? '').toString(),
        outcome: (json['outcome'] ?? '').toString(),
        evidenceSha256: (json['evidence_sha256'] ?? '').toString(),
        observedAt:
            DateTime.tryParse(json['observed_at']?.toString() ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
        receivedAt:
            DateTime.tryParse(json['received_at']?.toString() ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
        duplicate: json['duplicate'] == true,
      );

  Map<String, dynamic> toJson() => {
    'id': id,
    'run_id': runId,
    'check_key': checkKey,
    'outcome': outcome,
    'evidence_sha256': evidenceSha256,
    'observed_at': observedAt.toIso8601String(),
    'received_at': receivedAt.toIso8601String(),
    'duplicate': duplicate,
  };
}

class SuperBoardPlacement {
  const SuperBoardPlacement({
    required this.identifier,
    required this.displayName,
  });
  final String identifier;
  final String displayName;

  factory SuperBoardPlacement.fromJson(Map<String, dynamic> json) =>
      SuperBoardPlacement(
        identifier: (json['identifier'] ?? 'default').toString(),
        displayName: (json['display_name'] ?? json['identifier'] ?? 'Default')
            .toString(),
      );
}

class SuperBoardExperimentAssignment {
  const SuperBoardExperimentAssignment({
    required this.experimentId,
    required this.variantId,
    required this.variantIdentifier,
    required this.isControl,
  });
  final String experimentId;
  final String variantId;
  final String variantIdentifier;
  final bool isControl;

  factory SuperBoardExperimentAssignment.fromJson(Map<String, dynamic> json) =>
      SuperBoardExperimentAssignment(
        experimentId: (json['experiment_id'] ?? '').toString(),
        variantId: (json['variant_id'] ?? '').toString(),
        variantIdentifier: (json['identifier'] ?? '').toString(),
        isControl: json['is_control'] == true || json['is_control'] == 1,
      );
}

class SuperBoardPaywallConfiguration {
  const SuperBoardPaywallConfiguration({
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

  factory SuperBoardPaywallConfiguration.fromJson(
    Map<String, dynamic> json,
  ) => SuperBoardPaywallConfiguration(
    id: (json['id'] ?? '').toString(),
    identifier: (json['identifier'] ?? '').toString(),
    versionId: (json['version_id'] ?? '').toString(),
    version: (json['version'] as num?)?.toInt() ?? 0,
    configuration:
        (json['configuration'] as Map?)?.cast<String, dynamic>() ?? const {},
    localizations:
        (json['localizations'] as Map?)?.cast<String, dynamic>() ?? const {},
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

class SuperBoardPurchaseConfiguration {
  const SuperBoardPurchaseConfiguration({
    required this.placement,
    required this.offerings,
    required this.fetchedAt,
    this.offering,
    this.paywall,
    this.experimentAssignment,
    this.fromCache = false,
  });

  final SuperBoardPlacement placement;
  final SuperBoardOfferings offerings;
  final SuperBoardOffering? offering;
  final SuperBoardPaywallConfiguration? paywall;
  final SuperBoardExperimentAssignment? experimentAssignment;
  final DateTime fetchedAt;
  final bool fromCache;
}

class SuperBoardVirtualCurrency {
  const SuperBoardVirtualCurrency({
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

  factory SuperBoardVirtualCurrency.fromJson(Map<String, dynamic> json) =>
      SuperBoardVirtualCurrency(
        code: (json['code'] ?? '').toString(),
        name: (json['name'] ?? json['code'] ?? '').toString(),
        balance: (json['balance'] as num?)?.toInt() ?? 0,
        description: json['description']?.toString(),
        icon: json['icon']?.toString(),
      );
}

class SuperBoardVirtualCurrencies {
  const SuperBoardVirtualCurrencies({
    required this.all,
    required this.fetchedAt,
  });
  final Map<String, SuperBoardVirtualCurrency> all;
  final DateTime fetchedAt;
}

// OpenGrow 2.x source compatibility. These aliases intentionally live in the
// canonical library so one import supports an incremental app migration.
@Deprecated('Use SuperBoardPurchaseOutcome.')
typedef OpenGrowPurchaseOutcome = SuperBoardPurchaseOutcome;
@Deprecated('Use SuperBoardSubscriptionInfo.')
typedef OpenGrowSubscriptionInfo = SuperBoardSubscriptionInfo;
@Deprecated('Use SuperBoardEntitlementInfo.')
typedef OpenGrowEntitlementInfo = SuperBoardEntitlementInfo;
@Deprecated('Use SuperBoardCustomerInfo.')
typedef OpenGrowCustomerInfo = SuperBoardCustomerInfo;
@Deprecated('Use SuperBoardStoreProduct.')
typedef OpenGrowStoreProduct = SuperBoardStoreProduct;
@Deprecated('Use SuperBoardPackage.')
typedef OpenGrowPackage = SuperBoardPackage;
@Deprecated('Use SuperBoardOffering.')
typedef OpenGrowOffering = SuperBoardOffering;
@Deprecated('Use SuperBoardOfferings.')
typedef OpenGrowOfferings = SuperBoardOfferings;
@Deprecated('Use SuperBoardPurchaseResult.')
typedef OpenGrowPurchaseResult = SuperBoardPurchaseResult;
@Deprecated('Use SuperBoardCertificationResult.')
typedef OpenGrowCertificationResult = SuperBoardCertificationResult;
@Deprecated('Use SuperBoardPlacement.')
typedef OpenGrowPlacement = SuperBoardPlacement;
@Deprecated('Use SuperBoardExperimentAssignment.')
typedef OpenGrowExperimentAssignment = SuperBoardExperimentAssignment;
@Deprecated('Use SuperBoardPaywallConfiguration.')
typedef OpenGrowPaywallConfiguration = SuperBoardPaywallConfiguration;
@Deprecated('Use SuperBoardPurchaseConfiguration.')
typedef OpenGrowPurchaseConfiguration = SuperBoardPurchaseConfiguration;
@Deprecated('Use SuperBoardVirtualCurrency.')
typedef OpenGrowVirtualCurrency = SuperBoardVirtualCurrency;
@Deprecated('Use SuperBoardVirtualCurrencies.')
typedef OpenGrowVirtualCurrencies = SuperBoardVirtualCurrencies;
