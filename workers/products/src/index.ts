import { Hono } from "hono";
import { inspectSqlDatabaseAndSchemaHealth } from "@superboard/contracts/health";
import {
  parseEntitlement,
  parseOffering,
  parsePackage,
  parseProduct,
  parsePurchase,
  parseRefund,
  parseResolveOffering,
  parseStoreSync,
  parseSubscriptionUpdate,
  record,
  requiredText,
} from "./contracts";
import {
  commitMutation,
  errorResponse,
  httpError,
  internalAuth,
  json,
  readJson,
  type WorkerBindings,
  type WorkerContext,
  type WorkerVariables,
} from "./http";

type AppShape = { Bindings: WorkerBindings; Variables: WorkerVariables };
type EntityRow = Record<string, unknown> & { id: string };

const app = new Hono<AppShape>();
const auth = internalAuth();

app.get("/internal/v1/health", async (c) => {
  try {
    const schema = await inspectSqlDatabaseAndSchemaHealth(
      c.env.DB,
      c.env.D1_EXPECTED_MIGRATION,
    );
    const current = schema.status === "current";
    return c.json(
      {
        data: {
          service: "products",
          version: "v1",
          status: current ? "ok" : "degraded",
          storage: "d1",
          schema,
          ...(current ? {} : { reason: "database_schema_not_current" }),
        },
      },
      current ? 200 : 503,
      { "cache-control": "no-store" },
    );
  } catch {
    return c.json(
      {
        data: {
          service: "products",
          version: "v1",
          status: "degraded",
          storage: "d1",
          reason: "database_health_unavailable",
        },
      },
      503,
      { "cache-control": "no-store" },
    );
  }
});
app.use("/internal/v1", auth);
app.use("/internal/v1/*", auth);
app.onError((error, c) => errorResponse(error, c));

app.get("/internal/v1", async (c) => {
  const projectId = c.get("project").projectId;
  const [products, offerings, entitlements, purchases] = await Promise.all([
    count(c.env.DB, "products", projectId),
    count(c.env.DB, "offerings", projectId),
    count(c.env.DB, "entitlements", projectId),
    count(c.env.DB, "purchases", projectId),
  ]);
  return c.json({ data: { products, offerings, entitlements, purchases } });
});

app.get("/internal/v1/catalog/products", async (c) => {
  const projectId = c.get("project").projectId;
  const status = c.req.query("status");
  const search = c.req.query("search")?.trim();
  const clauses = ["project_id = ?"];
  const values: unknown[] = [projectId];
  if (status) {
    clauses.push("status = ?");
    values.push(status);
  }
  if (search) {
    clauses.push("(identifier LIKE ? OR display_name LIKE ?)");
    values.push(`%${search}%`, `%${search}%`);
  }
  const rows = await c.env.DB.prepare(
    `SELECT * FROM products WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC, id`,
  )
    .bind(...values)
    .all();
  return c.json({ data: rows.results });
});

app.post("/internal/v1/catalog/products", async (c) => {
  const body = await readJson(c.req.raw);
  const input = parseProduct(body);
  const row = {
    id: crypto.randomUUID(),
    ...input,
    created_at: now(),
    updated_at: now(),
  };
  return commitMutation(c, {
    action: "product.created",
    entityType: "product",
    entityId: row.id,
    requestBody: body,
    status: 201,
    data: row,
    statements: [
      c.env.DB.prepare(
        `INSERT INTO products (id, project_id, identifier, display_name, description, product_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        row.id,
        project(c),
        row.identifier,
        row.display_name,
        row.description,
        row.product_type,
        row.status,
        row.created_at,
        row.updated_at,
      ),
    ],
  });
});

app.get("/internal/v1/catalog/products/:id", async (c) =>
  c.json({ data: await owned(c, "products", c.req.param("id"), "product") }),
);

app.put("/internal/v1/catalog/products/:id", async (c) => {
  const id = c.req.param("id");
  await owned(c, "products", id, "product");
  const body = await readJson(c.req.raw);
  const input = parseProduct(body);
  const row = { id, ...input, updated_at: now() };
  return commitMutation(c, {
    action: "product.updated",
    entityType: "product",
    entityId: id,
    requestBody: body,
    data: row,
    statements: [
      c.env.DB.prepare(
        `UPDATE products SET identifier=?, display_name=?, description=?, product_type=?, status=?, updated_at=? WHERE id=? AND project_id=?`,
      ).bind(
        input.identifier,
        input.display_name,
        input.description,
        input.product_type,
        input.status,
        row.updated_at,
        id,
        project(c),
      ),
    ],
  });
});

app.delete("/internal/v1/catalog/products/:id", async (c) => {
  const id = c.req.param("id");
  await owned(c, "products", id, "product");
  const body = {};
  return commitMutation(c, {
    action: "product.archived",
    entityType: "product",
    entityId: id,
    requestBody: body,
    data: { id, archived: true },
    statements: [
      c.env.DB.prepare(
        `UPDATE products SET status='archived', updated_at=? WHERE id=? AND project_id=?`,
      ).bind(now(), id, project(c)),
    ],
  });
});

app.get("/internal/v1/packages", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT p.*, pr.identifier AS product_identifier FROM packages p LEFT JOIN products pr ON pr.id=p.product_id AND pr.project_id=p.project_id WHERE p.project_id=? ORDER BY p.position, p.updated_at DESC`,
  )
    .bind(project(c))
    .all();
  return c.json({ data: rows.results });
});

app.post("/internal/v1/packages", async (c) => {
  const body = await readJson(c.req.raw);
  const input = parsePackage(body);
  if (input.product_id) await owned(c, "products", input.product_id, "product");
  const row = {
    id: crypto.randomUUID(),
    ...input,
    created_at: now(),
    updated_at: now(),
  };
  return commitMutation(c, {
    action: "package.created",
    entityType: "package",
    entityId: row.id,
    requestBody: body,
    status: 201,
    data: row,
    statements: [
      c.env.DB.prepare(
        `INSERT INTO packages (id, project_id, identifier, display_name, description, product_id, position, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        row.id,
        project(c),
        row.identifier,
        row.display_name,
        row.description,
        row.product_id,
        row.position,
        flag(row.active),
        row.created_at,
        row.updated_at,
      ),
    ],
  });
});

app.get("/internal/v1/packages/:id", async (c) =>
  c.json({ data: await owned(c, "packages", c.req.param("id"), "package") }),
);
app.put("/internal/v1/packages/:id", async (c) => {
  const id = c.req.param("id");
  await owned(c, "packages", id, "package");
  const body = await readJson(c.req.raw);
  const input = parsePackage(body);
  if (input.product_id) await owned(c, "products", input.product_id, "product");
  const row = { id, ...input, updated_at: now() };
  return commitMutation(c, {
    action: "package.updated",
    entityType: "package",
    entityId: id,
    requestBody: body,
    data: row,
    statements: [
      c.env.DB.prepare(
        `UPDATE packages SET identifier=?, display_name=?, description=?, product_id=?, position=?, active=?, updated_at=? WHERE id=? AND project_id=?`,
      ).bind(
        input.identifier,
        input.display_name,
        input.description,
        input.product_id,
        input.position,
        flag(input.active),
        row.updated_at,
        id,
        project(c),
      ),
    ],
  });
});
app.delete("/internal/v1/packages/:id", async (c) =>
  archive(c, "packages", "package", "active"),
);

app.get("/internal/v1/offerings", async (c) =>
  c.json({ data: await offerings(c, false) }),
);
app.post("/internal/v1/offerings", async (c) => {
  const body = await readJson(c.req.raw);
  const input = parseOffering(body);
  await requireOwnedIds(c, "packages", input.package_ids, "package");
  const row = {
    id: crypto.randomUUID(),
    ...input,
    created_at: now(),
    updated_at: now(),
  };
  return commitMutation(c, {
    action: "offering.created",
    entityType: "offering",
    entityId: row.id,
    requestBody: body,
    status: 201,
    data: row,
    statements: [
      c.env.DB.prepare(
        `INSERT INTO offerings (id, project_id, identifier, placement, name, description, packages_json, priority, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)`,
      ).bind(
        row.id,
        project(c),
        row.identifier,
        row.placement,
        row.display_name,
        row.description,
        row.priority,
        flag(row.active),
        row.created_at,
        row.updated_at,
      ),
      ...input.package_ids.map((packageId, position) =>
        c.env.DB.prepare(
          "INSERT INTO offering_packages (offering_id, package_id, position) VALUES (?, ?, ?)",
        ).bind(row.id, packageId, position),
      ),
    ],
  });
});

app.get("/internal/v1/offerings/:id", async (c) => {
  const all = await offerings(c, false, c.req.param("id"));
  if (!all[0])
    throw httpError("offering_not_found", "Offering was not found", 404);
  return c.json({ data: all[0] });
});

app.put("/internal/v1/offerings/:id", async (c) => {
  const id = c.req.param("id");
  await owned(c, "offerings", id, "offering");
  const body = await readJson(c.req.raw);
  const input = parseOffering(body);
  await requireOwnedIds(c, "packages", input.package_ids, "package");
  const row = { id, ...input, updated_at: now() };
  return commitMutation(c, {
    action: "offering.updated",
    entityType: "offering",
    entityId: id,
    requestBody: body,
    data: row,
    statements: [
      c.env.DB.prepare(
        `UPDATE offerings SET identifier=?, placement=?, name=?, description=?, priority=?, active=?, updated_at=? WHERE id=? AND project_id=?`,
      ).bind(
        input.identifier,
        input.placement,
        input.display_name,
        input.description,
        input.priority,
        flag(input.active),
        row.updated_at,
        id,
        project(c),
      ),
      c.env.DB.prepare(
        "DELETE FROM offering_packages WHERE offering_id=?",
      ).bind(id),
      ...input.package_ids.map((packageId, position) =>
        c.env.DB.prepare(
          "INSERT INTO offering_packages (offering_id, package_id, position) VALUES (?, ?, ?)",
        ).bind(id, packageId, position),
      ),
    ],
  });
});
app.delete("/internal/v1/offerings/:id", async (c) =>
  archive(c, "offerings", "offering", "active"),
);

app.post("/internal/v1/offerings/resolve", async (c) => {
  const input = parseResolveOffering(await readJson(c.req.raw));
  const rows = await offerings(c, true);
  const match = rows.find((row) => row.placement === input.placement) ?? null;
  return c.json({
    data: match,
    meta: { project_id: project(c), placement: input.placement },
  });
});

app.get("/internal/v1/entitlements", async (c) =>
  c.json({ data: await entitlements(c) }),
);
app.post("/internal/v1/entitlements", async (c) => {
  const body = await readJson(c.req.raw);
  const input = parseEntitlement(body);
  await requireOwnedIds(c, "products", input.product_ids, "product");
  const row = {
    id: crypto.randomUUID(),
    ...input,
    created_at: now(),
    updated_at: now(),
  };
  return commitMutation(c, {
    action: "entitlement.created",
    entityType: "entitlement",
    entityId: row.id,
    requestBody: body,
    status: 201,
    data: row,
    statements: [
      c.env.DB.prepare(
        `INSERT INTO entitlements (id, project_id, key, name, description, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        row.id,
        project(c),
        row.identifier,
        row.display_name,
        row.description,
        flag(row.active),
        row.created_at,
        row.updated_at,
      ),
      ...input.product_ids.map((productId) =>
        c.env.DB.prepare(
          "INSERT INTO entitlement_products (entitlement_id, product_id) VALUES (?, ?)",
        ).bind(row.id, productId),
      ),
    ],
  });
});

app.get("/internal/v1/entitlements/:id", async (c) => {
  const rows = await entitlements(c, c.req.param("id"));
  if (!rows[0])
    throw httpError("entitlement_not_found", "Entitlement was not found", 404);
  return c.json({ data: rows[0] });
});
app.put("/internal/v1/entitlements/:id", async (c) => {
  const id = c.req.param("id");
  await owned(c, "entitlements", id, "entitlement");
  const body = await readJson(c.req.raw);
  const input = parseEntitlement(body);
  await requireOwnedIds(c, "products", input.product_ids, "product");
  const row = { id, ...input, updated_at: now() };
  return commitMutation(c, {
    action: "entitlement.updated",
    entityType: "entitlement",
    entityId: id,
    requestBody: body,
    data: row,
    statements: [
      c.env.DB.prepare(
        `UPDATE entitlements SET key=?, name=?, description=?, active=?, updated_at=? WHERE id=? AND project_id=?`,
      ).bind(
        input.identifier,
        input.display_name,
        input.description,
        flag(input.active),
        row.updated_at,
        id,
        project(c),
      ),
      c.env.DB.prepare(
        "DELETE FROM entitlement_products WHERE entitlement_id=?",
      ).bind(id),
      ...input.product_ids.map((productId) =>
        c.env.DB.prepare(
          "INSERT INTO entitlement_products (entitlement_id, product_id) VALUES (?, ?)",
        ).bind(id, productId),
      ),
    ],
  });
});
app.delete("/internal/v1/entitlements/:id", async (c) =>
  archive(c, "entitlements", "entitlement", "active"),
);

app.get("/internal/v1/purchases", async (c) => {
  const clauses = ["p.project_id=?"];
  const values: unknown[] = [project(c)];
  addFilter(c, clauses, values, "status", "p.status");
  addFilter(c, clauses, values, "customer_id", "fc.external_customer_id");
  addFilter(c, clauses, values, "product_id", "p.product_id");
  addFilter(c, clauses, values, "store", "p.store");
  const platform = c.req.query("platform");
  if (platform) {
    clauses.push("p.store=?");
    values.push(storeForPlatform(platform));
  }
  const from = optionalDate(c.req.query("from"), "from", false);
  const to = optionalDate(c.req.query("to"), "to", true);
  if (from) {
    clauses.push("p.purchased_at>=?");
    values.push(from);
  }
  if (to) {
    clauses.push("p.purchased_at<?");
    values.push(to);
  }
  if (from && to && from >= to)
    throw httpError("purchase_range_invalid", "from must be before to", 422);
  const rows = await c.env.DB.prepare(
    `SELECT p.*, fc.external_customer_id, pr.identifier AS product_identifier, pr.display_name AS product_name FROM purchases p JOIN financial_customers fc ON fc.id=p.financial_customer_id AND fc.project_id=p.project_id LEFT JOIN products pr ON pr.id=p.product_id AND pr.project_id=p.project_id WHERE ${clauses.join(" AND ")} ORDER BY p.purchased_at DESC LIMIT 500`,
  )
    .bind(...values)
    .all();
  return c.json({ data: rows.results });
});

app.post("/internal/v1/purchases", async (c) => {
  const body = await readJson(c.req.raw);
  const input = parsePurchase(body);
  const productRow = (await owned(
    c,
    "products",
    input.product_id,
    "product",
  )) as EntityRow & { product_type: string };
  const existingCustomer = await c.env.DB.prepare(
    "SELECT id FROM financial_customers WHERE project_id=? AND external_customer_id=?",
  )
    .bind(project(c), input.financial_customer_id)
    .first<{ id: string }>();
  const customerId = existingCustomer?.id ?? crypto.randomUUID();
  const id = crypto.randomUUID();
  const purchase = { id, customer_id: customerId, ...input, updated_at: now() };
  const entitlementRows = await c.env.DB.prepare(
    `SELECT e.id FROM entitlements e JOIN entitlement_products ep ON ep.entitlement_id=e.id WHERE e.project_id=? AND e.active=1 AND ep.product_id=?`,
  )
    .bind(project(c), input.product_id)
    .all<{ id: string }>();
  const statements: D1PreparedStatement[] = [];
  if (!existingCustomer)
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO financial_customers (id, project_id, external_customer_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      ).bind(customerId, project(c), input.financial_customer_id, now(), now()),
    );
  statements.push(
    c.env.DB.prepare(
      `INSERT INTO purchases (id, project_id, financial_customer_id, product_id, status, purchased_at, payload_json, store, environment, external_transaction_id, original_transaction_id, purchased_price_micros, currency, expires_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      project(c),
      customerId,
      input.product_id,
      input.status,
      input.purchased_at,
      JSON.stringify(input.payload),
      input.store,
      input.environment,
      input.external_transaction_id,
      input.original_transaction_id,
      input.purchased_price_micros,
      input.currency,
      input.expires_at,
      purchase.updated_at,
    ),
  );
  for (const entitlement of entitlementRows.results)
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO purchase_entitlements (purchase_id, entitlement_id) VALUES (?, ?)",
      ).bind(id, entitlement.id),
    );
  if (productRow.product_type === "subscription") {
    const subscriptionId = crypto.randomUUID();
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO subscriptions (id, project_id, financial_customer_id, product_id, latest_purchase_id, store, environment, original_transaction_id, status, current_period_started_at, current_period_ends_at, auto_renew, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, store, environment, original_transaction_id) DO UPDATE SET latest_purchase_id=excluded.latest_purchase_id, status=excluded.status, current_period_started_at=excluded.current_period_started_at, current_period_ends_at=excluded.current_period_ends_at, updated_at=excluded.updated_at`,
      ).bind(
        subscriptionId,
        project(c),
        customerId,
        input.product_id,
        id,
        input.store,
        input.environment,
        input.original_transaction_id,
        subscriptionStatus(input.status),
        input.purchased_at,
        input.expires_at,
        input.status === "cancelled" ? 0 : 1,
        now(),
        now(),
      ),
    );
  }
  return commitMutation(c, {
    action: "purchase.recorded",
    entityType: "purchase",
    entityId: id,
    requestBody: body,
    status: 201,
    data: {
      ...purchase,
      entitlement_ids: entitlementRows.results.map((row) => row.id),
    },
    statements,
  });
});

app.get("/internal/v1/purchases/:id", async (c) => {
  const purchaseRow = await owned(
    c,
    "purchases",
    c.req.param("id"),
    "purchase",
  );
  const [entitlementRows, refundRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT e.* FROM entitlements e JOIN purchase_entitlements pe ON pe.entitlement_id=e.id WHERE pe.purchase_id=? AND e.project_id=?`,
    )
      .bind(c.req.param("id"), project(c))
      .all(),
    c.env.DB.prepare(
      "SELECT * FROM refunds WHERE purchase_id=? AND project_id=? ORDER BY requested_at DESC",
    )
      .bind(c.req.param("id"), project(c))
      .all(),
  ]);
  const customer = await c.env.DB.prepare(
    "SELECT external_customer_id FROM financial_customers WHERE id=? AND project_id=?",
  )
    .bind(purchaseRow.financial_customer_id, project(c))
    .first<{ external_customer_id: string }>();
  return c.json({
    data: {
      ...purchaseRow,
      external_customer_id: customer?.external_customer_id ?? null,
      entitlements: entitlementRows.results,
      refunds: refundRows.results,
    },
  });
});

app.post("/internal/v1/purchases/:id/refunds", async (c) => {
  const purchaseId = c.req.param("id");
  const purchaseRow = (await owned(
    c,
    "purchases",
    purchaseId,
    "purchase",
  )) as EntityRow & {
    purchased_price_micros: number;
    currency: string | null;
    original_transaction_id: string;
  };
  const body = await readJson(c.req.raw);
  const input = parseRefund(body);
  const id = crypto.randomUUID();
  const amount = input.amount_micros || purchaseRow.purchased_price_micros;
  const currencyCode = input.currency || purchaseRow.currency;
  const completedAt =
    input.status === "completed" ? (input.completed_at ?? now()) : null;
  const row = {
    id,
    purchase_id: purchaseId,
    ...input,
    amount_micros: amount,
    currency: currencyCode,
    completed_at: completedAt,
    updated_at: now(),
  };
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO refunds (id, project_id, purchase_id, external_refund_id, status, amount_micros, currency, reason, metadata_json, requested_at, completed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      project(c),
      purchaseId,
      input.external_refund_id,
      input.status,
      amount,
      currencyCode,
      input.reason,
      JSON.stringify(input.metadata),
      input.requested_at,
      completedAt,
      row.updated_at,
    ),
  ];
  if (input.status === "completed") {
    statements.push(
      c.env.DB.prepare(
        `UPDATE purchases SET status='refunded', updated_at=? WHERE id=? AND project_id=?`,
      ).bind(now(), purchaseId, project(c)),
    );
    statements.push(
      c.env.DB.prepare(
        `UPDATE subscriptions SET status='refunded', auto_renew=0, updated_at=? WHERE project_id=? AND original_transaction_id=?`,
      ).bind(now(), project(c), purchaseRow.original_transaction_id),
    );
  }
  return commitMutation(c, {
    action: "refund.created",
    entityType: "refund",
    entityId: id,
    requestBody: body,
    status: 201,
    data: row,
    statements,
  });
});

app.get("/internal/v1/refunds", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT * FROM refunds WHERE project_id=? ORDER BY requested_at DESC LIMIT 500",
  )
    .bind(project(c))
    .all();
  return c.json({ data: rows.results });
});

app.put("/internal/v1/refunds/:id", async (c) => {
  const id = c.req.param("id");
  const current = (await owned(c, "refunds", id, "refund")) as EntityRow & {
    purchase_id: string;
    status: string;
  };
  if (["completed", "rejected", "cancelled"].includes(current.status))
    throw httpError(
      "refund_terminal",
      "A terminal refund cannot be changed",
      409,
    );
  const body = await readJson(c.req.raw);
  const input = parseRefund(body);
  const purchaseRow = (await owned(
    c,
    "purchases",
    current.purchase_id,
    "purchase",
  )) as EntityRow & { original_transaction_id: string };
  const completedAt =
    input.status === "completed" ? (input.completed_at ?? now()) : null;
  const row = { id, ...input, completed_at: completedAt, updated_at: now() };
  const statements = [
    c.env.DB.prepare(
      `UPDATE refunds SET external_refund_id=?,status=?,amount_micros=?,currency=?,reason=?,metadata_json=?,requested_at=?,completed_at=?,updated_at=? WHERE id=? AND project_id=?`,
    ).bind(
      input.external_refund_id,
      input.status,
      input.amount_micros,
      input.currency,
      input.reason,
      JSON.stringify(input.metadata),
      input.requested_at,
      completedAt,
      row.updated_at,
      id,
      project(c),
    ),
  ];
  if (input.status === "completed") {
    statements.push(
      c.env.DB.prepare(
        `UPDATE purchases SET status='refunded',updated_at=? WHERE id=? AND project_id=?`,
      ).bind(now(), current.purchase_id, project(c)),
      c.env.DB.prepare(
        `UPDATE subscriptions SET status='refunded',auto_renew=0,updated_at=? WHERE project_id=? AND original_transaction_id=?`,
      ).bind(now(), project(c), purchaseRow.original_transaction_id),
    );
  }
  return commitMutation(c, {
    action: "refund.updated",
    entityType: "refund",
    entityId: id,
    requestBody: body,
    data: row,
    statements,
  });
});

app.get("/internal/v1/customers/:customerId/entitlements", async (c) => {
  const customer = await c.env.DB.prepare(
    "SELECT id,external_customer_id FROM financial_customers WHERE project_id=? AND external_customer_id=?",
  )
    .bind(project(c), c.req.param("customerId"))
    .first<{ id: string; external_customer_id: string }>();
  if (!customer)
    throw httpError(
      "financial_customer_not_found",
      "Customer was not found",
      404,
    );
  const rows = await c.env.DB.prepare(
    `SELECT DISTINCT e.id,e.key AS identifier,e.name AS display_name,e.description,p.expires_at,p.id AS purchase_id
     FROM entitlements e JOIN purchase_entitlements pe ON pe.entitlement_id=e.id
     JOIN purchases p ON p.id=pe.purchase_id AND p.project_id=e.project_id
     WHERE e.project_id=? AND e.active=1 AND p.financial_customer_id=? AND p.status='active'
       AND (p.expires_at IS NULL OR p.expires_at>?) ORDER BY e.name`,
  )
    .bind(project(c), customer.id, now())
    .all();
  return c.json({ data: { customer, entitlements: rows.results } });
});

app.get("/internal/v1/subscriptions", async (c) => {
  const clauses = ["s.project_id=?"];
  const values: unknown[] = [project(c)];
  addFilter(c, clauses, values, "status", "s.status");
  addFilter(c, clauses, values, "customer_id", "fc.external_customer_id");
  const rows = await c.env.DB.prepare(
    `SELECT s.*,fc.external_customer_id,p.identifier AS product_identifier,p.display_name AS product_name FROM subscriptions s JOIN financial_customers fc ON fc.id=s.financial_customer_id AND fc.project_id=s.project_id JOIN products p ON p.id=s.product_id AND p.project_id=s.project_id WHERE ${clauses.join(" AND ")} ORDER BY s.updated_at DESC LIMIT 500`,
  )
    .bind(...values)
    .all();
  return c.json({ data: rows.results });
});

app.put("/internal/v1/subscriptions/:id", async (c) => {
  const id = c.req.param("id");
  await owned(c, "subscriptions", id, "subscription");
  const body = await readJson(c.req.raw);
  const input = parseSubscriptionUpdate(body);
  const row = { id, ...input, updated_at: now() };
  return commitMutation(c, {
    action: "subscription.updated",
    entityType: "subscription",
    entityId: id,
    requestBody: body,
    data: row,
    statements: [
      c.env.DB.prepare(
        `UPDATE subscriptions SET status=?, current_period_started_at=?, current_period_ends_at=?, auto_renew=?, cancelled_at=?, updated_at=? WHERE id=? AND project_id=?`,
      ).bind(
        input.status,
        input.current_period_started_at,
        input.current_period_ends_at,
        flag(input.auto_renew),
        input.cancelled_at,
        row.updated_at,
        id,
        project(c),
      ),
    ],
  });
});

app.post("/internal/v1/catalog/sync", async (c) => {
  const body = await readJson(c.req.raw, 2_359_296);
  const input = parseStoreSync(body);
  const started = now();
  const runId = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [];
  let deactivatedCount = 0;
  if (input.complete_catalog) {
    const storeIds = input.products.map((entry) => entry.store_product_id);
    const stale = await c.env.DB.prepare(
      `SELECT COUNT(*) AS count FROM store_products WHERE project_id=? AND store=? AND environment=? AND active=1 ${storeIds.length ? `AND store_product_id NOT IN (${storeIds.map(() => "?").join(",")})` : ""}`,
    )
      .bind(project(c), input.store, input.environment, ...storeIds)
      .first<{ count: number }>();
    deactivatedCount = stale?.count ?? 0;
  }
  if (input.complete_catalog)
    statements.push(
      c.env.DB.prepare(
        "UPDATE store_products SET active=0, updated_at=? WHERE project_id=? AND store=? AND environment=?",
      ).bind(started, project(c), input.store, input.environment),
    );
  for (const entry of input.products) {
    const existing = await c.env.DB.prepare(
      "SELECT id FROM products WHERE project_id=? AND identifier=?",
    )
      .bind(project(c), entry.identifier)
      .first<{ id: string }>();
    const productId = existing?.id ?? crypto.randomUUID();
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO products (id, project_id, identifier, display_name, description, product_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?) ON CONFLICT(project_id, identifier) DO UPDATE SET display_name=excluded.display_name, description=excluded.description, product_type=excluded.product_type, status='active', updated_at=excluded.updated_at`,
      ).bind(
        productId,
        project(c),
        entry.identifier,
        entry.display_name,
        entry.description,
        entry.product_type,
        started,
        started,
      ),
    );
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO store_products (id, project_id, product_id, store, environment, store_product_id, title, description, price_micros, currency, billing_period, trial_period, active, metadata_json, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?) ON CONFLICT(project_id, store, environment, store_product_id) DO UPDATE SET product_id=excluded.product_id, title=excluded.title, description=excluded.description, price_micros=excluded.price_micros, currency=excluded.currency, billing_period=excluded.billing_period, trial_period=excluded.trial_period, active=1, metadata_json=excluded.metadata_json, synced_at=excluded.synced_at, updated_at=excluded.updated_at`,
      ).bind(
        crypto.randomUUID(),
        project(c),
        productId,
        input.store,
        input.environment,
        entry.store_product_id,
        entry.title,
        entry.description,
        entry.price_micros,
        entry.currency,
        entry.billing_period,
        entry.trial_period,
        JSON.stringify(entry.metadata),
        started,
        started,
        started,
      ),
    );
  }
  statements.push(
    c.env.DB.prepare(
      `INSERT INTO store_sync_runs (id, project_id, store, environment, status, imported_count, deactivated_count, started_at, completed_at) VALUES (?, ?, ?, ?, 'succeeded', ?, ?, ?, ?)`,
    ).bind(
      runId,
      project(c),
      input.store,
      input.environment,
      input.products.length,
      deactivatedCount,
      started,
      now(),
    ),
  );
  return commitMutation(c, {
    action: "catalog.synced",
    entityType: "store_sync",
    entityId: runId,
    requestBody: body,
    status: 202,
    data: {
      id: runId,
      status: "succeeded",
      imported_count: input.products.length,
      deactivated_count: deactivatedCount,
    },
    statements,
  });
});

app.get("/internal/v1/catalog/syncs", async (c) =>
  c.json({
    data: (
      await c.env.DB.prepare(
        "SELECT * FROM store_sync_runs WHERE project_id=? ORDER BY started_at DESC LIMIT 100",
      )
        .bind(project(c))
        .all()
    ).results,
  }),
);

app.get("/internal/v1/statistics", async (c) => {
  const range = dateRange(c);
  const clauses = ["p.project_id=?", "p.purchased_at>=?", "p.purchased_at<?"];
  const values: unknown[] = [project(c), range.from, range.to];
  addFilter(c, clauses, values, "product_id", "p.product_id");
  const platform = c.req.query("platform");
  if (platform) {
    clauses.push("p.store=?");
    values.push(storeForPlatform(platform));
  }
  const where = clauses.join(" AND ");
  const [totals, statuses, series, activeSubscriptions] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS purchases, COALESCE(SUM(p.purchased_price_micros),0) AS gross_revenue_micros FROM purchases p WHERE ${where} AND p.status IN ('active','expired','cancelled','refunded')`,
    )
      .bind(...values)
      .first(),
    c.env.DB.prepare(
      `SELECT p.status, COUNT(*) AS count FROM purchases p WHERE ${where} GROUP BY p.status`,
    )
      .bind(...values)
      .all(),
    c.env.DB.prepare(
      `SELECT substr(p.purchased_at,1,10) AS bucket, COUNT(*) AS purchases, COALESCE(SUM(p.purchased_price_micros),0) AS revenue_micros FROM purchases p WHERE ${where} GROUP BY bucket ORDER BY bucket`,
    )
      .bind(...values)
      .all(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS count FROM subscriptions s WHERE s.project_id=? AND s.status IN ('trialing','active','grace_period') ${c.req.query("product_id") ? "AND s.product_id=?" : ""} ${platform ? "AND s.store=?" : ""}`,
    )
      .bind(
        project(c),
        ...(c.req.query("product_id") ? [c.req.query("product_id")] : []),
        ...(platform ? [storeForPlatform(platform)] : []),
      )
      .first<{ count: number }>(),
  ]);
  const refundClauses = [
    "r.project_id=?",
    "r.requested_at>=?",
    "r.requested_at<?",
  ];
  const refundValues: unknown[] = [project(c), range.from, range.to];
  if (c.req.query("product_id")) {
    refundClauses.push("p.product_id=?");
    refundValues.push(c.req.query("product_id"));
  }
  if (platform) {
    refundClauses.push("p.store=?");
    refundValues.push(storeForPlatform(platform));
  }
  const refunds = await c.env.DB.prepare(
    `SELECT COUNT(*) AS refunds, COALESCE(SUM(r.amount_micros),0) AS refunded_micros FROM refunds r JOIN purchases p ON p.id=r.purchase_id AND p.project_id=r.project_id WHERE ${refundClauses.join(" AND ")} AND r.status='completed'`,
  )
    .bind(...refundValues)
    .first();
  const breakdown = await c.env.DB.prepare(
    `SELECT
       p.product_id,
       pr.display_name AS product_name,
       CASE p.store WHEN 'apple' THEN 'ios' WHEN 'google' THEN 'android' ELSE p.store END AS platform,
       p.store,
       p.currency,
       COUNT(*) AS units_sold,
       SUM(CASE WHEN NOT EXISTS (
         SELECT 1 FROM purchases first_purchase
         WHERE first_purchase.project_id=p.project_id
           AND first_purchase.financial_customer_id=p.financial_customer_id
           AND first_purchase.status IN ('active','expired','cancelled','refunded')
           AND (first_purchase.purchased_at<p.purchased_at OR (first_purchase.purchased_at=p.purchased_at AND first_purchase.id<p.id))
       ) THEN 1 ELSE 0 END) AS first_time_purchases,
       COALESCE(SUM(p.purchased_price_micros),0) AS revenue_micros,
       SUM(CASE WHEN p.status='cancelled' THEN 1 ELSE 0 END) AS cancellations
     FROM purchases p
     JOIN products pr ON pr.id=p.product_id AND pr.project_id=p.project_id
     WHERE ${where} AND p.status IN ('active','expired','cancelled','refunded')
     GROUP BY p.product_id,pr.display_name,p.store,p.currency
     ORDER BY revenue_micros DESC,pr.display_name,p.store,p.currency`,
  )
    .bind(...values)
    .all();
  const mergedTotals = {
    ...totals,
    ...refunds,
    active_subscriptions: activeSubscriptions?.count ?? 0,
    net_revenue_micros:
      Number(totals?.gross_revenue_micros ?? 0) -
      Number(refunds?.refunded_micros ?? 0),
  };
  return c.json({
    data: {
      range,
      filters: {
        product_id: c.req.query("product_id") ?? null,
        platform: platform ?? null,
      },
      totals: mergedTotals,
      by_status: statuses.results,
      series: series.results,
      by_product_platform: breakdown.results,
    },
  });
});

app.notFound((c) =>
  json(
    {
      error: {
        code: "products_route_not_found",
        message: "Products route was not found",
        status: 404,
        request_id: c.req.header("x-request-id") ?? null,
      },
    },
    404,
  ),
);

async function offerings(
  c: WorkerContext,
  onlyActive: boolean,
  id?: string,
): Promise<EntityRow[]> {
  const clauses = ["o.project_id=?"];
  const values: unknown[] = [project(c)];
  if (onlyActive) clauses.push("o.active=1");
  if (id) {
    clauses.push("o.id=?");
    values.push(id);
  }
  const rows = await c.env.DB.prepare(
    `SELECT o.id, o.identifier, o.placement, o.name AS display_name, o.description, o.priority, o.active, o.created_at, o.updated_at FROM offerings o WHERE ${clauses.join(" AND ")} ORDER BY o.priority DESC, o.updated_at DESC`,
  )
    .bind(...values)
    .all<EntityRow>();
  if (!rows.results.length) return [];
  const ids = rows.results.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(",");
  const packages = await c.env.DB.prepare(
    `SELECT op.offering_id, op.position AS offering_position, p.*, pr.identifier AS product_identifier FROM offering_packages op JOIN packages p ON p.id=op.package_id AND p.project_id=? LEFT JOIN products pr ON pr.id=p.product_id WHERE op.offering_id IN (${placeholders}) ${onlyActive ? "AND p.active=1 AND (p.product_id IS NULL OR pr.status='active')" : ""} ORDER BY op.position`,
  )
    .bind(project(c), ...ids)
    .all<Record<string, unknown> & { offering_id: string }>();
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const pkg of packages.results) {
    const list = grouped.get(pkg.offering_id) ?? [];
    list.push(pkg);
    grouped.set(pkg.offering_id, list);
  }
  return rows.results.map((row) => ({
    ...row,
    active: Boolean(row.active),
    packages: grouped.get(row.id) ?? [],
  }));
}

async function entitlements(
  c: WorkerContext,
  id?: string,
): Promise<EntityRow[]> {
  const rows = await c.env.DB.prepare(
    `SELECT id, key AS identifier, name AS display_name, description, active, created_at, updated_at FROM entitlements WHERE project_id=? ${id ? "AND id=?" : ""} ORDER BY updated_at DESC`,
  )
    .bind(project(c), ...(id ? [id] : []))
    .all<EntityRow>();
  if (!rows.results.length) return [];
  const ids = rows.results.map((row) => row.id);
  const productRows = await c.env.DB.prepare(
    `SELECT ep.entitlement_id, p.* FROM entitlement_products ep JOIN products p ON p.id=ep.product_id AND p.project_id=? WHERE ep.entitlement_id IN (${ids.map(() => "?").join(",")}) ORDER BY p.display_name`,
  )
    .bind(project(c), ...ids)
    .all<Record<string, unknown> & { entitlement_id: string }>();
  return rows.results.map((row) => ({
    ...row,
    active: Boolean(row.active),
    products: productRows.results.filter(
      (productRow) => productRow.entitlement_id === row.id,
    ),
  }));
}

async function owned(
  c: WorkerContext,
  table:
    | "products"
    | "packages"
    | "offerings"
    | "entitlements"
    | "purchases"
    | "subscriptions"
    | "refunds",
  id: string,
  label: string,
): Promise<EntityRow> {
  const row = await c.env.DB.prepare(
    `SELECT * FROM ${table} WHERE id=? AND project_id=?`,
  )
    .bind(id, project(c))
    .first<EntityRow>();
  if (!row)
    throw httpError(`${label}_not_found`, `${title(label)} was not found`, 404);
  return row;
}

async function requireOwnedIds(
  c: WorkerContext,
  table: "products" | "packages",
  ids: string[],
  label: string,
): Promise<void> {
  if (!ids.length) return;
  const result = await c.env.DB.prepare(
    `SELECT id FROM ${table} WHERE project_id=? AND id IN (${ids.map(() => "?").join(",")})`,
  )
    .bind(project(c), ...ids)
    .all<{ id: string }>();
  if (result.results.length !== ids.length)
    throw httpError(
      `${label}_not_found`,
      `One or more ${label} identifiers do not belong to this project`,
      404,
    );
}

async function archive(
  c: WorkerContext,
  table: "packages" | "offerings" | "entitlements",
  label: string,
  column: "active",
): Promise<Response> {
  const id = c.req.param("id")!;
  await owned(c, table, id, label);
  return commitMutation(c, {
    action: `${label}.archived`,
    entityType: label,
    entityId: id,
    requestBody: {},
    data: { id, archived: true },
    statements: [
      c.env.DB.prepare(
        `UPDATE ${table} SET ${column}=0, updated_at=? WHERE id=? AND project_id=?`,
      ).bind(now(), id, project(c)),
    ],
  });
}

async function count(
  db: D1Database,
  table: "products" | "offerings" | "entitlements" | "purchases",
  projectId: string,
): Promise<number> {
  return (
    (
      await db
        .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE project_id=?`)
        .bind(projectId)
        .first<{ count: number }>()
    )?.count ?? 0
  );
}

function project(c: WorkerContext): string {
  return c.get("project").projectId;
}
function flag(value: boolean): number {
  return value ? 1 : 0;
}
function now(): string {
  return new Date().toISOString();
}
function title(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
function subscriptionStatus(status: string): string {
  if (status === "pending") return "trialing";
  if (status === "failed") return "expired";
  return status;
}
function addFilter(
  c: WorkerContext,
  clauses: string[],
  values: unknown[],
  query: string,
  column: string,
): void {
  const value = c.req.query(query);
  if (value) {
    clauses.push(`${column}=?`);
    values.push(value);
  }
}
function dateRange(c: WorkerContext): {
  from: string;
  to: string;
  timezone: string;
} {
  const toInput = c.req.query("to");
  const fromInput = c.req.query("from");
  const to = toInput ? new Date(requiredText(toInput, "to")) : new Date();
  if (toInput && /^\d{4}-\d{2}-\d{2}$/.test(toInput))
    to.setUTCDate(to.getUTCDate() + 1);
  const from = fromInput
    ? new Date(requiredText(fromInput, "from"))
    : new Date(to.getTime() - 30 * 86_400_000);
  if (
    Number.isNaN(from.getTime()) ||
    Number.isNaN(to.getTime()) ||
    from >= to ||
    to.getTime() - from.getTime() > 366 * 86_400_000
  )
    throw httpError(
      "statistics_range_invalid",
      "Statistics range must be valid and no longer than 366 days",
      422,
    );
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    timezone: c.req.query("timezone") ?? "UTC",
  };
}

function optionalDate(
  value: string | undefined,
  name: string,
  inclusiveDate: boolean,
): string | null {
  if (!value) return null;
  const parsed = new Date(requiredText(value, name));
  if (Number.isNaN(parsed.getTime()))
    throw httpError("date_invalid", `${name} must be a valid date`, 422);
  if (inclusiveDate && /^\d{4}-\d{2}-\d{2}$/.test(value))
    parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString();
}

function storeForPlatform(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "ios") return "apple";
  if (normalized === "android") return "google";
  if (["apple", "google", "stripe", "manual"].includes(normalized))
    return normalized;
  throw httpError(
    "platform_invalid",
    "platform must be ios, android, apple, google, stripe or manual",
    422,
  );
}

export default app;
