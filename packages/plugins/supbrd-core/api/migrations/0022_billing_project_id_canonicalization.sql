-- D1 applies TEXT affinity to numeric bindings after the value reaches SQL.
-- Historically, a JavaScript number could therefore become "11.0" instead of
-- the canonical project key "11" and bypass a compound UNIQUE constraint.

CREATE TABLE IF NOT EXISTS billing_product_canonicalization_audit (
  old_product_id TEXT PRIMARY KEY,
  canonical_product_id TEXT NOT NULL,
  old_project_id TEXT NOT NULL,
  canonical_project_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT 'numeric_text_project_id',
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO billing_product_canonicalization_audit (
  old_product_id, canonical_product_id, old_project_id, canonical_project_id
)
SELECT duplicate.id, canonical.id, duplicate.project_id, canonical.project_id
FROM billing_products duplicate
JOIN projects project ON duplicate.project_id = printf('%d.0', project.id)
JOIN billing_products canonical
  ON canonical.project_id = CAST(project.id AS TEXT)
 AND canonical.store = duplicate.store
 AND canonical.environment = duplicate.environment
 AND canonical.store_product_id = duplicate.store_product_id
WHERE NOT EXISTS (SELECT 1 FROM billing_product_entitlements WHERE product_id = duplicate.id)
  AND NOT EXISTS (SELECT 1 FROM billing_package_products WHERE product_id = duplicate.id)
  AND NOT EXISTS (SELECT 1 FROM billing_transactions WHERE product_id = duplicate.id)
  AND NOT EXISTS (SELECT 1 FROM billing_subscriptions WHERE product_id = duplicate.id)
  AND NOT EXISTS (SELECT 1 FROM billing_customer_entitlements WHERE product_id = duplicate.id)
  AND NOT EXISTS (SELECT 1 FROM billing_balance_ledger WHERE product_id = duplicate.id)
  AND NOT EXISTS (SELECT 1 FROM billing_product_prices WHERE product_id = duplicate.id)
  AND NOT EXISTS (SELECT 1 FROM billing_virtual_currency_products WHERE product_id = duplicate.id)
  AND NOT EXISTS (SELECT 1 FROM billing_checkout_sessions WHERE product_id = duplicate.id);

DELETE FROM billing_products
WHERE id IN (SELECT old_product_id FROM billing_product_canonicalization_audit);

-- Normalize any non-conflicting historical row that has no canonical twin.
UPDATE billing_products
SET project_id = (
  SELECT CAST(project.id AS TEXT)
  FROM projects project
  WHERE billing_products.project_id = printf('%d.0', project.id)
)
WHERE EXISTS (
  SELECT 1 FROM projects project
  WHERE billing_products.project_id = printf('%d.0', project.id)
);

CREATE TRIGGER IF NOT EXISTS billing_products_canonical_project_insert
BEFORE INSERT ON billing_products
WHEN NOT EXISTS (
  SELECT 1 FROM projects project WHERE CAST(project.id AS TEXT) = NEW.project_id
)
BEGIN
  SELECT RAISE(ABORT, 'billing_products project_id must use the canonical project key');
END;

CREATE TRIGGER IF NOT EXISTS billing_products_canonical_project_update
BEFORE UPDATE OF project_id ON billing_products
WHEN NOT EXISTS (
  SELECT 1 FROM projects project WHERE CAST(project.id AS TEXT) = NEW.project_id
)
BEGIN
  SELECT RAISE(ABORT, 'billing_products project_id must use the canonical project key');
END;

CREATE TRIGGER IF NOT EXISTS billing_product_canonicalization_audit_no_update
BEFORE UPDATE ON billing_product_canonicalization_audit
BEGIN
  SELECT RAISE(ABORT, 'billing product canonicalization audit is immutable');
END;

CREATE TRIGGER IF NOT EXISTS billing_product_canonicalization_audit_no_delete
BEFORE DELETE ON billing_product_canonicalization_audit
BEGIN
  SELECT RAISE(ABORT, 'billing product canonicalization audit is immutable');
END;
