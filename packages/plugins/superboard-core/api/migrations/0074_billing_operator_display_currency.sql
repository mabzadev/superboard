-- Display currency chosen by each Site operator for every project the operator can open.
CREATE TABLE IF NOT EXISTS billing_operator_currency_preferences (
  instance_id INTEGER NOT NULL,
  operator_id TEXT NOT NULL CHECK (length(operator_id) BETWEEN 1 AND 128),
  display_currency TEXT NOT NULL CHECK (length(display_currency) = 3 AND display_currency = upper(display_currency)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (instance_id, operator_id),
  FOREIGN KEY (instance_id) REFERENCES instances(id) ON DELETE CASCADE
);

-- Days for which a secondary rate source was consulted. billing_exchange_rates.source tells
-- which source supplied each rate; 'loaded' days hold that source's rates for the currencies
-- the ECB did not publish, 'unavailable' days have none.
CREATE TABLE IF NOT EXISTS billing_exchange_rate_days (
  source TEXT NOT NULL,
  rate_date TEXT NOT NULL CHECK (rate_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL CHECK (status IN ('loaded', 'unavailable')),
  currencies INTEGER NOT NULL DEFAULT 0 CHECK (currencies >= 0),
  checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (source, rate_date)
);

-- Amounts in a currency missing from the ECB rates were closed without a converted amount.
-- Reopen them so the exchange rate job converts them with the secondary source.
UPDATE billing_catalog_purchases SET usd_rate_date = NULL
  WHERE usd_rate_date IS NOT NULL AND usd_price_micros IS NULL;
UPDATE billing_catalog_refunds SET usd_rate_date = NULL
  WHERE usd_rate_date IS NOT NULL AND usd_amount_micros IS NULL;
UPDATE billing_transactions SET usd_rate_date = NULL
  WHERE usd_rate_date IS NOT NULL AND usd_price_micros IS NULL;
