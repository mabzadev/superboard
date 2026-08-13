# SuperBoard Identity SDKs

The complete Melody Auth client SDK family is maintained in this monorepo and targets the same native Cloudflare Identity Worker used by SuperBoard.

| SDK | Package | Directory |
| --- | --- | --- |
| Browser/Web | `@melody-auth/web` | `web/` |
| React | `@melody-auth/react` | `react/` |
| Vue | `@melody-auth/vue` | `vue/` |
| Angular | `@melody-auth/angular` | `angular/` |
| Next.js | `@melody-auth/nextjs` | `nextjs/` |

Configure `serverUri` (or `serverUrl` in the Next.js provider) with the target authentication domain, for example `https://auth.mbza.dev`. Applications and redirect URIs are created from **SuperBoard → Identity → Applications**. OAuth authorization code flows use PKCE S256; no tunnel, container, VPC, iframe, or second administration application is required.

The imported public APIs and tests are preserved so existing Melody Auth integrations can migrate without a client rewrite. SuperBoard owns deployment, project mapping, canonical user identifiers, SMTP delivery and Cloudflare runtime behavior.
