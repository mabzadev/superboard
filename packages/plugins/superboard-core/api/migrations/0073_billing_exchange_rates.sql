-- Daily euro foreign exchange reference rates published by the European Central Bank.
-- units_per_eur is the number of currency units for one euro. EUR itself is stored as 1
-- for every publication date, so a row for EUR marks a day on which the ECB published.
CREATE TABLE IF NOT EXISTS billing_exchange_rates (
  currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency = upper(currency)),
  rate_date TEXT NOT NULL CHECK (rate_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  units_per_eur REAL NOT NULL CHECK (units_per_eur > 0),
  source TEXT NOT NULL DEFAULT 'ecb',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (currency, rate_date)
);

CREATE TABLE IF NOT EXISTS billing_exchange_rate_sync (
  source TEXT PRIMARY KEY,
  covered_from TEXT,
  latest_rate_date TEXT,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- usd_*_micros is the amount converted to USD at the reference rate of the purchase (or
-- refund) day. usd_rate_date is the ECB publication date used. It stays NULL until that
-- day's rate is final, and the exchange rate job fills it in bounded batches.
ALTER TABLE billing_catalog_purchases ADD COLUMN usd_price_micros INTEGER;
ALTER TABLE billing_catalog_purchases ADD COLUMN usd_rate_date TEXT;
ALTER TABLE billing_catalog_refunds ADD COLUMN usd_amount_micros INTEGER;
ALTER TABLE billing_catalog_refunds ADD COLUMN usd_rate_date TEXT;
ALTER TABLE billing_transactions ADD COLUMN usd_price_micros INTEGER;
ALTER TABLE billing_transactions ADD COLUMN usd_rate_date TEXT;

CREATE INDEX IF NOT EXISTS idx_billing_catalog_purchases_usd_pending
  ON billing_catalog_purchases(purchased_at, id)
  WHERE usd_rate_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_billing_catalog_refunds_usd_pending
  ON billing_catalog_refunds(requested_at, id)
  WHERE usd_rate_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_billing_transactions_usd_pending
  ON billing_transactions(COALESCE(purchased_at, event_occurred_at, created_at), id)
  WHERE usd_rate_date IS NULL AND price_micros IS NOT NULL;
