export { NextAuthProvider } from "./Provider";
export type { NextAuthProviderProps } from "./Provider";

export { useNextAuth } from "./hooks/useNextAuth";
export { getNextAuth, getCachedServerSession } from "./hooks/getNextAuth";

export { createMelodyAuthMiddleware, withAuth } from "./middleware";
export type { MelodyAuthMiddlewareConfig, AuthenticatedRequest } from "./middleware";

export { getServerSession, requireAuth } from "./middleware/serverAuth";
export type { ServerAuthOptions, AuthSession } from "./middleware/serverAuth";

export { CookieStorage } from "./storage";
export type { CookieOptions } from "./storage";

export { useRouter, useAppRouter, usePagesRouter } from "./hooks/useRouter";
