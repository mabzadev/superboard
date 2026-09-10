/** Cloudflare Workflows user supplied instance IDs are <=100 chars and may
 * contain only ASCII letters, digits, underscore and hyphen. */
export async function flowWorkflowInstanceId(
  prefix: string,
  businessId: string,
): Promise<string> {
  const safePrefix = prefix.replaceAll(/[^a-zA-Z0-9_-]/gu, "-").slice(0, 24) || "flow";
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(businessId)),
  );
  const hex = [...digest]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `${safePrefix}-${hex}`;
}
