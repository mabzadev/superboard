export const PRODUCT_TYPES = [
  "subscription",
  "non_consumable",
  "consumable",
] as const;
export const PRODUCT_STATUSES = ["draft", "active", "archived"] as const;
export const STORES = ["apple", "google", "stripe", "manual"] as const;
export const ENVIRONMENTS = ["sandbox", "production"] as const;
export const PURCHASE_STATUSES = [
  "pending",
  "active",
  "expired",
  "cancelled",
  "refunded",
  "failed",
] as const;
export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "grace_period",
  "paused",
  "expired",
  "cancelled",
  "refunded",
] as const;
export const REFUND_STATUSES = [
  "requested",
  "processing",
  "completed",
  "rejected",
  "cancelled",
] as const;

export type ProductType = (typeof PRODUCT_TYPES)[number];
export type Store = (typeof STORES)[number];
export type StoreEnvironment = (typeof ENVIRONMENTS)[number];

export type ResolveOfferingRequest = {
  placement: string;
  customer_id?: string;
  platform?: string;
};

export type ProductInput = {
  identifier: string;
  display_name: string;
  description: string | null;
  product_type: ProductType;
  status: (typeof PRODUCT_STATUSES)[number];
};

export type PackageInput = {
  identifier: string;
  display_name: string;
  description: string | null;
  product_id: string | null;
  position: number;
  active: boolean;
};

export type OfferingInput = {
  identifier: string;
  display_name: string;
  description: string | null;
  placement: string;
  priority: number;
  active: boolean;
  package_ids: string[];
};

export type EntitlementInput = {
  identifier: string;
  display_name: string;
  description: string | null;
  active: boolean;
  product_ids: string[];
};

export function parseResolveOffering(value: unknown): ResolveOfferingRequest {
  const body = record(value);
  return {
    placement: requiredText(body.placement, "placement"),
    customer_id: optionalText(body.customer_id) ?? undefined,
    platform: optionalText(body.platform) ?? undefined,
  };
}

export function parseProduct(value: unknown): ProductInput {
  const body = record(value);
  return {
    identifier: identifier(body.identifier, "identifier"),
    display_name: requiredText(body.display_name, "display_name"),
    description: optionalText(body.description),
    product_type: choice(body.product_type, "product_type", PRODUCT_TYPES),
    status: choice(body.status ?? "active", "status", PRODUCT_STATUSES),
  };
}

export function parsePackage(value: unknown): PackageInput {
  const body = record(value);
  return {
    identifier: identifier(body.identifier, "identifier"),
    display_name: requiredText(body.display_name, "display_name"),
    description: optionalText(body.description),
    product_id: optionalText(body.product_id),
    position: integer(body.position ?? 0, "position", -100_000, 100_000),
    active: boolean(body.active, true),
  };
}

export function parseOffering(value: unknown): OfferingInput {
  const body = record(value);
  return {
    identifier: identifier(body.identifier, "identifier"),
    display_name: requiredText(body.display_name, "display_name"),
    description: optionalText(body.description),
    placement: identifier(body.placement, "placement"),
    priority: integer(body.priority ?? 0, "priority", -100_000, 100_000),
    active: boolean(body.active, false),
    package_ids: stringArray(body.package_ids, "package_ids", 100),
  };
}

export function parseEntitlement(value: unknown): EntitlementInput {
  const body = record(value);
  return {
    identifier: identifier(body.identifier, "identifier"),
    display_name: requiredText(body.display_name, "display_name"),
    description: optionalText(body.description),
    active: boolean(body.active, true),
    product_ids: stringArray(body.product_ids, "product_ids", 100),
  };
}

export function parsePurchase(value: unknown) {
  const body = record(value);
  return {
    financial_customer_id: requiredText(
      body.financial_customer_id,
      "financial_customer_id",
    ),
    product_id: requiredText(body.product_id, "product_id"),
    store: choice(body.store, "store", STORES),
    environment: choice(body.environment, "environment", ENVIRONMENTS),
    external_transaction_id: requiredText(
      body.external_transaction_id,
      "external_transaction_id",
    ),
    original_transaction_id:
      optionalText(body.original_transaction_id) ??
      requiredText(body.external_transaction_id, "external_transaction_id"),
    status: choice(body.status ?? "active", "status", PURCHASE_STATUSES),
    purchased_at: isoDate(
      body.purchased_at ?? new Date().toISOString(),
      "purchased_at",
    ),
    expires_at:
      body.expires_at == null ? null : isoDate(body.expires_at, "expires_at"),
    purchased_price_micros: integer(
      body.purchased_price_micros ?? 0,
      "purchased_price_micros",
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    currency: currency(body.currency),
    payload: jsonObject(body.payload ?? {}, "payload"),
  };
}

export function parseRefund(value: unknown) {
  const body = record(value);
  return {
    external_refund_id: optionalText(body.external_refund_id),
    status: choice(body.status ?? "requested", "status", REFUND_STATUSES),
    amount_micros: integer(
      body.amount_micros ?? 0,
      "amount_micros",
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    currency: currency(body.currency),
    reason: optionalText(body.reason, 2_000),
    requested_at: isoDate(
      body.requested_at ?? new Date().toISOString(),
      "requested_at",
    ),
    completed_at:
      body.completed_at == null
        ? null
        : isoDate(body.completed_at, "completed_at"),
    metadata: jsonObject(body.metadata ?? {}, "metadata"),
  };
}

export function parseSubscriptionUpdate(value: unknown) {
  const body = record(value);
  return {
    status: choice(body.status, "status", SUBSCRIPTION_STATUSES),
    current_period_started_at:
      body.current_period_started_at == null
        ? null
        : isoDate(body.current_period_started_at, "current_period_started_at"),
    current_period_ends_at:
      body.current_period_ends_at == null
        ? null
        : isoDate(body.current_period_ends_at, "current_period_ends_at"),
    auto_renew: boolean(body.auto_renew, true),
    cancelled_at:
      body.cancelled_at == null
        ? null
        : isoDate(body.cancelled_at, "cancelled_at"),
  };
}

export function parseStoreSync(value: unknown) {
  const body = record(value);
  const entries = Array.isArray(body.products) ? body.products : [];
  if (entries.length > 1_000)
    throw validationError(
      "products_too_many",
      "products is limited to 1000 items",
    );
  return {
    store: choice(body.store, "store", STORES),
    environment: choice(body.environment, "environment", ENVIRONMENTS),
    complete_catalog: boolean(body.complete_catalog, false),
    products: entries.map((entry, index) => {
      const item = record(entry, `products[${index}]`);
      return {
        store_product_id: requiredText(
          item.store_product_id,
          `products[${index}].store_product_id`,
        ),
        identifier: identifier(
          item.identifier,
          `products[${index}].identifier`,
        ),
        display_name: requiredText(
          item.display_name,
          `products[${index}].display_name`,
        ),
        description: optionalText(item.description),
        product_type: choice(
          item.product_type,
          `products[${index}].product_type`,
          PRODUCT_TYPES,
        ),
        title: optionalText(item.title),
        price_micros:
          item.price_micros == null
            ? null
            : integer(
                item.price_micros,
                `products[${index}].price_micros`,
                0,
                Number.MAX_SAFE_INTEGER,
              ),
        currency: currency(item.currency),
        billing_period: optionalText(item.billing_period),
        trial_period: optionalText(item.trial_period),
        metadata: jsonObject(
          item.metadata ?? {},
          `products[${index}].metadata`,
        ),
      };
    }),
  };
}

export function record(value: unknown, name = "body"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw validationError("object_required", `${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function requiredText(value: unknown, name: string, max = 255): string {
  if (typeof value !== "string")
    throw validationError(`${name}_required`, `${name} is required`);
  const result = value.trim();
  if (!result || result.length > max)
    throw validationError(
      `${name}_invalid`,
      `${name} must contain 1 to ${max} characters`,
    );
  return result;
}

export function optionalText(value: unknown, max = 255): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string")
    throw validationError("text_invalid", "Text values must be strings");
  const result = value.trim();
  if (result.length > max)
    throw validationError(
      "text_too_long",
      `Text is limited to ${max} characters`,
    );
  return result || null;
}

export function choice<const T extends readonly string[]>(
  value: unknown,
  name: string,
  values: T,
): T[number] {
  const result = String(value ?? "");
  if (!values.includes(result))
    throw validationError(
      `${name}_invalid`,
      `${name} must be one of ${values.join(", ")}`,
    );
  return result as T[number];
}

export function boolean(value: unknown, fallback: boolean): boolean {
  if (value == null) return fallback;
  if (typeof value !== "boolean")
    throw validationError("boolean_invalid", "Boolean value expected");
  return value;
}

export function integer(
  value: unknown,
  name: string,
  min: number,
  max: number,
): number {
  const result = typeof value === "number" ? value : Number.NaN;
  if (!Number.isSafeInteger(result) || result < min || result > max)
    throw validationError(
      `${name}_invalid`,
      `${name} must be an integer between ${min} and ${max}`,
    );
  return result;
}

export function stringArray(
  value: unknown,
  name: string,
  max: number,
): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > max)
    throw validationError(
      `${name}_invalid`,
      `${name} must be an array of at most ${max} identifiers`,
    );
  return [...new Set(value.map((item) => requiredText(item, name)))];
}

export function isoDate(value: unknown, name: string): string {
  const text = requiredText(value, name);
  const date = new Date(text);
  if (Number.isNaN(date.getTime()))
    throw validationError(
      `${name}_invalid`,
      `${name} must be an ISO-8601 date`,
    );
  return date.toISOString();
}

export function currency(value: unknown): string | null {
  if (value == null || value === "") return null;
  const result = requiredText(value, "currency", 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(result))
    throw validationError(
      "currency_invalid",
      "currency must be an ISO-4217 code",
    );
  return result;
}

export function jsonObject(
  value: unknown,
  name: string,
): Record<string, unknown> {
  return record(value, name);
}

export function validationError(
  code: string,
  message: string,
  status = 422,
): Error {
  return Object.assign(new Error(message), { code, status });
}

function identifier(value: unknown, name: string): string {
  const result = requiredText(value, name, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(result))
    throw validationError(
      `${name}_invalid`,
      `${name} contains unsupported characters`,
    );
  return result;
}
