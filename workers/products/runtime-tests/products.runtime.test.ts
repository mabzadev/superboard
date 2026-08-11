import { env } from "cloudflare:workers";
import { SELF } from "cloudflare:test";
import { signProjectContext } from "@superboard/contracts/project-context";
import { describe, expect, it } from "vitest";

const secret = "products-runtime-secret";

describe("Products Worker with D1", () => {
  it("rejects unsigned and tampered gateway contexts", async () => {
    expect(
      (await SELF.fetch("https://products.internal/internal/v1")).status,
    ).toBe(401);
    const headers = await signedHeaders("GET", "/internal/v1");
    headers.set("x-project-id", "12");
    const response = await SELF.fetch("https://products.internal/internal/v1", {
      headers,
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "project_context_signature_invalid" },
    });
    const sdkHeaders = await signedHeaders(
      "POST",
      "/internal/v1/offerings/resolve",
      11,
      0,
      "sdk",
    );
    sdkHeaders.set("content-type", "application/json");
    const sdk = await SELF.fetch(
      "https://products.internal/internal/v1/offerings/resolve",
      { method: "POST", headers: sdkHeaders, body: '{"placement":"main"}' },
    );
    expect(sdk.status).toBe(200);
  });

  it("runs catalog, offering, entitlement, purchase, subscription and refund flows idempotently", async () => {
    const productResponse = await mutate(
      "POST",
      "/internal/v1/catalog/products",
      {
        identifier: "pro.monthly",
        display_name: "Pro Monthly",
        product_type: "subscription",
        status: "active",
      },
      "create-product",
    );
    expect(productResponse.status).toBe(201);
    const product = await data<{ id: string }>(productResponse);

    const replay = await mutate(
      "POST",
      "/internal/v1/catalog/products",
      {
        identifier: "pro.monthly",
        display_name: "Pro Monthly",
        product_type: "subscription",
        status: "active",
      },
      "create-product",
    );
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    expect((await data<{ id: string }>(replay)).id).toBe(product.id);

    const conflict = await mutate(
      "POST",
      "/internal/v1/catalog/products",
      {
        identifier: "different",
        display_name: "Different",
        product_type: "subscription",
        status: "active",
      },
      "create-product",
    );
    expect(conflict.status).toBe(409);
    const duplicateIdentifier = await mutate(
      "POST",
      "/internal/v1/catalog/products",
      {
        identifier: "pro.monthly",
        display_name: "Duplicate",
        product_type: "subscription",
        status: "active",
      },
      "duplicate-product-identifier",
    );
    expect(duplicateIdentifier.status).toBe(409);
    await expect(duplicateIdentifier.json()).resolves.toMatchObject({
      error: { code: "resource_conflict" },
    });

    const packageResponse = await mutate(
      "POST",
      "/internal/v1/packages",
      {
        identifier: "monthly",
        display_name: "Monthly",
        product_id: product.id,
        position: 0,
        active: true,
      },
      "create-package",
    );
    const productPackage = await data<{ id: string }>(packageResponse);

    const offeringResponse = await mutate(
      "POST",
      "/internal/v1/offerings",
      {
        identifier: "default",
        display_name: "Default offering",
        placement: "main",
        active: true,
        priority: 10,
        package_ids: [productPackage.id],
      },
      "create-offering",
    );
    expect(offeringResponse.status).toBe(201);

    const resolved = await request("POST", "/internal/v1/offerings/resolve", {
      placement: "main",
      customer_id: "customer-1",
    });
    expect(resolved.status).toBe(200);
    await expect(resolved.json()).resolves.toMatchObject({
      data: {
        identifier: "default",
        packages: [{ identifier: "monthly", product_id: product.id }],
      },
    });

    const entitlementResponse = await mutate(
      "POST",
      "/internal/v1/entitlements",
      {
        identifier: "pro",
        display_name: "Pro",
        active: true,
        product_ids: [product.id],
      },
      "create-entitlement",
    );
    const entitlement = await data<{ id: string }>(entitlementResponse);

    const purchaseResponse = await mutate(
      "POST",
      "/internal/v1/purchases",
      {
        financial_customer_id: "app-user-1",
        product_id: product.id,
        store: "apple",
        environment: "sandbox",
        external_transaction_id: "apple-tx-1",
        original_transaction_id: "apple-original-1",
        status: "active",
        purchased_at: "2026-08-01T10:00:00Z",
        expires_at: "2026-09-01T10:00:00Z",
        purchased_price_micros: 9990000,
        currency: "CHF",
      },
      "record-purchase",
    );
    const purchase = await data<{ id: string; entitlement_ids: string[] }>(
      purchaseResponse,
    );
    expect(purchase.entitlement_ids).toEqual([entitlement.id]);

    const subscriptions = await request("GET", "/internal/v1/subscriptions");
    await expect(subscriptions.json()).resolves.toMatchObject({
      data: [
        {
          product_id: product.id,
          status: "active",
          original_transaction_id: "apple-original-1",
        },
      ],
    });

    const customerEntitlements = await request(
      "GET",
      "/internal/v1/customers/app-user-1/entitlements",
    );
    await expect(customerEntitlements.json()).resolves.toMatchObject({
      data: {
        customer: { external_customer_id: "app-user-1" },
        entitlements: [{ identifier: "pro", purchase_id: purchase.id }],
      },
    });

    const refundResponse = await mutate(
      "POST",
      `/internal/v1/purchases/${purchase.id}/refunds`,
      {
        status: "processing",
        amount_micros: 9990000,
        currency: "CHF",
        reason: "customer_request",
      },
      "refund-purchase",
    );
    expect(refundResponse.status).toBe(201);
    const refund = await data<{ id: string }>(refundResponse);
    const completedRefund = await mutate(
      "PUT",
      `/internal/v1/refunds/${refund.id}`,
      {
        status: "completed",
        amount_micros: 9990000,
        currency: "CHF",
        reason: "customer_request",
        requested_at: "2026-08-03T09:00:00Z",
        completed_at: "2026-08-03T10:00:00Z",
      },
      "complete-refund",
    );
    expect(completedRefund.status).toBe(200);
    const details = await request(
      "GET",
      `/internal/v1/purchases/${purchase.id}`,
    );
    await expect(details.json()).resolves.toMatchObject({
      data: { status: "refunded", refunds: [{ status: "completed" }] },
    });

    expect(
      (
        await mutate(
          "PUT",
          `/internal/v1/packages/${productPackage.id}`,
          {
            identifier: "monthly",
            display_name: "Monthly plan",
            product_id: product.id,
            position: 1,
            active: true,
          },
          "update-package",
        )
      ).status,
    ).toBe(200);
    const offering = await data<{ id: string }>(offeringResponse.clone());
    expect(
      (
        await mutate(
          "PUT",
          `/internal/v1/offerings/${offering.id}`,
          {
            identifier: "default",
            display_name: "Default offering updated",
            placement: "main",
            active: true,
            priority: 20,
            package_ids: [productPackage.id],
          },
          "update-offering",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await mutate(
          "PUT",
          `/internal/v1/entitlements/${entitlement.id}`,
          {
            identifier: "pro",
            display_name: "Pro access",
            active: true,
            product_ids: [product.id],
          },
          "update-entitlement",
        )
      ).status,
    ).toBe(200);

    const audit = await env.DB.prepare(
      `SELECT action,actor_id,request_id FROM audit_events WHERE project_id='11' ORDER BY created_at`,
    ).all<Record<string, unknown>>();
    expect(audit.results.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "product.created",
        "offering.created",
        "entitlement.created",
        "purchase.recorded",
        "refund.created",
        "refund.updated",
      ]),
    );
    expect(
      audit.results.every(
        (row) => row.actor_id === "2" && typeof row.request_id === "string",
      ),
    ).toBe(true);
    for (const [resource, id] of [
      ["offerings", offering.id],
      ["packages", productPackage.id],
      ["entitlements", entitlement.id],
      ["catalog/products", product.id],
    ]) {
      const archived = await mutate(
        "DELETE",
        `/internal/v1/${resource}/${id}`,
        undefined,
        `archive-${resource}`,
      );
      expect(archived.status).toBe(200);
    }
  });

  it("synchronizes a complete store catalog and exposes financial statistics", async () => {
    const sync = await mutate(
      "POST",
      "/internal/v1/catalog/sync",
      {
        store: "google",
        environment: "production",
        complete_catalog: true,
        products: [
          {
            store_product_id: "google.gold",
            identifier: "gold",
            display_name: "Gold",
            product_type: "non_consumable",
            price_micros: 4900000,
            currency: "EUR",
            metadata: { region: "eu" },
          },
        ],
      },
      "sync-google",
    );
    expect(sync.status).toBe(202);
    await expect(sync.json()).resolves.toMatchObject({
      data: {
        status: "succeeded",
        imported_count: 1,
        deactivated_count: 0,
      },
    });
    const rows = await env.DB.prepare(
      `SELECT sp.store_product_id,sp.active,p.identifier FROM store_products sp JOIN products p ON p.id=sp.product_id WHERE sp.project_id='11'`,
    ).all();
    expect(rows.results).toEqual(
      expect.arrayContaining([
        { store_product_id: "google.gold", active: 1, identifier: "gold" },
      ]),
    );

    const emptySync = await mutate(
      "POST",
      "/internal/v1/catalog/sync",
      {
        store: "google",
        environment: "production",
        complete_catalog: true,
        products: [],
      },
      "sync-google-empty",
    );
    await expect(emptySync.json()).resolves.toMatchObject({
      data: { deactivated_count: 1 },
    });

    const stats = await request(
      "GET",
      "/internal/v1/statistics?from=2026-08-01T00:00:00Z&to=2026-09-01T00:00:00Z&timezone=Europe%2FZurich",
    );
    await expect(stats.json()).resolves.toMatchObject({
      data: {
        filters: { product_id: null, platform: null },
        totals: {
          refunds: 1,
          refunded_micros: 9990000,
          gross_revenue_micros: 9990000,
          net_revenue_micros: 0,
        },
        by_product_platform: [
          {
            product_name: "Pro Monthly",
            platform: "ios",
            store: "apple",
            currency: "CHF",
            units_sold: 1,
            first_time_purchases: 1,
            revenue_micros: 9990000,
            cancellations: 0,
          },
        ],
      },
    });

    const filteredStats = await request(
      "GET",
      "/internal/v1/statistics?from=2026-08-01&to=2026-08-31&platform=ios",
    );
    expect(filteredStats.status).toBe(200);
    await expect(filteredStats.json()).resolves.toMatchObject({
      data: {
        filters: { platform: "ios" },
        totals: { purchases: 1 },
        by_product_platform: [{ platform: "ios", units_sold: 1 }],
      },
    });

    const proProduct = await env.DB.prepare(
      "SELECT id FROM products WHERE project_id='11' AND identifier='pro.monthly'",
    ).first<{ id: string }>();
    expect(proProduct).toBeTruthy();
    const filteredPurchases = await request(
      "GET",
      `/internal/v1/purchases?from=2026-08-01&to=2026-08-31&platform=ios&product_id=${proProduct!.id}`,
    );
    expect(filteredPurchases.status).toBe(200);
    await expect(filteredPurchases.json()).resolves.toMatchObject({
      data: [{ store: "apple", purchased_at: "2026-08-01T10:00:00.000Z" }],
    });

    const invalidPlatform = await request(
      "GET",
      "/internal/v1/statistics?platform=desktop",
    );
    expect(invalidPlatform.status).toBe(422);
    await expect(invalidPlatform.json()).resolves.toMatchObject({
      error: { code: "platform_invalid" },
    });
  });

  it("isolates resources by internal project id", async () => {
    const list = await request(
      "GET",
      "/internal/v1/catalog/products",
      undefined,
      12,
    );
    await expect(list.json()).resolves.toEqual({ data: [] });
    const foreign = await request(
      "GET",
      "/internal/v1/catalog/products/not-owned",
      undefined,
      12,
    );
    expect(foreign.status).toBe(404);
  });
});

async function mutate(
  method: string,
  path: string,
  body: unknown,
  key: string,
  projectId = 11,
): Promise<Response> {
  return request(method, path, body, projectId, key);
}

async function request(
  method: string,
  path: string,
  body?: unknown,
  projectId = 11,
  key?: string,
): Promise<Response> {
  const headers = await signedHeaders(
    method,
    new URL(path, "https://products.internal").pathname,
    projectId,
  );
  if (body !== undefined) headers.set("content-type", "application/json");
  if (key) headers.set("idempotency-key", key);
  return SELF.fetch(`https://products.internal${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function signedHeaders(
  method: string,
  pathname: string,
  projectId = 11,
  actorId = 2,
  role = "owner",
): Promise<Headers> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const requestId = crypto.randomUUID();
  const context = {
    module: "products" as const,
    method,
    pathname,
    projectId,
    projectRef: "10-test",
    instanceId: 10,
    environment: "test" as const,
    actorId,
    role,
    requestId,
    issuedAt,
  };
  return new Headers({
    "x-internal-token": secret,
    "x-project-id": String(projectId),
    "x-project-ref": context.projectRef,
    "x-instance-id": "10",
    "x-environment": "test",
    "x-actor-id": String(actorId),
    "x-role": role,
    "x-request-id": requestId,
    "x-context-issued-at": String(issuedAt),
    "x-context-version": "1",
    "x-context-signature": await signProjectContext(context, secret),
  });
}

async function data<T>(response: Response): Promise<T> {
  return ((await response.json()) as { data: T }).data;
}
