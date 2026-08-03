DELETE FROM billing_product_prices
WHERE id NOT IN (
  SELECT MIN(id)
  FROM billing_product_prices
  GROUP BY
    product_id,
    COALESCE(provider_price_id, ''),
    COALESCE(base_plan_id, ''),
    COALESCE(offer_id, ''),
    COALESCE(currency, '')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_product_prices_provider_identity
ON billing_product_prices (
  product_id,
  COALESCE(provider_price_id, ''),
  COALESCE(base_plan_id, ''),
  COALESCE(offer_id, ''),
  COALESCE(currency, '')
);
