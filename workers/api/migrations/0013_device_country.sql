-- Country observed by Cloudflare for SDK device traffic (ISO 3166-1 alpha-2).
ALTER TABLE devices ADD COLUMN country_code TEXT;

CREATE INDEX IF NOT EXISTS idx_devices_country_code ON devices(country_code);
