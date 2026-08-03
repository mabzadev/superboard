/** Build-time constant — NEXT_PUBLIC_ vars are inlined by Next.js at compile time. */
export const IS_FULL_ACCESS =
  process.env.NEXT_PUBLIC_OPENGROW_ACCESS_MODE === "full";

export const IS_ENTERPRISE =
  IS_FULL_ACCESS || process.env.NEXT_PUBLIC_OPENGROW_EE === "true";
