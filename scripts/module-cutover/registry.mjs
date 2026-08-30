import { createHash } from "node:crypto";

// The registry is deliberately declarative: ordering captures foreign-key dependencies,
// SQL aliases produce the exact target row shape, and the engine owns execution.

const j = (...columns) => columns;

function entity(definition) {
  const owner = pluginOwner(definition);
  const targetTable = definition.target?.table ?? definition.id.split(".").at(-1);
  return Object.freeze({
    jsonColumns: [],
    keys: ["id"],
    ...definition,
    pluginId: owner,
    storeId: `${owner}.store.${targetTable}`,
    repositoryId: `${owner}.repository.${targetTable}`,
  });
}

function pluginOwner(definition) {
  if (definition.module === "products") return "supbrd-plug-products";
  if (definition.module === "paywalls") return "supbrd-plugmod-paywalls";
  if (definition.module === "dynamic-links") return "supbrd-plugmod-dynamic-links";
  if (definition.module === "support") return "supbrd-plugmod-support";
  if (definition.module === "analytics") return "supbrd-plugmod-analytics";
  if (definition.module === "marketing") return "supbrd-plugmod-marketing";
  if (definition.module === "onboardings") return "supbrd-plugmod-onboardings";
  if (definition.id === "app.sdk_configurations") return "supbrd-plug-settings";
  if (definition.id.includes("events") || definition.id.includes("metrics")) {
    return "supbrd-plugmod-analytics";
  }
  return "supbrd-plug-user";
}

function copySupport(id, sourceTable, targetTable, columns, options = {}) {
  const select = columns.map((column) => `s."${column}"`).join(", ");
  const directProject = columns.includes("project_id");
  return entity({
    id: `support.${id}`,
    module: "support",
    columns,
    jsonColumns: columns.filter((column) => column.endsWith("_json")),
    keys: options.keys || ["id"],
    projectColumn: directProject ? "project_id" : undefined,
    source: {
      database: "messaging",
      table: sourceTable,
      query: directProject
        ? `SELECT ${select} FROM "${sourceTable}" s WHERE s.project_id=:project_id ORDER BY ${options.orderBy || columns[0]}`
        : options.sourceQuery,
    },
    target: {
      table: targetTable,
      query: directProject
        ? `SELECT ${columns.map((column) => `s."${column}"`).join(", ")} FROM "${targetTable}" s WHERE s.project_id=:project_id ORDER BY ${options.orderBy || columns[0]}`
        : options.targetQuery,
    },
    reverse: (row) => row,
    reverseColumns: columns,
    reverseKeys: options.keys || ["id"],
    immutable: options.immutable === true,
  });
}

export const MODULE_CUTOVER_REGISTRY = Object.freeze([
  entity({
    id: "app.customers",
    module: "app",
    columns: j("id", "project_id", "external_id", "attributes_json", "email", "name", "platform", "country_code", "first_seen_at", "last_seen_at", "created_at", "updated_at"),
    jsonColumns: ["attributes_json"],
    projectColumn: "project_id",
    source: {
      database: "api",
      table: "visitors",
      query: `SELECT id, CAST(project_id AS TEXT) project_id,
        COALESCE(NULLIF(external_id,''),NULLIF(anonymous_id,''),id) external_id,
        json_object('phone',phone,'language',language,'city',city,'region',region,'timezone',timezone,
          'os',os,'os_version',os_version,'device_type',device_type,'device_model',device_model,
          'browser',browser,'browser_version',browser_version,'app_version',app_version,'sdk_version',sdk_version,
          'properties',CASE WHEN json_valid(properties) THEN json(properties) ELSE json('{}') END,
          'tags',CASE WHEN json_valid(tags) THEN json(tags) ELSE json('[]') END) attributes_json,
        email, COALESCE(NULLIF(name,''),TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,''))) name,
        CASE WHEN lower(COALESCE(os,'')) LIKE '%ios%' THEN 'ios'
             WHEN lower(COALESCE(os,'')) LIKE '%android%' THEN 'android' ELSE 'web' END platform,
        country country_code, COALESCE(first_seen_at,created_at) first_seen_at,
        COALESCE(last_seen_at,updated_at,created_at) last_seen_at, created_at, updated_at
        FROM visitors WHERE project_id=:project_id ORDER BY id`,
    },
    target: { table: "customers", query: "SELECT id,project_id,external_id,attributes_json,email,name,platform,country_code,first_seen_at,last_seen_at,created_at,updated_at FROM customers WHERE project_id=CAST(:project_id AS TEXT) ORDER BY id" },
  }),
  entity({
    id: "app.referrals",
    module: "app",
    columns: j("id", "project_id", "customer_id", "invited_customer_id", "code", "source", "status", "converted_at", "created_at"),
    projectColumn: "project_id",
    source: {
      database: "api",
      table: "links",
      query: `SELECT 'legacy-referral-'||v.id id,CAST(v.project_id AS TEXT) project_id,v.id customer_id,NULL invited_customer_id,
        COALESCE(NULLIF(v.sdk_identifier,''),NULLIF(v.uuid,''),v.id) code,'legacy_dynamic_link' source,'converted' status,
        (SELECT MIN(l.created_at) FROM links l JOIN redirect_configs rc ON rc.id=l.redirect_config_id WHERE rc.project_id=:project_id AND CAST(l.visitor_id AS TEXT)=v.id) converted_at,
        COALESCE(v.created_at,(SELECT MIN(l.created_at) FROM links l JOIN redirect_configs rc ON rc.id=l.redirect_config_id WHERE rc.project_id=:project_id AND CAST(l.visitor_id AS TEXT)=v.id)) created_at
        FROM visitors v WHERE v.project_id=CAST(:project_id AS TEXT) AND EXISTS (
          SELECT 1 FROM links l JOIN redirect_configs rc ON rc.id=l.redirect_config_id
          WHERE rc.project_id=:project_id AND CAST(l.visitor_id AS TEXT)=v.id
        ) ORDER BY v.id`,
    },
    target: { table: "referrals", query: "SELECT id,project_id,customer_id,invited_customer_id,code,source,status,converted_at,created_at FROM referrals WHERE project_id=CAST(:project_id AS TEXT) AND source='legacy_dynamic_link' ORDER BY id" },
  }),
  entity({
    id: "app.customer_events",
    module: "app",
    columns: j("id", "project_id", "customer_id", "referrer_customer_id", "event_type", "platform", "occurred_at", "revenue_cents", "engagement_time", "metadata_json"),
    keys: ["project_id", "id"],
    jsonColumns: ["metadata_json"],
    projectColumn: "project_id",
    source: {
      database: "api",
      table: "events",
      query: `SELECT 'legacy-event-'||e.id id,CAST(e.project_id AS TEXT) project_id,
        (SELECT v.id FROM visitors v WHERE v.project_id=CAST(e.project_id AS TEXT) AND v.device_id=e.device_id ORDER BY v.id LIMIT 1) customer_id,
        (SELECT v.id FROM visitors v WHERE v.project_id=CAST(e.project_id AS TEXT) AND v.id=CAST(l.visitor_id AS TEXT) LIMIT 1) referrer_customer_id,
        e.event event_type,COALESCE(e.platform,d.platform) platform,e.created_at occurred_at,0 revenue_cents,
        CASE WHEN e.event='time_spent' THEN MAX(COALESCE(e.engagement_time,0),0) ELSE 0 END engagement_time,
        json_object('cutover_source','legacy_event','legacy_device_id',e.device_id,'link_id',e.link_id,'path',e.path,
          'legacy_data',CASE WHEN json_valid(e.data) THEN json(e.data) ELSE e.data END) metadata_json
        FROM events e LEFT JOIN devices d ON d.id=e.device_id LEFT JOIN links l ON l.id=e.link_id
        WHERE e.project_id=:project_id AND e.event IN ('view','open','install','reinstall','reactivation','app_open','user_referred','time_spent')
        ORDER BY e.id`,
    },
    target: { table: "customer_events", query: "SELECT id,project_id,customer_id,referrer_customer_id,event_type,platform,occurred_at,revenue_cents,engagement_time,metadata_json FROM customer_events WHERE project_id=CAST(:project_id AS TEXT) AND json_extract(metadata_json,'$.cutover_source')='legacy_event' ORDER BY id" },
  }),
  entity({
    id: "app.customer_purchase_events",
    module: "app",
    columns: j("id", "project_id", "customer_id", "referrer_customer_id", "event_type", "platform", "occurred_at", "revenue_cents", "engagement_time", "metadata_json"),
    keys: ["project_id", "id"],
    jsonColumns: ["metadata_json"],
    projectColumn: "project_id",
    source: {
      database: "api",
      table: "purchase_events",
      query: `SELECT 'legacy-purchase-'||pe.id id,CAST(pe.project_id AS TEXT) project_id,
        COALESCE(CAST(pe.visitor_id AS TEXT),(SELECT v.id FROM visitors v WHERE v.project_id=CAST(pe.project_id AS TEXT) AND v.device_id=pe.device_id ORDER BY v.id LIMIT 1)) customer_id,
        (SELECT v.id FROM visitors v WHERE v.project_id=CAST(pe.project_id AS TEXT) AND v.id=CAST(l.visitor_id AS TEXT) LIMIT 1) referrer_customer_id,
        CASE WHEN lower(pe.event_type) IN ('refund','refunded') THEN 'refund' ELSE 'purchase' END event_type,
        d.platform,COALESCE(pe.date,pe.occurred_at,pe.created_at) occurred_at,
        MAX(COALESCE(pe.usd_price_cents,pe.price_cents,CAST(ROUND(COALESCE(pe.amount,0)*100) AS INTEGER),0)*COALESCE(pe.quantity,1),0) revenue_cents,
        0 engagement_time,json_object('cutover_source','legacy_purchase','legacy_event_type',pe.event_type,'currency',pe.currency,
          'transaction_id',pe.transaction_id,'product_id',COALESCE(pe.product_id,pe.in_app_product_id),'link_id',pe.link_id) metadata_json
        FROM purchase_events pe LEFT JOIN devices d ON d.id=pe.device_id LEFT JOIN links l ON l.id=pe.link_id
        WHERE pe.project_id=CAST(:project_id AS TEXT)
          AND lower(pe.event_type) IN ('buy','refund_reversed','refund','refunded')
        ORDER BY pe.id`,
    },
    target: { table: "customer_events", query: "SELECT id,project_id,customer_id,referrer_customer_id,event_type,platform,occurred_at,revenue_cents,engagement_time,metadata_json FROM customer_events WHERE project_id=CAST(:project_id AS TEXT) AND json_extract(metadata_json,'$.cutover_source')='legacy_purchase' ORDER BY id" },
  }),
  entity({
    id: "app.sdk_configurations",
    module: "app",
    columns: j("id", "project_id", "platform", "status", "configuration_json", "verified_at", "created_at", "updated_at"),
    jsonColumns: ["configuration_json"],
    projectColumn: "project_id",
    source: {
      database: "api",
      table: "applications",
      query: `SELECT 'sdk-' || :project_id || '-' || a.platform id, CAST(:project_id AS TEXT) project_id,
        CASE WHEN a.platform IN ('ios','android') THEN a.platform ELSE 'web' END platform,
        CASE WHEN a.enabled<>1 THEN 'error'
             WHEN a.platform='ios' AND COALESCE(i.bundle_id,'')<>'' AND COALESCE(i.app_prefix,'')<>'' THEN 'configured'
             WHEN a.platform='android' AND COALESCE(n.identifier,'')<>'' AND json_valid(n.sha256s) AND json_array_length(n.sha256s)>0 THEN 'configured'
             WHEN a.platform NOT IN ('ios','android') AND COALESCE(w.site_url,'')<>'' THEN 'configured' ELSE 'error' END status,
        CASE WHEN a.platform='ios' THEN json_object('bundle_id',i.bundle_id,'team_id',i.app_prefix,'app_prefix',i.app_prefix,'tablet_enabled',i.tablet_enabled)
             WHEN a.platform='android' THEN json_object('package_name',n.identifier,'identifier',n.identifier,'sha256',json_extract(CASE WHEN json_valid(n.sha256s) THEN n.sha256s ELSE '[]' END,'$[0]'),'sha256s',CASE WHEN json_valid(n.sha256s) THEN json(n.sha256s) ELSE json('[]') END,'tablet_enabled',n.tablet_enabled)
             ELSE json_object('domain',w.site_url,'site_url',w.site_url,'service_worker_path',w.service_worker_path,'vapid_public_key',w.vapid_public_key) END configuration_json,
        NULL verified_at, a.created_at, a.updated_at
        FROM applications a LEFT JOIN ios_configurations i ON i.application_id=a.id
        LEFT JOIN android_configurations n ON n.application_id=a.id
        LEFT JOIN web_configurations w ON w.application_id=a.id
        WHERE a.instance_id=:instance_id AND a.id=(SELECT candidate.id FROM applications candidate
          WHERE candidate.instance_id=a.instance_id AND candidate.platform=a.platform
          ORDER BY candidate.enabled DESC,candidate.updated_at DESC,candidate.id DESC LIMIT 1)
        ORDER BY a.platform,a.id`,
    },
    target: { table: "sdk_configurations", query: "SELECT id,project_id,platform,status,configuration_json,verified_at,created_at,updated_at FROM sdk_configurations WHERE project_id=CAST(:project_id AS TEXT) ORDER BY id" },
  }),
  entity({
    id: "app.access_keys",
    module: "app",
    columns: j("id", "project_id", "key_hash", "prefix", "created_by", "last_used_at", "revoked_at", "created_at"),
    projectColumn: "project_id",
    source: {
      database: "api",
      table: "instances",
      query: "SELECT id,api_key,created_at FROM instances WHERE id=:instance_id",
    },
    transform: (rows, context) => rows.map((row) => {
      const legacyKey = context.environment === "test" ? `test_${row.api_key}` : String(row.api_key);
      return {
        id: `legacy-access-${context.project_id}`,
        project_id: String(context.project_id),
        key_hash: createHash("sha256").update(legacyKey).digest("hex"),
        prefix: `legacy_${createHash("sha256").update(legacyKey).digest("hex").slice(0, 8)}`,
        created_by: "legacy-cutover",
        last_used_at: null,
        revoked_at: null,
        created_at: row.created_at,
      };
    }),
    target: { table: "access_keys", query: "SELECT id,project_id,key_hash,prefix,created_by,last_used_at,revoked_at,created_at FROM access_keys WHERE project_id=CAST(:project_id AS TEXT) ORDER BY id" },
  }),
  entity({
    id: "app.daily_metrics",
    module: "app",
    columns: j("project_id", "metric_date", "platform", "active_customers", "new_customers", "referrals", "installs", "opens"),
    keys: ["project_id", "metric_date", "platform"],
    projectColumn: "project_id",
    source: {
      database: "api",
      table: "visitor_daily_statistics",
      query: `SELECT CAST(project_id AS TEXT) project_id,date metric_date,'web' platform,
        COUNT(DISTINCT visitor_id) active_customers,0 new_customers,0 referrals,0 installs,
        COALESCE(SUM(page_views),0) opens FROM visitor_daily_statistics
        WHERE project_id=:project_id GROUP BY project_id,date ORDER BY date`,
    },
    target: { table: "daily_metrics", query: "SELECT project_id,metric_date,platform,active_customers,new_customers,referrals,installs,opens FROM daily_metrics WHERE project_id=CAST(:project_id AS TEXT) ORDER BY metric_date,platform" },
  }),

  entity({
    id: "products.financial_customers",
    module: "products",
    columns: j("id", "project_id", "external_customer_id", "attributes_json", "created_at", "updated_at"),
    jsonColumns: ["attributes_json"], projectColumn: "project_id",
    source: { database: "billing", table: "billing_customers", query: "SELECT id,CAST(project_id AS TEXT) project_id,primary_app_user_id external_customer_id,attributes attributes_json,created_at,updated_at FROM billing_customers WHERE project_id=:project_id ORDER BY id" },
    target: { table: "financial_customers", query: "SELECT id,project_id,external_customer_id,attributes_json,created_at,updated_at FROM financial_customers WHERE project_id=CAST(:project_id AS TEXT) ORDER BY id" },
  }),
  entity({
    id: "products.products",
    module: "products",
    columns: j("id", "project_id", "identifier", "display_name", "description", "product_type", "status", "created_at", "updated_at"), projectColumn: "project_id",
    source: { database: "billing", table: "billing_products", query: `SELECT id,CAST(project_id AS TEXT) project_id,store_product_id identifier,COALESCE(NULLIF(display_name,''),store_product_id) display_name,description,
      CASE WHEN product_type IN ('subscription','non_consumable','consumable') THEN product_type ELSE 'subscription' END product_type,
      CASE WHEN active=1 THEN 'active' ELSE 'archived' END status,created_at,updated_at FROM billing_products p
      WHERE project_id=:project_id AND p.id=(SELECT MIN(candidate.id) FROM billing_products candidate WHERE candidate.project_id=p.project_id AND candidate.store_product_id=p.store_product_id) ORDER BY id` },
    target: { table: "products", query: "SELECT id,project_id,identifier,display_name,description,product_type,status,created_at,updated_at FROM products WHERE project_id=CAST(:project_id AS TEXT) ORDER BY id" },
  }),
  entity({
    id: "products.store_products",
    module: "products",
    columns: j("id", "project_id", "product_id", "store", "environment", "store_product_id", "title", "description", "price_micros", "currency", "billing_period", "trial_period", "active", "metadata_json", "synced_at", "created_at", "updated_at"),
    jsonColumns: ["metadata_json"], projectColumn: "project_id",
    source: { database: "billing", table: "billing_products", query: `SELECT 'store-'||p.id id,CAST(p.project_id AS TEXT) project_id,
      (SELECT MIN(candidate.id) FROM billing_products candidate WHERE candidate.project_id=p.project_id AND candidate.store_product_id=p.store_product_id) product_id,
      CASE WHEN p.store IN ('apple','google','stripe','manual') THEN p.store ELSE 'manual' END store,
      CASE WHEN p.environment='sandbox' THEN 'sandbox' ELSE 'production' END environment,p.store_product_id,
      p.display_name title,p.description,pr.price_micros,pr.currency,pr.billing_period,pr.trial_period,p.active,p.metadata metadata_json,
      p.updated_at synced_at,p.created_at,p.updated_at FROM billing_products p
      LEFT JOIN billing_product_prices pr ON pr.id=(SELECT id FROM billing_product_prices x WHERE x.product_id=p.id AND x.active=1 ORDER BY x.updated_at DESC LIMIT 1)
      WHERE p.project_id=:project_id ORDER BY p.id` },
    target: { table: "store_products", query: "SELECT id,project_id,product_id,store,environment,store_product_id,title,description,price_micros,currency,billing_period,trial_period,active,metadata_json,synced_at,created_at,updated_at FROM store_products WHERE project_id=CAST(:project_id AS TEXT) ORDER BY id" },
  }),
  entity({
    id: "products.entitlements",
    module: "products",
    columns: j("id", "project_id", "key", "name", "description", "active", "created_at", "updated_at"), projectColumn: "project_id",
    source: { database: "billing", table: "billing_entitlements", query: "SELECT id,CAST(project_id AS TEXT) project_id,identifier key,COALESCE(NULLIF(display_name,''),identifier) name,description,active,created_at,updated_at FROM billing_entitlements WHERE project_id=:project_id ORDER BY id" },
    target: { table: "entitlements", query: "SELECT id,project_id,key,name,description,active,created_at,updated_at FROM entitlements WHERE project_id=CAST(:project_id AS TEXT) ORDER BY id" },
  }),
  entity({
    id: "products.entitlement_products",
    module: "products", columns: j("entitlement_id", "product_id"), keys: ["entitlement_id", "product_id"],
    source: { database: "billing", table: "billing_product_entitlements", query: `SELECT DISTINCT pe.entitlement_id,
      (SELECT MIN(candidate.id) FROM billing_products candidate WHERE candidate.project_id=p.project_id AND candidate.store_product_id=p.store_product_id) product_id
      FROM billing_product_entitlements pe JOIN billing_products p ON p.id=pe.product_id WHERE p.project_id=:project_id ORDER BY pe.entitlement_id,product_id` },
    target: { table: "entitlement_products", query: "SELECT ep.entitlement_id,ep.product_id FROM entitlement_products ep JOIN entitlements e ON e.id=ep.entitlement_id WHERE e.project_id=CAST(:project_id AS TEXT) ORDER BY ep.entitlement_id,ep.product_id" },
  }),
  entity({
    id: "products.offerings",
    module: "products",
    columns: j("id", "project_id", "placement", "name", "packages_json", "priority", "active", "updated_at", "identifier", "description", "created_at"),
    jsonColumns: ["packages_json"], projectColumn: "project_id",
    source: { database: "billing", table: "billing_offerings", query: `SELECT o.id,CAST(o.project_id AS TEXT) project_id,o.placement,COALESCE(NULLIF(o.display_name,''),o.identifier) name,
      COALESCE((SELECT json_group_array(json_object('id',p.id,'identifier',p.identifier,'type',p.package_type,'position',p.position)) FROM billing_packages p WHERE p.offering_id=o.id),'[]') packages_json,
      CASE WHEN o.is_current=1 THEN 100 ELSE 0 END priority,o.active,o.updated_at,o.identifier,o.description,o.created_at
      FROM billing_offerings o WHERE o.project_id=:project_id ORDER BY o.id` },
    target: { table: "offerings", query: "SELECT id,project_id,placement,name,packages_json,priority,active,updated_at,identifier,description,created_at FROM offerings WHERE project_id=CAST(:project_id AS TEXT) ORDER BY id" },
  }),
  entity({
    id: "products.packages",
    module: "products",
    columns: j("id", "project_id", "identifier", "display_name", "description", "product_id", "position", "active", "created_at", "updated_at"), projectColumn: "project_id",
    source: { database: "billing", table: "billing_packages", query: `SELECT p.id,CAST(o.project_id AS TEXT) project_id,p.identifier,p.identifier display_name,
      json_extract(p.metadata,'$.description') description,(SELECT MIN(candidate.id) FROM billing_package_products pp
        JOIN billing_products linked ON linked.id=pp.product_id JOIN billing_products candidate ON candidate.project_id=linked.project_id AND candidate.store_product_id=linked.store_product_id
        WHERE pp.package_id=p.id) product_id,
      p.position,o.active,p.created_at,p.updated_at FROM billing_packages p JOIN billing_offerings o ON o.id=p.offering_id WHERE o.project_id=:project_id ORDER BY p.id` },
    target: { table: "packages", query: "SELECT id,project_id,identifier,display_name,description,product_id,position,active,created_at,updated_at FROM packages WHERE project_id=CAST(:project_id AS TEXT) ORDER BY id" },
  }),
  entity({
    id: "products.offering_packages",
    module: "products", columns: j("offering_id", "package_id", "position"), keys: ["offering_id", "package_id"],
    source: { database: "billing", table: "billing_packages", query: "SELECT p.offering_id,p.id package_id,p.position FROM billing_packages p JOIN billing_offerings o ON o.id=p.offering_id WHERE o.project_id=:project_id ORDER BY p.offering_id,p.position,p.id" },
    target: { table: "offering_packages", query: "SELECT op.offering_id,op.package_id,op.position FROM offering_packages op JOIN offerings o ON o.id=op.offering_id WHERE o.project_id=CAST(:project_id AS TEXT) ORDER BY op.offering_id,op.position,op.package_id" },
  }),
  entity({
    id: "products.purchases",
    module: "products",
    columns: j("id", "project_id", "financial_customer_id", "product_id", "status", "purchased_at", "payload_json", "store", "environment", "external_transaction_id", "original_transaction_id", "purchased_price_micros", "currency", "expires_at", "updated_at"),
    jsonColumns: ["payload_json"], projectColumn: "project_id",
    source: { database: "billing", table: "billing_transactions", query: `SELECT t.id,CAST(t.project_id AS TEXT) project_id,COALESCE(t.customer_id,'unknown') financial_customer_id,
      COALESCE((SELECT MIN(candidate.id) FROM billing_products linked JOIN billing_products candidate ON candidate.project_id=linked.project_id AND candidate.store_product_id=linked.store_product_id WHERE linked.id=t.product_id),'unknown') product_id,
      CASE WHEN status IN ('active','completed','purchased','trialing') THEN 'active' WHEN status IN ('refunded','cancelled','expired') THEN status ELSE 'pending' END status,
      COALESCE(purchased_at,created_at) purchased_at,CASE WHEN json_valid(raw_payload) THEN raw_payload ELSE json_object('legacy_payload',raw_payload) END payload_json,
      CASE WHEN store IN ('apple','google','stripe','manual') THEN store ELSE 'manual' END store,CASE WHEN environment='sandbox' THEN 'sandbox' ELSE 'production' END environment,
      store_transaction_id external_transaction_id,original_transaction_id,COALESCE(price_micros,0) purchased_price_micros,currency,expires_at,COALESCE(verified_at,created_at) updated_at
      FROM billing_transactions t WHERE t.project_id=:project_id AND t.id=(SELECT candidate.id FROM billing_transactions candidate
        WHERE candidate.project_id=t.project_id AND candidate.store=t.store AND candidate.environment=t.environment AND candidate.store_transaction_id=t.store_transaction_id
        ORDER BY COALESCE(candidate.purchased_at,candidate.created_at) DESC,candidate.created_at DESC,candidate.id DESC LIMIT 1) ORDER BY t.id` },
    target: { table: "purchases", query: "SELECT id,project_id,financial_customer_id,product_id,status,purchased_at,payload_json,store,environment,external_transaction_id,original_transaction_id,purchased_price_micros,currency,expires_at,updated_at FROM purchases WHERE project_id=CAST(:project_id AS TEXT) ORDER BY id" },
  }),
  entity({
    id: "products.subscriptions",
    module: "products",
    columns: j("id", "project_id", "financial_customer_id", "product_id", "latest_purchase_id", "store", "environment", "original_transaction_id", "status", "current_period_started_at", "current_period_ends_at", "auto_renew", "cancelled_at", "created_at", "updated_at"), projectColumn: "project_id",
    source: { database: "billing", table: "billing_subscriptions", query: `SELECT s.id,CAST(s.project_id AS TEXT) project_id,COALESCE(s.customer_id,'unknown') financial_customer_id,
      (SELECT MIN(candidate.id) FROM billing_products linked JOIN billing_products candidate ON candidate.project_id=linked.project_id AND candidate.store_product_id=linked.store_product_id WHERE linked.id=s.product_id) product_id,
      s.latest_transaction_id latest_purchase_id,
      CASE WHEN store IN ('apple','google','stripe','manual') THEN store ELSE 'manual' END store,CASE WHEN environment='sandbox' THEN 'sandbox' ELSE 'production' END environment,original_transaction_id,
      CASE WHEN status IN ('trialing','active','grace_period','paused','expired','cancelled','refunded') THEN status WHEN status='canceled' THEN 'cancelled' ELSE 'expired' END status,
      starts_at current_period_started_at,expires_at current_period_ends_at,auto_renews auto_renew,CASE WHEN will_renew=0 AND status IN ('cancelled','canceled') THEN updated_at ELSE NULL END cancelled_at,created_at,updated_at
      FROM billing_subscriptions s WHERE s.project_id=:project_id ORDER BY s.id` },
    target: { table: "subscriptions", query: "SELECT id,project_id,financial_customer_id,product_id,latest_purchase_id,store,environment,original_transaction_id,status,current_period_started_at,current_period_ends_at,auto_renew,cancelled_at,created_at,updated_at FROM subscriptions WHERE project_id=CAST(:project_id AS TEXT) ORDER BY id" },
  }),
  entity({
    id: "products.refunds",
    module: "products",
    columns: j("id", "project_id", "purchase_id", "external_refund_id", "status", "amount_micros", "currency", "reason", "metadata_json", "requested_at", "completed_at", "updated_at"),
    jsonColumns: ["metadata_json"], projectColumn: "project_id",
    source: { database: "billing", table: "billing_refund_cases", query: `SELECT id,CAST(project_id AS TEXT) project_id,transaction_id purchase_id,provider_case_id external_refund_id,
      CASE WHEN status IN ('open','evidence_required','awaiting_approval') THEN 'requested' WHEN status='submitted' THEN 'processing' WHEN status IN ('won','closed') THEN 'completed' WHEN status='lost' THEN 'rejected' ELSE 'cancelled' END status,
      COALESCE(amount_micros,0) amount_micros,currency,reason,json_object('provider',provider,'environment',environment,'case_type',case_type,'provider_payload',CASE WHEN json_valid(provider_payload) THEN json(provider_payload) ELSE provider_payload END) metadata_json,
      opened_at requested_at,resolved_at completed_at,updated_at FROM billing_refund_cases WHERE project_id=:project_id AND transaction_id IS NOT NULL ORDER BY id` },
    target: { table: "refunds", query: "SELECT id,project_id,purchase_id,external_refund_id,status,amount_micros,currency,reason,metadata_json,requested_at,completed_at,updated_at FROM refunds WHERE project_id=CAST(:project_id AS TEXT) ORDER BY id" },
  }),

  entity({
    id: "paywalls.paywalls", module: "paywalls",
    columns: j("id", "project_id", "name", "created_at", "identifier", "description", "archived_at", "updated_at"), projectColumn: "project_id",
    source: { database: "billing", table: "billing_paywalls", query: "SELECT id,CAST(project_id AS TEXT) project_id,display_name name,created_at,identifier,NULL description,NULL archived_at,updated_at FROM billing_paywalls WHERE project_id=:project_id ORDER BY id" },
    target: { table: "paywalls", query: "SELECT id,project_id,name,created_at,identifier,description,archived_at,updated_at FROM paywalls WHERE project_id=CAST(:project_id AS TEXT) ORDER BY id" },
  }),
  entity({
    id: "paywalls.versions", module: "paywalls",
    columns: j("id", "paywall_id", "version", "status", "definition_json", "created_at", "project_id", "schema_version", "changelog", "created_by", "published_at"), jsonColumns: ["definition_json"], projectColumn: "project_id",
    source: { database: "billing", table: "billing_paywall_versions", query: `SELECT v.id,v.paywall_id,v.version,
      CASE WHEN v.state IN ('draft','published','archived') THEN v.state ELSE 'draft' END status,v.configuration definition_json,v.created_at,
      CAST(p.project_id AS TEXT) project_id,1 schema_version,NULL changelog,v.created_by,v.published_at
      FROM billing_paywall_versions v JOIN billing_paywalls p ON p.id=v.paywall_id WHERE p.project_id=:project_id ORDER BY v.paywall_id,v.version` },
    target: { table: "paywall_versions", query: "SELECT id,paywall_id,version,status,definition_json,created_at,project_id,schema_version,changelog,created_by,published_at FROM paywall_versions WHERE project_id=CAST(:project_id AS TEXT) ORDER BY paywall_id,version" },
  }),
  entity({
    id: "paywalls.placements", module: "paywalls",
    columns: j("id", "project_id", "key", "active_version_id", "active", "paywall_id", "experience_id", "targeting_json", "priority", "created_at", "updated_at"), jsonColumns: ["targeting_json"], projectColumn: "project_id",
    source: { database: "billing", table: "billing_placements", query: `SELECT p.id,CAST(p.project_id AS TEXT) project_id,p.identifier key,w.active_version_id,p.active,w.id paywall_id,
      (SELECT e.id FROM billing_experiments e WHERE e.placement_id=p.id AND e.state='running' ORDER BY e.updated_at DESC LIMIT 1) experience_id,
      '{}' targeting_json,0 priority,p.created_at,p.updated_at
      FROM billing_placements p LEFT JOIN billing_paywalls w ON w.id=(SELECT id FROM billing_paywalls x WHERE x.project_id=p.project_id AND x.offering_id=p.default_offering_id ORDER BY x.updated_at DESC LIMIT 1)
      WHERE p.project_id=:project_id AND w.id IS NOT NULL
      UNION ALL
      SELECT 'target-'||r.id,CAST(r.project_id AS TEXT),p.identifier,w.active_version_id,CASE WHEN r.state='published' THEN 1 ELSE 0 END,w.id,NULL,r.conditions,r.priority,r.created_at,r.updated_at
      FROM billing_targeting_rules r JOIN billing_placements p ON p.id=r.placement_id
      JOIN billing_paywalls w ON w.id=(SELECT id FROM billing_paywalls x WHERE x.project_id=r.project_id AND x.offering_id=r.offering_id ORDER BY x.updated_at DESC LIMIT 1)
      WHERE r.project_id=:project_id ORDER BY 1` },
    target: { table: "placements", query: "SELECT id,project_id,key,active_version_id,active,paywall_id,experience_id,targeting_json,priority,created_at,updated_at FROM placements WHERE project_id=CAST(:project_id AS TEXT) ORDER BY id" },
  }),
  entity({
    id: "paywalls.experiences", module: "paywalls",
    columns: j("id", "project_id", "paywall_id", "name", "status", "traffic_percent", "starts_at", "ends_at", "created_at", "updated_at"), projectColumn: "project_id",
    source: { database: "billing", table: "billing_experiments", query: `SELECT e.id,CAST(e.project_id AS TEXT) project_id,w.id paywall_id,e.display_name name,
      CASE WHEN e.state IN ('draft','running','paused','completed','archived') THEN e.state ELSE 'draft' END status,100 traffic_percent,e.starts_at,e.ends_at,e.created_at,e.updated_at
      FROM billing_experiments e JOIN billing_paywalls w ON w.id=(SELECT pw.id FROM billing_experiment_variants v JOIN billing_paywalls pw ON pw.project_id=e.project_id AND pw.offering_id=v.offering_id WHERE v.experiment_id=e.id AND pw.active_version_id IS NOT NULL ORDER BY pw.updated_at DESC LIMIT 1)
      WHERE e.project_id=:project_id ORDER BY e.id` },
    target: { table: "experiences", query: "SELECT id,project_id,paywall_id,name,status,traffic_percent,starts_at,ends_at,created_at,updated_at FROM experiences WHERE project_id=CAST(:project_id AS TEXT) ORDER BY id" },
  }),
  entity({
    id: "paywalls.variants", module: "paywalls",
    columns: j("id", "project_id", "experience_id", "version_id", "key", "weight", "active", "created_at", "updated_at"), projectColumn: "project_id",
    source: { database: "billing", table: "billing_experiment_variants", query: `SELECT v.id,CAST(e.project_id AS TEXT) project_id,v.experiment_id,w.active_version_id version_id,v.identifier key,
      CASE WHEN v.weight BETWEEN 1 AND 10000 THEN v.weight ELSE 1 END weight,CASE WHEN e.state IN ('running','draft','paused') THEN 1 ELSE 0 END active,v.created_at,e.updated_at
      FROM billing_experiment_variants v JOIN billing_experiments e ON e.id=v.experiment_id
      JOIN billing_paywalls w ON w.id=(SELECT pw.id FROM billing_paywalls pw WHERE pw.project_id=e.project_id AND pw.offering_id=v.offering_id AND pw.active_version_id IS NOT NULL ORDER BY pw.updated_at DESC LIMIT 1)
      WHERE e.project_id=:project_id ORDER BY v.id` },
    target: { table: "variants", query: "SELECT id,project_id,experience_id,version_id,key,weight,active,created_at,updated_at FROM variants WHERE project_id=CAST(:project_id AS TEXT) ORDER BY id" },
  }),
  entity({
    id: "paywalls.events", module: "paywalls",
    columns: j("id", "project_id", "placement", "event_type", "occurred_at", "payload_json", "paywall_id", "version_id", "experience_id", "variant_id", "platform", "customer_id", "session_id", "revenue_micros", "currency"), jsonColumns: ["payload_json"], projectColumn: "project_id",
    source: { database: "billing", table: "billing_paywall_events", query: `SELECT id,CAST(project_id AS TEXT) project_id,COALESCE(placement_identifier,'default') placement,event_type,occurred_at,metadata payload_json,paywall_id,paywall_version_id version_id,experiment_id experience_id,variant_id,platform,customer_id,NULL session_id,0 revenue_micros,NULL currency FROM billing_paywall_events WHERE project_id=:project_id ORDER BY id` },
    target: { table: "events", query: "SELECT id,project_id,placement,event_type,occurred_at,payload_json,paywall_id,version_id,experience_id,variant_id,platform,customer_id,session_id,revenue_micros,currency FROM events WHERE project_id=CAST(:project_id AS TEXT) ORDER BY id" },
  }),

  entity({
    id: "dynamic-links.campaigns", module: "dynamic-links",
    columns: j("id", "project_id", "name", "created_at", "slug", "status", "metadata_json", "updated_at"), jsonColumns: ["metadata_json"], projectColumn: "project_id",
    source: { database: "api", table: "campaigns", query: "SELECT CAST(id AS TEXT) id,CAST(project_id AS TEXT) project_id,COALESCE(NULLIF(name,''),'Campaign '||id) name,created_at,'legacy-'||id slug,CASE WHEN archived=1 THEN 'archived' ELSE 'active' END status,'{}' metadata_json,updated_at FROM campaigns WHERE project_id=:project_id ORDER BY id" },
    target: { table: "campaigns", query: "SELECT id,project_id,name,created_at,slug,status,metadata_json,updated_at FROM campaigns WHERE project_id=CAST(:project_id AS TEXT) ORDER BY id" },
  }),
  entity({
    id: "dynamic-links.links", module: "dynamic-links",
    columns: j("id", "project_id", "slug", "destination_url", "active", "created_at", "name", "destinations_json", "campaign_id", "title", "subtitle", "image_url", "utm_json", "updated_at"), jsonColumns: ["destinations_json", "utm_json"], projectColumn: "project_id",
    source: { database: "api", table: "links", query: `SELECT CAST(l.id AS TEXT) id,CAST(rc.project_id AS TEXT) project_id,l.path slug,COALESCE(rc.default_fallback,'') destination_url,l.active,l.created_at,COALESCE(NULLIF(l.title,''),l.path) name,
      json_object('default',rc.default_fallback,'ios',(SELECT url FROM custom_redirects c WHERE c.link_id=l.id AND c.platform='ios' LIMIT 1),'android',(SELECT url FROM custom_redirects c WHERE c.link_id=l.id AND c.platform='android' LIMIT 1)) destinations_json,
      CASE WHEN l.campaign_id IS NULL THEN NULL ELSE CAST(l.campaign_id AS TEXT) END campaign_id,l.title,l.subtitle,l.image_url,
      json_object('source',l.tracking_source,'medium',l.tracking_medium,'campaign',l.tracking_campaign) utm_json,l.updated_at
      FROM links l JOIN redirect_configs rc ON rc.id=l.redirect_config_id WHERE rc.project_id=:project_id ORDER BY l.id` },
    target: { table: "links", query: "SELECT id,project_id,slug,destination_url,active,created_at,name,destinations_json,campaign_id,title,subtitle,image_url,utm_json,updated_at FROM links WHERE project_id=CAST(:project_id AS TEXT) ORDER BY id" },
  }),
  entity({
    id: "dynamic-links.redirect_rules", module: "dynamic-links",
    columns: j("id", "project_id", "priority", "rule_json", "name", "active", "created_at", "updated_at"), jsonColumns: ["rule_json"], projectColumn: "project_id",
    source: { database: "api", table: "redirects", query: `SELECT CAST(r.id AS TEXT) id,CAST(c.project_id AS TEXT) project_id,r.id priority,
      json_object('platform',r.platform,'variation',r.variation,'appstore',r.appstore,'fallback_url',r.fallback_url) rule_json,
      COALESCE(r.platform,'Default')||' redirect' name,r.enabled active,r.created_at,r.updated_at FROM redirects r JOIN redirect_configs c ON c.id=r.redirect_config_id WHERE c.project_id=:project_id ORDER BY r.id` },
    target: { table: "redirect_rules", query: "SELECT id,project_id,priority,rule_json,name,active,created_at,updated_at FROM redirect_rules WHERE project_id=CAST(:project_id AS TEXT) ORDER BY id" },
  }),
  entity({
    id: "dynamic-links.domains", module: "dynamic-links",
    columns: j("id", "project_id", "hostname", "status", "verification_token", "verified_at", "is_default", "created_at", "updated_at"), projectColumn: "project_id",
    source: { database: "api", table: "domains", query: `SELECT CAST(id AS TEXT) id,CAST(project_id AS TEXT) project_id,CASE WHEN subdomain IS NULL OR subdomain='' THEN domain ELSE subdomain||'.'||domain END hostname,
      'verified' status,'legacy-import' verification_token,created_at verified_at,CASE WHEN id=(SELECT MIN(id) FROM domains d WHERE d.project_id=:project_id) THEN 1 ELSE 0 END is_default,created_at,updated_at FROM domains WHERE project_id=:project_id ORDER BY id` },
    target: { table: "domains", query: "SELECT id,project_id,hostname,status,verification_token,verified_at,is_default,created_at,updated_at FROM domains WHERE project_id=CAST(:project_id AS TEXT) ORDER BY id" },
  }),
  entity({
    id: "dynamic-links.social_preview", module: "dynamic-links",
    columns: j("project_id", "title", "description", "image_url", "site_name", "updated_at"), keys: ["project_id"], projectColumn: "project_id",
    source: { database: "api", table: "domains", query: `SELECT CAST(project_id AS TEXT) project_id,COALESCE(generic_title,'') title,COALESCE(generic_subtitle,'') description,generic_image_url image_url,domain site_name,updated_at FROM domains WHERE project_id=:project_id ORDER BY id LIMIT 1` },
    target: { table: "social_previews", query: "SELECT project_id,title,description,image_url,site_name,updated_at FROM social_previews WHERE project_id=CAST(:project_id AS TEXT)" },
  }),
  entity({
    id: "dynamic-links.tracking_settings", module: "dynamic-links",
    columns: j("project_id", "enabled", "provider", "configuration_json", "updated_at"), keys: ["project_id"], jsonColumns: ["configuration_json"], projectColumn: "project_id",
    source: { database: "api", table: "redirect_configs", query: `SELECT CAST(project_id AS TEXT) project_id,1 enabled,'opengrow' provider,
      json_object('default_fallback',default_fallback,'show_preview_ios',show_preview_ios,'show_preview_android',show_preview_android) configuration_json,updated_at
      FROM redirect_configs WHERE project_id=:project_id ORDER BY id LIMIT 1` },
    target: { table: "tracking_settings", query: "SELECT project_id,enabled,provider,configuration_json,updated_at FROM tracking_settings WHERE project_id=CAST(:project_id AS TEXT)" },
  }),
  entity({
    id: "dynamic-links.events", module: "dynamic-links",
    columns: j("id", "project_id", "link_id", "campaign_id", "event_type", "platform", "country_code", "occurred_at", "metadata_json", "revenue_cents", "engagement_time", "customer_id", "session_id"), jsonColumns: ["metadata_json"], projectColumn: "project_id",
    keys: ["project_id", "id"],
    source: { database: "api", table: "actions", query: `SELECT 'legacy-action-'||a.id id,CAST(rc.project_id AS TEXT) project_id,CAST(l.id AS TEXT) link_id,
      CASE WHEN l.campaign_id IS NULL THEN NULL ELSE CAST(l.campaign_id AS TEXT) END campaign_id,'redirect' event_type,d.platform,NULL country_code,a.created_at occurred_at,
      json_object('cutover_source','legacy_action','handled',a.handled,'legacy_device_id',a.device_id) metadata_json,
      0 revenue_cents,0 engagement_time,NULL customer_id,CASE WHEN a.device_id IS NULL THEN NULL ELSE CAST(a.device_id AS TEXT) END session_id
      FROM actions a JOIN links l ON l.id=a.link_id JOIN redirect_configs rc ON rc.id=l.redirect_config_id LEFT JOIN devices d ON d.id=a.device_id
      WHERE rc.project_id=:project_id ORDER BY a.id` },
    target: { table: "link_events", query: "SELECT id,project_id,link_id,campaign_id,event_type,platform,country_code,occurred_at,metadata_json,revenue_cents,engagement_time,customer_id,session_id FROM link_events WHERE project_id=CAST(:project_id AS TEXT) AND json_extract(metadata_json,'$.cutover_source')='legacy_action' ORDER BY id" },
  }),
  entity({
    id: "dynamic-links.analytics_events", module: "dynamic-links",
    columns: j("id", "project_id", "link_id", "campaign_id", "event_type", "platform", "country_code", "occurred_at", "metadata_json", "revenue_cents", "engagement_time", "customer_id", "session_id"), jsonColumns: ["metadata_json"], projectColumn: "project_id",
    keys: ["project_id", "id"],
    source: { database: "api", table: "events", query: `SELECT 'legacy-event-'||e.id id,CAST(e.project_id AS TEXT) project_id,
      CASE WHEN e.link_id IS NULL THEN NULL ELSE CAST(e.link_id AS TEXT) END link_id,
      CASE WHEN l.campaign_id IS NULL THEN NULL ELSE CAST(l.campaign_id AS TEXT) END campaign_id,e.event event_type,e.platform,d.country_code,e.created_at occurred_at,
      json_object('cutover_source','legacy_event','legacy_device_id',e.device_id,'path',e.path,'app_version',e.app_version,'build',e.build,
        'legacy_data',CASE WHEN json_valid(e.data) THEN json(e.data) ELSE e.data END) metadata_json,
      0 revenue_cents,CASE WHEN e.event='time_spent' THEN MAX(COALESCE(e.engagement_time,0),0) ELSE 0 END engagement_time,
      CASE WHEN v.id IS NULL THEN NULL ELSE CAST(v.id AS TEXT) END customer_id,CAST(e.device_id AS TEXT) session_id
      FROM events e LEFT JOIN links l ON l.id=e.link_id LEFT JOIN devices d ON d.id=e.device_id
      LEFT JOIN visitors v ON v.project_id=CAST(e.project_id AS TEXT) AND v.device_id=e.device_id
      WHERE e.project_id=:project_id AND e.event IN ('view','open','install','reinstall','reactivation','app_open','user_referred','time_spent') ORDER BY e.id` },
    target: { table: "link_events", query: "SELECT id,project_id,link_id,campaign_id,event_type,platform,country_code,occurred_at,metadata_json,revenue_cents,engagement_time,customer_id,session_id FROM link_events WHERE project_id=CAST(:project_id AS TEXT) AND json_extract(metadata_json,'$.cutover_source')='legacy_event' ORDER BY id" },
  }),
  entity({
    id: "dynamic-links.purchase_events", module: "dynamic-links",
    columns: j("id", "project_id", "link_id", "campaign_id", "event_type", "platform", "country_code", "occurred_at", "metadata_json", "revenue_cents", "engagement_time", "customer_id", "session_id"), jsonColumns: ["metadata_json"], projectColumn: "project_id",
    keys: ["project_id", "id"],
    source: { database: "api", table: "purchase_events", query: `SELECT 'legacy-purchase-'||pe.id id,CAST(pe.project_id AS TEXT) project_id,CAST(pe.link_id AS TEXT) link_id,
      CASE WHEN l.campaign_id IS NULL THEN NULL ELSE CAST(l.campaign_id AS TEXT) END campaign_id,'conversion' event_type,d.platform,d.country_code,
      COALESCE(pe.date,pe.occurred_at,pe.created_at) occurred_at,
      json_object('cutover_source','legacy_purchase','legacy_event_type',pe.event_type,'currency',pe.currency,'quantity',COALESCE(pe.quantity,1),
        'transaction_id',pe.transaction_id,'order_id',pe.order_id,'product_id',COALESCE(pe.product_id,pe.in_app_product_id)) metadata_json,
      MAX(COALESCE(pe.usd_price_cents,pe.price_cents,CAST(ROUND(COALESCE(pe.amount,0)*100) AS INTEGER),0)*COALESCE(pe.quantity,1),0) revenue_cents,
      0 engagement_time,CASE WHEN pe.visitor_id IS NULL THEN NULL ELSE CAST(pe.visitor_id AS TEXT) END customer_id,
      CASE WHEN pe.device_id IS NULL THEN NULL ELSE CAST(pe.device_id AS TEXT) END session_id
      FROM purchase_events pe JOIN links l ON l.id=pe.link_id LEFT JOIN devices d ON d.id=pe.device_id
      WHERE pe.project_id=CAST(:project_id AS TEXT) AND pe.link_id IS NOT NULL
        AND lower(pe.event_type) IN ('buy','refund_reversed')
      ORDER BY pe.id` },
    target: { table: "link_events", query: "SELECT id,project_id,link_id,campaign_id,event_type,platform,country_code,occurred_at,metadata_json,revenue_cents,engagement_time,customer_id,session_id FROM link_events WHERE project_id=CAST(:project_id AS TEXT) AND json_extract(metadata_json,'$.cutover_source')='legacy_purchase' ORDER BY id" },
  }),

  copySupport("conversations", "conversations", "conversations", j("id", "project_id", "external_user_id", "client_conversation_id", "subject", "status", "priority", "assigned_user_id", "labels_json", "last_message_preview", "last_message_at", "user_last_read_at", "agent_last_read_at", "created_at", "updated_at", "inbox_id", "assigned_team_id", "custom_attributes_json", "snoozed_until", "first_reply_at", "resolved_at")),
  copySupport("messages", "messages", "messages", j("id", "conversation_id", "sender_kind", "sender_id", "body", "attachment_key", "attachment_name", "attachment_content_type", "client_message_id", "sequence", "created_at", "visibility", "content_type", "reply_to_message_id", "metadata_json", "delivery_status"), {
    sourceQuery: "SELECT s.id,s.conversation_id,s.sender_kind,s.sender_id,s.body,s.attachment_key,s.attachment_name,s.attachment_content_type,s.client_message_id,s.sequence,s.created_at,s.visibility,s.content_type,s.reply_to_message_id,s.metadata_json,s.delivery_status FROM messages s JOIN conversations c ON c.id=s.conversation_id WHERE c.project_id=:project_id ORDER BY s.conversation_id,s.sequence",
    targetQuery: "SELECT s.id,s.conversation_id,s.sender_kind,s.sender_id,s.body,s.attachment_key,s.attachment_name,s.attachment_content_type,s.client_message_id,s.sequence,s.created_at,s.visibility,s.content_type,s.reply_to_message_id,s.metadata_json,s.delivery_status FROM messages s JOIN conversations c ON c.id=s.conversation_id WHERE c.project_id=:project_id ORDER BY s.conversation_id,s.sequence",
  }),
  copySupport("audit", "messaging_audit_events", "support_audit_events", j("id", "conversation_id", "project_id", "event_type", "actor_kind", "actor_id", "payload_json", "created_at"), { immutable: true }),
  copySupport("settings", "messaging_project_settings", "support_project_settings", j("project_id", "business_name", "locale", "timezone", "date_format", "auto_resolve_minutes", "attachment_max_bytes", "allowed_content_types_json", "features_json", "created_at", "updated_at"), { keys: ["project_id"] }),
  copySupport("configuration", "messaging_configuration_entities", "support_configuration_entities", j("id", "project_id", "entity_type", "name", "enabled", "position", "configuration_json", "created_by", "updated_by", "created_at", "updated_at")),
  copySupport("configuration_audit", "messaging_configuration_audit_events", "support_configuration_audit_events", j("id", "project_id", "entity_id", "entity_type", "action", "actor_id", "before_json", "after_json", "created_at"), { immutable: true }),
  copySupport("companies", "messaging_companies", "support_companies", j("id", "project_id", "name", "domain", "description", "custom_attributes_json", "created_at", "updated_at")),
  copySupport("contacts", "messaging_contacts", "support_contacts", j("id", "project_id", "external_user_id", "name", "email", "phone", "company_id", "avatar_url", "blocked", "custom_attributes_json", "last_seen_at", "created_at", "updated_at")),
  copySupport("contact_notes", "messaging_contact_notes", "support_contact_notes", j("id", "project_id", "contact_id", "content", "created_by", "created_at", "updated_at")),
  copySupport("participants", "messaging_conversation_participants", "support_conversation_participants", j("conversation_id", "project_id", "participant_kind", "participant_id", "created_by", "created_at"), { keys: ["conversation_id", "participant_kind", "participant_id"] }),
  copySupport("drafts", "messaging_conversation_drafts", "support_conversation_drafts", j("conversation_id", "project_id", "agent_id", "content", "attachments_json", "updated_at"), { keys: ["conversation_id", "agent_id"] }),
  copySupport("csat", "messaging_csat_responses", "support_csat_responses", j("id", "project_id", "conversation_id", "contact_external_user_id", "rating", "feedback", "created_at", "updated_at")),
  copySupport("notifications", "messaging_agent_notifications", "support_agent_notifications", j("id", "project_id", "agent_id", "notification_type", "title", "body", "conversation_id", "payload_json", "read_at", "created_at")),
  copySupport("operations_audit", "messaging_operations_audit_events", "support_operations_audit_events", j("id", "project_id", "resource_type", "resource_id", "action", "actor_id", "payload_json", "created_at"), { immutable: true }),
  copySupport("rule_executions", "messaging_rule_executions", "support_rule_executions", j("id", "project_id", "rule_id", "event_id", "conversation_id", "event_name", "result_json", "created_at")),
  copySupport("webhook_deliveries", "messaging_webhook_deliveries", "support_webhook_deliveries", j("id", "project_id", "webhook_id", "event_id", "event_name", "attempt_count", "response_status", "last_error", "delivered_at", "created_at", "updated_at")),
]);

export const MODULE_CUTOVER_GUARDS = Object.freeze([
  {
    id: "products.package_multi_product_requires_schema",
    module: "products",
    message: "A legacy package references multiple Store products; the current Products package schema cannot preserve that relation without loss.",
    source: {
      database: "billing",
      query: `SELECT p.id FROM billing_packages p JOIN billing_offerings o ON o.id=p.offering_id
        JOIN billing_package_products pp ON pp.package_id=p.id JOIN billing_products product ON product.id=pp.product_id
        WHERE o.project_id=:project_id GROUP BY p.id HAVING COUNT(DISTINCT product.store_product_id)>1 ORDER BY p.id`,
    },
  },
  {
    id: "products.logical_product_type_conflict",
    module: "products",
    message: "Store products sharing one identifier disagree on product type.",
    source: {
      database: "billing",
      query: "SELECT store_product_id FROM billing_products WHERE project_id=:project_id GROUP BY store_product_id HAVING COUNT(DISTINCT product_type)>1 ORDER BY store_product_id",
    },
  },
  {
    id: "products.multiple_active_prices_requires_schema",
    module: "products",
    message: "A Store product has multiple active prices; the current Products store_products projection can retain only one.",
    source: {
      database: "billing",
      query: `SELECT p.id FROM billing_products p JOIN billing_product_prices price ON price.product_id=p.id AND price.active=1
        WHERE p.project_id=:project_id GROUP BY p.id HAVING COUNT(*)>1 ORDER BY p.id`,
    },
  },
  {
    id: "products.subscription_missing_identity",
    module: "products",
    message: "A subscription is missing its financial customer or product relationship.",
    source: {
      database: "billing",
      query: "SELECT id FROM billing_subscriptions WHERE project_id=:project_id AND (customer_id IS NULL OR product_id IS NULL) ORDER BY id",
    },
  },
  {
    id: "products.refund_missing_purchase",
    module: "products",
    message: "A refund case is missing the purchase transaction required by the Products schema.",
    source: {
      database: "billing",
      query: "SELECT id FROM billing_refund_cases WHERE project_id=:project_id AND transaction_id IS NULL ORDER BY id",
    },
  },
  {
    id: "products.refund_purchase_not_canonical",
    module: "products",
    message: "A refund references a transaction event that is not the canonical purchase projection.",
    source: {
      database: "billing",
      query: `SELECT r.id FROM billing_refund_cases r LEFT JOIN billing_transactions t ON t.id=r.transaction_id
        WHERE r.project_id=:project_id AND r.transaction_id IS NOT NULL AND (t.id IS NULL OR t.id<>(SELECT candidate.id FROM billing_transactions candidate
          WHERE candidate.project_id=t.project_id AND candidate.store=t.store AND candidate.environment=t.environment AND candidate.store_transaction_id=t.store_transaction_id
          ORDER BY COALESCE(candidate.purchased_at,candidate.created_at) DESC,candidate.created_at DESC,candidate.id DESC LIMIT 1)) ORDER BY r.id`,
    },
  },
  {
    id: "products.subscription_purchase_not_canonical",
    module: "products",
    message: "A subscription latest_transaction_id is not the canonical purchase projection.",
    source: {
      database: "billing",
      query: `SELECT s.id FROM billing_subscriptions s LEFT JOIN billing_transactions t ON t.id=s.latest_transaction_id
        WHERE s.project_id=:project_id AND s.latest_transaction_id IS NOT NULL AND (t.id IS NULL OR t.id<>(SELECT candidate.id FROM billing_transactions candidate
          WHERE candidate.project_id=t.project_id AND candidate.store=t.store AND candidate.environment=t.environment AND candidate.store_transaction_id=t.store_transaction_id
          ORDER BY COALESCE(candidate.purchased_at,candidate.created_at) DESC,candidate.created_at DESC,candidate.id DESC LIMIT 1)) ORDER BY s.id`,
    },
  },
  {
    id: "paywalls.placement_without_paywall",
    module: "paywalls",
    message: "A legacy placement cannot be associated with a paywall through its default offering.",
    source: {
      database: "billing",
      query: `SELECT p.id FROM billing_placements p WHERE p.project_id=:project_id AND NOT EXISTS
        (SELECT 1 FROM billing_paywalls w WHERE w.project_id=p.project_id AND w.offering_id=p.default_offering_id) ORDER BY p.id`,
    },
  },
  {
    id: "paywalls.targeting_without_paywall",
    module: "paywalls",
    message: "A targeting rule cannot be associated with a paywall through its offering.",
    source: {
      database: "billing",
      query: `SELECT r.id FROM billing_targeting_rules r WHERE r.project_id=:project_id AND NOT EXISTS
        (SELECT 1 FROM billing_paywalls w WHERE w.project_id=r.project_id AND w.offering_id=r.offering_id) ORDER BY r.id`,
    },
  },
  {
    id: "paywalls.experiment_without_version",
    module: "paywalls",
    message: "An experiment variant cannot be mapped to a published paywall version.",
    source: {
      database: "billing",
      query: `SELECT DISTINCT e.id FROM billing_experiments e JOIN billing_experiment_variants v ON v.experiment_id=e.id
        WHERE e.project_id=:project_id AND NOT EXISTS
        (SELECT 1 FROM billing_paywalls w WHERE w.project_id=e.project_id AND w.offering_id=v.offering_id AND w.active_version_id IS NOT NULL) ORDER BY e.id`,
    },
  },
]);

export function registrySummary() {
  return MODULE_CUTOVER_REGISTRY.map(({ id, module, source, target, columns, keys }) => ({
    id, module, source_database: source.database, source_table: source.table,
    target_table: target.table, columns, keys,
  }));
}
