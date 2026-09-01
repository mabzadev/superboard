// Next.js inlines NEXT_PUBLIC_* only for literal process.env.NEXT_PUBLIC_XXX
// references — dynamic access like process.env[name] is NOT replaced client-side.

const emdashFront = process.env.NEXT_PUBLIC_SUPERBOARD_EMDASH_FRONT === "1";
const runtimeOrigin = () =>
  typeof window === "undefined" ? "http://localhost" : window.location.origin;
const apiUrl =
  process.env.NEXT_PUBLIC_API_URL ?? (emdashFront ? "" : undefined);
const authUrl =
  process.env.NEXT_PUBLIC_AUTH_URL ?? (emdashFront ? "" : undefined);
const clientId =
  process.env.NEXT_PUBLIC_CLIENT_ID ??
  (emdashFront ? "superboard-site" : undefined);
const docsUrl =
  process.env.NEXT_PUBLIC_DOCS_URL ??
  (emdashFront ? `${runtimeOrigin()}/docs` : undefined);
const sdkUrl =
  process.env.NEXT_PUBLIC_SDK_URL ??
  (emdashFront ? `${runtimeOrigin()}/app/libraries` : undefined);
const shortlinkUrl =
  process.env.NEXT_PUBLIC_SHORTLINK_URL ??
  (emdashFront ? runtimeOrigin() : undefined);
const mcpUrl =
  process.env.NEXT_PUBLIC_MCP_URL ??
  (emdashFront ? runtimeOrigin() : undefined);

if (!apiUrl && !emdashFront)
  throw new Error("Missing environment variable: NEXT_PUBLIC_API_URL");
if (!authUrl && !emdashFront)
  throw new Error("Missing environment variable: NEXT_PUBLIC_AUTH_URL");
if (!clientId && !emdashFront)
  throw new Error("Missing environment variable: NEXT_PUBLIC_CLIENT_ID");
if (!docsUrl && !emdashFront)
  throw new Error("Missing environment variable: NEXT_PUBLIC_DOCS_URL");
if (!sdkUrl && !emdashFront)
  throw new Error("Missing environment variable: NEXT_PUBLIC_SDK_URL");
if (!shortlinkUrl && !emdashFront)
  throw new Error("Missing environment variable: NEXT_PUBLIC_SHORTLINK_URL");
if (!mcpUrl && !emdashFront)
  throw new Error("Missing environment variable: NEXT_PUBLIC_MCP_URL");

export const config = {
  apiUrl: apiUrl ?? "",
  authUrl: authUrl ?? "",
  apiPath: process.env.NEXT_PUBLIC_API_PATH ?? "/api/v1",
  clientId: clientId ?? "superboard-site",
  docsUrl: docsUrl ?? `${runtimeOrigin()}/docs`,
  sdkUrl: sdkUrl ?? `${runtimeOrigin()}/app/libraries`,
  shortlinkUrl: shortlinkUrl ?? runtimeOrigin(),
  mcpUrl: mcpUrl ?? runtimeOrigin(),
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || null,
} as const;
