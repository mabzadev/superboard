// Next.js inlines NEXT_PUBLIC_* only for literal process.env.NEXT_PUBLIC_XXX
// references — dynamic access like process.env[name] is NOT replaced client-side.

const apiUrl = process.env.NEXT_PUBLIC_API_URL;
const authUrl = process.env.NEXT_PUBLIC_AUTH_URL;
const clientId = process.env.NEXT_PUBLIC_CLIENT_ID;
const docsUrl = process.env.NEXT_PUBLIC_DOCS_URL;
const sdkUrl = process.env.NEXT_PUBLIC_SDK_URL;
const shortlinkUrl = process.env.NEXT_PUBLIC_SHORTLINK_URL;
const mcpUrl = process.env.NEXT_PUBLIC_MCP_URL;

if (!apiUrl)
  throw new Error("Missing environment variable: NEXT_PUBLIC_API_URL");
if (!authUrl)
  throw new Error("Missing environment variable: NEXT_PUBLIC_AUTH_URL");
if (!clientId)
  throw new Error("Missing environment variable: NEXT_PUBLIC_CLIENT_ID");
if (!docsUrl)
  throw new Error("Missing environment variable: NEXT_PUBLIC_DOCS_URL");
if (!sdkUrl)
  throw new Error("Missing environment variable: NEXT_PUBLIC_SDK_URL");
if (!shortlinkUrl)
  throw new Error("Missing environment variable: NEXT_PUBLIC_SHORTLINK_URL");
if (!mcpUrl)
  throw new Error("Missing environment variable: NEXT_PUBLIC_MCP_URL");

export const config = {
  apiUrl,
  authUrl,
  apiPath: process.env.NEXT_PUBLIC_API_PATH ?? "/api/v1",
  clientId,
  docsUrl,
  sdkUrl,
  shortlinkUrl,
  mcpUrl,
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || null,
} as const;
