# @melody-auth/nextjs

Next.js SDK for Melody Auth with full SSR support, middleware protection, and cookie-based storage.

The server authentication hooks require React 19 or later. The private workspace
build uses React and React DOM 19 to match its Next.js 16 toolchain.

## Features

- **Cookie-based storage** - Works with SSR/SSG out of the box
- **Edge middleware** - JWT verification and route protection
- **Server components** - `getServerSession()` for RSC
- **React hooks** - `useNextAuth()` for client components
- **TypeScript** - Full type safety included

## Installation

```bash
npm install @melody-auth/nextjs
```

## Quick Start

```tsx
// 1. Wrap your app
import { NextAuthProvider } from "@melody-auth/nextjs";

<NextAuthProvider
	clientId="your-client-id"
	serverUrl="https://your-auth-server.com"
	redirectUri="http://localhost:3000/callback"
>
	{children}
</NextAuthProvider>;

// 2. Add middleware protection
// middleware.ts
import { createMelodyAuthMiddleware } from "@melody-auth/nextjs";

export default createMelodyAuthMiddleware({
	jwksUri: "https://your-auth-server.com/.well-known/jwks.json",
	publicPaths: ["/login"],
});

// 3. Use in components
import { useNextAuth } from "@melody-auth/nextjs";

const { isAuthenticated, loginRedirect } = useNextAuth();
```

## Documentation

📖 **[Complete documentation and examples →](../../docs/nextjs-sdk.md)**

## Key APIs

- `<NextAuthProvider>` - Wrap your app for auth context
- `useNextAuth()` - React hook for client components
- `getServerSession()` - Get session in server components
- `createMelodyAuthMiddleware()` - Protect routes with middleware
- `requireAuth()` - Protect API routes

## License

MIT
