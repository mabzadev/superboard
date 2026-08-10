import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeRows, upsertSql } from "./core.mjs";
import { MODULE_CUTOVER_GUARDS, MODULE_CUTOVER_REGISTRY } from "./registry.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), "opengrow-cutover-schema-"));
const databases = {};

before(() => {
  databases.api = createDatabase("api", "workers/api/migrations");
  databases.billing = databases.api;
  databases.messaging = createDatabase("messaging", "workers/messaging/migrations");
  for (const module of ["app", "products", "paywalls", "dynamic-links", "support"]) {
    databases[module] = createDatabase(module, `workers/${module}/migrations`);
  }
});

after(() => rmSync(temporary, { recursive: true, force: true }));

test("every registry extraction and destination query matches the checked-in D1 schemas", () => {
  for (const entity of MODULE_CUTOVER_REGISTRY) {
    assert.doesNotThrow(() => query(databases[entity.source.database], render(entity.source.query)), `${entity.id} source query`);
    assert.doesNotThrow(() => query(databases[entity.module], render(entity.target.query)), `${entity.id} target query`);
  }
  for (const guard of MODULE_CUTOVER_GUARDS) {
    assert.doesNotThrow(() => query(databases[guard.source.database], render(guard.source.query)), `${guard.id} guard query`);
  }
});

test("every registry upsert conflict target matches a real destination constraint", () => {
  for (const entity of MODULE_CUTOVER_REGISTRY) {
    const values = Object.fromEntries(entity.columns.map((column) => [column, null]));
    const sql = upsertSql(entity, [values]);
    const conflict = entity.keys.map((column) => `"${column}"`).join(", ");
    assert.match(sql, new RegExp(`ON CONFLICT \\(${conflict.replace(/[.*+?^${}()|[\\]\\]/g, "\\\\$&")}\\)`), entity.id);
  }
  for (const id of [
    "app.customer_events",
    "app.customer_purchase_events",
    "dynamic-links.events",
    "dynamic-links.analytics_events",
    "dynamic-links.purchase_events",
  ]) {
    assert.deepEqual(MODULE_CUTOVER_REGISTRY.find((entity) => entity.id === id).keys, ["project_id", "id"]);
  }
});

test("projection queries collapse cross-store products and event history without duplicate destination keys", () => {
  execute(databases.api, `
    INSERT INTO instances(id,api_key,uri_scheme) VALUES(10,'legacy-secret','demo');
    INSERT INTO projects(id,name,identifier,instance_id,is_test) VALUES(12,'Test','test',10,1);
    INSERT INTO domains(id,domain,project_id,generic_title,generic_subtitle,generic_image_url)
      VALUES(1,'example.test',12,'Example','Preview without image',NULL);
    INSERT INTO redirect_configs(id,project_id,default_fallback) VALUES(7,12,'https://example.test');
    INSERT INTO campaigns(id,name,project_id) VALUES(8,'Launch',12);
    INSERT INTO links(id,path,title,redirect_config_id,campaign_id,visitor_id) VALUES(9,'launch','Launch link',7,8,'visitor-5');
    INSERT INTO devices(id,ip,remote_ip,user_agent,platform,country_code) VALUES(5,'127.0.0.1','127.0.0.1','test','ios','CH');
    INSERT INTO visitors(id,project_id,external_id,device_id) VALUES('visitor-5','12','customer-5',5);
    INSERT INTO actions(id,device_id,link_id,handled,created_at) VALUES(11,5,9,1,'2026-02-02 09:00:00');
    INSERT INTO events(id,device_id,project_id,link_id,event,platform,data,engagement_time,created_at)
      SELECT 12,5,12,9,'view','ios','{"screen":"home"}',NULL,'2026-02-02 10:00:00'
      UNION ALL SELECT 13,5,12,9,'time_spent','ios','{}',45,'2026-02-02 10:01:00';
    INSERT INTO purchase_events(id,project_id,device_id,visitor_id,event_type,amount,currency,occurred_at,link_id,quantity,price_cents,usd_price_cents)
      SELECT 'purchase-14','12','5','visitor-5','buy',12.99,'CHF','2026-02-02 10:02:00',9,2,1299,1400
      UNION ALL SELECT 'refund-15','12','5','visitor-5','refund',4.00,'CHF','2026-02-02 10:03:00',9,1,400,400
      UNION ALL SELECT 'cancel-16','12','5','visitor-5','cancellation',12.99,'CHF','2026-02-02 10:04:00',9,1,1299,1400
      UNION ALL SELECT 'reversal-17','12','5','visitor-5','refund_reversed',7.00,'CHF','2026-02-02 10:05:00',9,1,700,700;
    INSERT INTO applications(id,platform,instance_id,enabled,updated_at) VALUES(2,'android',10,1,'2026-02-01');
    INSERT INTO android_configurations(application_id,identifier,sha256s) VALUES(2,'new.app','["new"]');
    INSERT INTO billing_products(id,project_id,store,environment,store_product_id,product_type,display_name,active)
      SELECT 'p-apple',12,'apple','production','pro','subscription','Pro',1
      UNION ALL SELECT 'p-google',12,'google','production','pro','subscription','Pro',1;
    INSERT INTO billing_offerings(id,project_id,identifier,placement,active,metadata) VALUES('off',12,'default','default',1,'{}');
    INSERT INTO billing_packages(id,offering_id,identifier,package_type,metadata) VALUES('pkg','off','monthly','monthly','{}');
    INSERT INTO billing_package_products(package_id,product_id) VALUES('pkg','p-apple'),('pkg','p-google');
    INSERT INTO billing_transactions(id,project_id,product_id,store,environment,store_transaction_id,event_type,status,raw_payload,created_at)
      SELECT 'tx-old',12,'p-apple','apple','production','external-1','created','active','{}','2026-01-01'
      UNION ALL SELECT 'tx-new',12,'p-apple','apple','production','external-1','renewed','active','{}','2026-02-01';
  `);
  const sdk = sourceRows("app.sdk_configurations");
  assert.equal(sdk.length, 1);
  assert.equal(JSON.parse(sdk[0].configuration_json).package_name, "new.app");
  const products = sourceRows("products.products");
  assert.equal(products.length, 1);
  const storeProducts = sourceRows("products.store_products");
  assert.equal(storeProducts.length, 2);
  assert.equal(new Set(storeProducts.map((row) => row.product_id)).size, 1);
  const purchases = sourceRows("products.purchases");
  assert.deepEqual(purchases.map((row) => row.id), ["tx-new"]);
  const redirects = sourceRows("dynamic-links.events");
  assert.equal(redirects.length, 1);
  assert.equal(redirects[0].id, "legacy-action-11");
  assert.equal(JSON.parse(redirects[0].metadata_json).cutover_source, "legacy_action");
  const analytics = sourceRows("dynamic-links.analytics_events");
  assert.deepEqual(analytics.map((row) => row.event_type), ["view", "time_spent"]);
  assert.equal(analytics[1].engagement_time, 45);
  assert.equal(analytics[0].campaign_id, "8");
  assert.equal(analytics[0].customer_id, "visitor-5");
  const conversions = sourceRows("dynamic-links.purchase_events");
  assert.deepEqual(conversions.map((row) => row.id), ["legacy-purchase-purchase-14", "legacy-purchase-reversal-17"]);
  assert.deepEqual(conversions.map((row) => row.revenue_cents), [2800, 700]);
  assert.equal(conversions[0].campaign_id, "8");
  const customerEvents = sourceRows("app.customer_events");
  assert.deepEqual(customerEvents.map((row) => row.event_type), ["view", "time_spent"]);
  assert.equal(customerEvents[0].customer_id, "visitor-5");
  assert.equal(customerEvents[0].referrer_customer_id, "visitor-5");
  assert.equal(customerEvents[1].engagement_time, 45);
  const customerPurchases = sourceRows("app.customer_purchase_events");
  assert.deepEqual(customerPurchases.map((row) => row.id), [
    "legacy-purchase-purchase-14",
    "legacy-purchase-refund-15",
    "legacy-purchase-reversal-17",
  ]);
  assert.deepEqual(customerPurchases.map((row) => row.event_type), ["purchase", "refund", "purchase"]);
  assert.deepEqual(customerPurchases.map((row) => row.revenue_cents), [2800, 400, 700]);
  assert.equal(customerPurchases[0].referrer_customer_id, "visitor-5");
  const referrals = sourceRows("app.referrals");
  assert.equal(referrals.length, 1);
  assert.equal(referrals[0].customer_id, "visitor-5");
  const socialPreviewEntity = MODULE_CUTOVER_REGISTRY.find((candidate) => candidate.id === "dynamic-links.social_preview");
  const socialPreview = sourceRows("dynamic-links.social_preview");
  assert.equal(socialPreview.length, 1);
  assert.equal(Object.hasOwn(socialPreview[0], "image_url"), true);
  assert.equal(socialPreview[0].image_url, null);
  assert.doesNotThrow(() => normalizeRows(socialPreview, socialPreviewEntity));
  const packageGuard = MODULE_CUTOVER_GUARDS.find((guard) => guard.id === "products.package_multi_product_requires_schema");
  assert.deepEqual(JSON.parse(query(databases.billing, render(packageGuard.source.query)) || "[]"), []);
});

function createDatabase(name, migrationsDirectory) {
  const database = join(temporary, `${name}.db`);
  const directory = resolve(repositoryRoot, migrationsDirectory);
  for (const filename of readdirSync(directory).filter((value) => value.endsWith(".sql")).sort()) {
    execFileSync("sqlite3", [database], { input: readFileSync(join(directory, filename)), stdio: ["pipe", "pipe", "pipe"] });
  }
  return database;
}

function query(database, sql) {
  return execFileSync("sqlite3", ["-json", database, sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function execute(database, sql) {
  execFileSync("sqlite3", [database, sql], { stdio: ["ignore", "pipe", "pipe"] });
}

function sourceRows(id) {
  const entity = MODULE_CUTOVER_REGISTRY.find((candidate) => candidate.id === id);
  return JSON.parse(query(databases[entity.source.database], render(entity.source.query)) || "[]");
}

function render(sql) {
  return sql.replaceAll(":project_id", "12").replaceAll(":instance_id", "10").replaceAll(":is_test", "1");
}
