// Next.js inlines NEXT_PUBLIC_* only for literal process.env.NEXT_PUBLIC_XXX
// references — dynamic access like process.env[name] is NOT replaced client-side.

const apiUrl = process.env.NEXT_PUBLIC_API_URL;
const clientId = process.env.NEXT_PUBLIC_CLIENT_ID;

if (!apiUrl)
  throw new Error("Missing environment variable: NEXT_PUBLIC_API_URL");
if (!clientId)
  throw new Error("Missing environment variable: NEXT_PUBLIC_CLIENT_ID");

export const config = {
  apiUrl,
  apiPath: process.env.NEXT_PUBLIC_API_PATH ?? "/api/v1",
  clientId,
  docsUrl: process.env.NEXT_PUBLIC_DOCS_URL ?? "https://docs.opengrow.io",
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@opengrow.io",
  termsUrl: process.env.NEXT_PUBLIC_TERMS_URL ?? "https://github.com/mbzadev/opengrow/terms",
  privacyUrl: process.env.NEXT_PUBLIC_PRIVACY_URL ?? "https://github.com/mbzadev/opengrow/privacy",
  pricingUrl: process.env.NEXT_PUBLIC_PRICING_URL ?? "https://github.com/mbzadev/opengrow/pricing",
  salesUrl: process.env.NEXT_PUBLIC_SALES_URL ?? "https://github.com/mbzadev/opengrow/sales",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://app.opengrow.io",
} as const;
