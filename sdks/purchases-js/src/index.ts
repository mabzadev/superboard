export type OpenGrowPurchasesOptions = {
  projectKey: string;
  appUserId?: string;
  identityToken?: string;
  baseUrl?: string;
  domain?: string;
  appVersion?: string;
  buildNumber?: string;
  campaign?: string;
};

export type OpenGrowPackage = {
  identifier: string;
  package_type: string;
  product: {
    id: string;
    store_product_id: string;
    product_type: string;
    store: string;
    metadata?: Record<string, unknown>;
  };
};

export type OpenGrowOffering = {
  identifier: string;
  display_name?: string;
  description?: string;
  packages: OpenGrowPackage[];
};

export type OpenGrowPurchaseConfiguration = {
  schema_version: number;
  customer_id: string;
  environment: "sandbox" | "production";
  placement: { id: string; identifier: string; display_name: string };
  offering: OpenGrowOffering | null;
  offerings: Record<string, OpenGrowOffering>;
  paywall: {
    id: string;
    identifier: string;
    version_id: string;
    version: number;
    configuration: Record<string, unknown>;
    localizations: Record<string, unknown>;
  } | null;
  experiment_assignment: Record<string, unknown> | null;
  fetched_at: string;
};

export type OpenGrowCertificationResult = {
  id: string;
  run_id: string;
  check_key: string;
  outcome: "passed" | "failed";
  evidence_sha256: string;
  observed_at: string;
  received_at: string;
  duplicate: boolean;
};

export class OpenGrowPurchasesError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "OpenGrowPurchasesError";
  }
}

const randomId = () => globalThis.crypto?.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export class OpenGrowPurchases {
  private readonly baseUrl: string;
  private readonly projectKey: string;
  private readonly domain: string;
  private readonly appVersion: string;
  private readonly buildNumber: string;
  private readonly campaign: string;
  private appUserId: string;
  private identityToken?: string;

  constructor(options: OpenGrowPurchasesOptions) {
    if (!options.projectKey.trim()) throw new Error("projectKey is required");
    this.projectKey = options.projectKey;
    this.baseUrl = (options.baseUrl ?? "https://sdk.vocostar.com/purchases/v2").replace(/\/+$/, "");
    this.domain = options.domain ?? globalThis.location?.hostname ?? "localhost";
    this.appVersion = options.appVersion ?? "";
    this.buildNumber = options.buildNumber ?? "";
    this.campaign = options.campaign ?? "";
    this.identityToken = options.identityToken;
    const stored = globalThis.localStorage?.getItem("opengrow.purchases.anonymous_id");
    this.appUserId = options.appUserId || stored || `$opengrow_anon_${randomId()}`;
    if (!options.appUserId && !stored) {
      globalThis.localStorage?.setItem("opengrow.purchases.anonymous_id", this.appUserId);
    }
  }

  setIdentityToken(token?: string) {
    this.identityToken = token;
  }

  async getConfiguration(placement = "default"): Promise<OpenGrowPurchaseConfiguration> {
    return this.request(`/configuration?placement=${encodeURIComponent(placement)}`);
  }

  async getCustomerInfo(): Promise<Record<string, unknown>> {
    return this.request("/customer-info");
  }

  async getCustomerCenter(): Promise<Record<string, unknown>> {
    return this.request("/customer-center");
  }

  async getVirtualCurrencies(): Promise<Record<string, unknown>> {
    return this.request("/virtual-currencies");
  }

  async track(
    type: string,
    configuration: OpenGrowPurchaseConfiguration,
    details: { packageIdentifier?: string; metadata?: Record<string, unknown> } = {},
  ): Promise<void> {
    await this.request("/events", {
      method: "POST",
      body: {
        id: randomId(),
        type,
        paywall_id: configuration.paywall?.id,
        paywall_version_id: configuration.paywall?.version_id,
        placement: configuration.placement.identifier,
        experiment_id: configuration.experiment_assignment?.experiment_id,
        variant_id: configuration.experiment_assignment?.variant_id,
        package_identifier: details.packageIdentifier,
        metadata: details.metadata ?? {},
        occurred_at: new Date().toISOString(),
      },
    });
  }

  async createCheckoutSession(input: {
    packageIdentifier: string;
    offeringIdentifier?: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }> {
    return this.request("/checkout-sessions", {
      method: "POST",
      idempotencyKey: randomId(),
      body: {
        package_identifier: input.packageIdentifier,
        offering_identifier: input.offeringIdentifier,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      },
    });
  }

  async createPortalSession(returnUrl: string): Promise<{ url: string }> {
    return this.request("/portal-sessions", {
      method: "POST",
      body: { return_url: returnUrl },
    });
  }

  async redeem(code: string): Promise<Record<string, unknown>> {
    return this.request("/redemptions", {
      method: "POST",
      idempotencyKey: randomId(),
      body: { code },
    });
  }

  async submitCertificationResult(input: {
    runId: string;
    challenge: string;
    checkKey: string;
    passed: boolean;
    assertions: Record<string, boolean | number | string | null>;
    deviceModel?: string;
    osVersion?: string;
    resultId?: string;
    observedAt?: string;
  }): Promise<OpenGrowCertificationResult> {
    const response = await this.request<{ data: OpenGrowCertificationResult }>(
      "/certification/device-results",
      {
        method: "POST",
        body: {
          id: input.resultId ?? randomId(),
          run_id: input.runId,
          challenge: input.challenge,
          check_key: input.checkKey,
          outcome: input.passed ? "passed" : "failed",
          build_number: this.buildNumber,
          device_model: input.deviceModel,
          os_version: input.osVersion,
          assertions: input.assertions,
          observed_at: input.observedAt ?? new Date().toISOString(),
        },
      },
    );
    return response.data;
  }

  private async request<T>(
    path: string,
    options: { method?: string; body?: unknown; idempotencyKey?: string } = {},
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        "PROJECT-KEY": this.projectKey,
        "PLATFORM": "web",
        "IDENTIFIER": this.domain,
        "X-OpenGrow-Anonymous-ID": this.appUserId,
        "X-OpenGrow-SDK-Version": "purchases-js/1.0.0",
        ...(this.appVersion ? { "X-OpenGrow-App-Version": this.appVersion } : {}),
        ...(this.buildNumber ? { "X-OpenGrow-Build-Number": this.buildNumber } : {}),
        ...(this.campaign ? { "X-OpenGrow-Campaign": this.campaign } : {}),
        ...(this.identityToken ? { Authorization: `Bearer ${this.identityToken}` } : {}),
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const payload = await response.json().catch(() => ({})) as {
      error?: { code?: string; message?: string; retryable?: boolean; request_id?: string } | string;
    };
    if (!response.ok) {
      const error = typeof payload.error === "object" ? payload.error : {};
      throw new OpenGrowPurchasesError(
        error.message ?? String(payload.error || `HTTP ${response.status}`),
        error.code ?? "purchases_request_failed",
        response.status,
        error.retryable === true,
        error.request_id,
      );
    }
    return payload as T;
  }
}
