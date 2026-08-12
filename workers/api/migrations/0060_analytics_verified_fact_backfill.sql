-- Backfill only canonical, countable facts from the legacy control-plane data.
-- Re-running this file is safe: the producer outbox owns a unique fact key and
-- Analytics independently deduplicates installations and purchase identities.

WITH installation_source AS (
  SELECT
    installed.id,
    installed.project_id,
    installed.device_id,
    COALESCE(
      CASE
        WHEN lower(COALESCE(device.platform, '')) IN ('ios', 'iphone', 'ipad') THEN (
          SELECT ios.bundle_id
          FROM applications application
          JOIN ios_configurations ios ON ios.application_id = application.id
          WHERE application.instance_id = project.instance_id
            AND application.enabled = 1
            AND ios.bundle_id IS NOT NULL
            AND ios.bundle_id <> ''
          ORDER BY application.id
          LIMIT 1
        )
        WHEN lower(COALESCE(device.platform, '')) IN ('android', 'google') THEN (
          SELECT android.identifier
          FROM applications application
          JOIN android_configurations android ON android.application_id = application.id
          WHERE application.instance_id = project.instance_id
            AND application.enabled = 1
            AND android.identifier <> ''
          ORDER BY application.id
          LIMIT 1
        )
      END,
      'project-' || installed.project_id
    ) AS application_id,
    COALESCE(NULLIF(device.platform, ''), 'unknown') AS platform,
    NULLIF(device.app_version, '') AS app_version,
    COALESCE(
      strftime('%Y-%m-%dT%H:%M:%fZ', installed.created_at),
      installed.created_at
    ) AS occurred_at
  FROM installed_apps installed
  JOIN devices device ON device.id = installed.device_id
  JOIN projects project ON project.id = installed.project_id
)
INSERT OR IGNORE INTO analytics_fact_outbox
  (id, project_id, fact_key, event_id, payload_json)
SELECT
  lower(hex(randomblob(16))),
  CAST(project_id AS TEXT),
  'installation:' || project_id || ':' || application_id || ':' || device_id,
  'installation-legacy-' || id,
  json_object(
    'schema_version', 1,
    'event_id', 'installation-legacy-' || id,
    'event_name', 'superboard.analytics.installation.created.v1',
    'occurred_at', occurred_at,
    'source', 'import',
    'application_id', application_id,
    'app_instance_id', 'dev_' || device_id,
    'properties', json_object('install_type', 'historical'),
    'context', json_patch(
      json_object('platform', platform),
      CASE
        WHEN app_version IS NULL THEN json('{}')
        ELSE json_object('app_version', app_version)
      END
    )
  )
FROM installation_source;

WITH verified_purchase_source AS (
  SELECT
    transaction_row.id,
    CAST(transaction_row.project_id AS TEXT) AS project_id,
    COALESCE(
      CAST(transaction_row.application_id AS TEXT),
      'project-' || transaction_row.project_id
    ) AS application_id,
    transaction_row.store,
    transaction_row.environment,
    transaction_row.store_transaction_id,
    CASE
      WHEN lower(transaction_row.event_type) LIKE '%chargeback%' THEN 'chargeback'
      WHEN lower(transaction_row.event_type) LIKE '%refund%'
        OR lower(transaction_row.status) IN ('refunded', 'revoked') THEN 'refund'
      WHEN lower(transaction_row.event_type) LIKE '%cancel%'
        OR lower(transaction_row.status) = 'cancelled' THEN 'cancellation'
      WHEN lower(transaction_row.event_type) LIKE '%renew%' THEN 'renewal'
      WHEN lower(transaction_row.event_type) LIKE '%trial%'
        AND (
          lower(transaction_row.event_type) LIKE '%convert%'
          OR lower(transaction_row.status) = 'active'
        ) THEN 'trial_converted'
      ELSE 'initial_purchase'
    END AS analytics_event_type,
    COALESCE(product.store_product_id, CAST(transaction_row.product_id AS TEXT)) AS product_id,
    CASE
      WHEN transaction_row.price_micros IS NULL THEN NULL
      ELSE abs(transaction_row.price_micros)
    END AS amount_micros,
    upper(NULLIF(transaction_row.currency, '')) AS currency,
    COALESCE(
      strftime(
        '%Y-%m-%dT%H:%M:%fZ',
        COALESCE(
          transaction_row.event_occurred_at,
          transaction_row.purchased_at,
          transaction_row.verified_at,
          transaction_row.created_at
        )
      ),
      transaction_row.verified_at,
      transaction_row.created_at
    ) AS occurred_at
  FROM billing_transactions transaction_row
  LEFT JOIN billing_products product ON product.id = transaction_row.product_id
  WHERE transaction_row.verified_at IS NOT NULL
    AND transaction_row.store IN ('apple', 'google')
    AND transaction_row.environment IN ('sandbox', 'production')
), purchase_fact AS (
  SELECT
    *,
    project_id || ':' || store || ':' || environment || ':' ||
      store_transaction_id || ':' || analytics_event_type AS analytics_identity
  FROM verified_purchase_source
)
INSERT OR IGNORE INTO analytics_fact_outbox
  (id, project_id, fact_key, event_id, payload_json)
SELECT
  lower(hex(randomblob(16))),
  project_id,
  'purchase:' || analytics_identity,
  'purchase-legacy-' || id,
  json_object(
    'schema_version', 1,
    'event_id', 'purchase-legacy-' || id,
    'event_name', 'superboard.analytics.purchase.verified.v1',
    'occurred_at', occurred_at,
    'source', 'billing',
    'application_id', application_id,
    'properties', json_object(
      'billing_transaction_id', id,
      'store', store,
      'environment', environment,
      'store_transaction_id', store_transaction_id,
      'event_type', analytics_event_type,
      'product_id', product_id,
      'amount_micros', amount_micros,
      'currency', currency
    )
  )
FROM purchase_fact;
