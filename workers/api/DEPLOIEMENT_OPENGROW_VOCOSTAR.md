# 🚀 OpenGrow Vocostar — Documentation Complète de Déploiement

> **Dernière mise à jour** : 12 mai 2026  
> **Structure** : `cloudflare/workers/`

---

## 📂 Structure des Dossiers

```
app-vocostar/
└── cloudflare/
    ├── _docs/                          # Documentation générale du projet
    ├── _tests/                         # Tests
    ├── d1/
    │   └── migrations/                 # Migrations SQL globales
    └── workers/
        ├── opengrow/                      ← BACKEND PRINCIPAL OPENGROW ✅
        │   ├── migrations/
        │   │   ├── 0001_initial_schema.sql
        │   │   ├── 0002_oauth_tables.sql
        │   │   └── 0003_cloudflare_opengrow_compat.sql
        │   ├── src/
        │   │   ├── index.ts            # Router principal + subdomain routing
        │   │   ├── types.ts            # Types (Env bindings D1/KV/secrets)
        │   │   ├── lib/
        │   │   │   └── crypto.ts       # JWT sign/verify, bcrypt, generateApiKey
        │   │   ├── middleware/
        │   │   │   └── auth.ts         # Bearer token middleware
        │   │   └── routes/
        │   │       ├── auth.ts         # /api/v1/auth/sign_up, sign_in
        │   │       ├── users.ts        # /api/v1/users (register, me, otp_qr, 2fa)
        │   │       ├── oauth.ts        # /oauth/token, /revoke, /token/info
        │   │       ├── instances.ts    # /api/v1/instances (CRUD + billing + configs)
        │   │       ├── projects.ts     # /api/v1/projects (links, domain, campaigns…)
        │   │       ├── mcp.ts          # /api/v1/mcp/tokens
        │   │       ├── links.ts        # /api/v1/links CRUD (short links)
        │   │       ├── analytics.ts    # /api/v1/analytics/*
        │   │       ├── sdk.ts          # SDK attribution
        │   │       ├── redirect.ts     # go.vocostar.com/:slug
        │   │       └── well-known.ts   # Apple/Android universal links
        │   ├── DEPLOIEMENT_OPENGROW_VOCOSTAR.md  ← CE FICHIER
        │   ├── package.json
        │   ├── tsconfig.json
        │   └── wrangler.toml
        │
        ├── opengrow-dashboard/            ← DASHBOARD NEXT.JS ✅
        │   ├── src/
        │   │   └── app/
        │   │       └── api/
        │   │           ├── auth/
        │   │           │   ├── token/route.ts   # BFF login (SSR edge)
        │   │           │   ├── revoke/route.ts  # Logout
        │   │           │   └── refresh/route.ts # Refresh token
        │   │           └── health/route.ts
        │   ├── next.config.ts
        │   ├── wrangler.toml
        │   ├── .npmrc                  # legacy-peer-deps=true
        │   ├── .env.local              # Variables build time
        │   └── package.json
        │
        ├── api-auth-gateway/           ← Worker Vocostar App (autre projet)
        └── ...
```

---

## 🌐 URLs de Production

| Service | URL | Statut |
|---|---|---|
| **Dashboard** | https://opengrow-vocostar.pages.dev | ✅ Live |
| **OpenGrow API / OAuth** | https://go.vocostar.com | ✅ Live |
| **Worker dev** | https://opengrow.vocostar.workers.dev | ✅ Live |
| **SDK mobile** | https://sdk.vocostar.com | ✅ Live |
| **API mobile Vocostar** | https://api.vocostar.com | ⚠️ réservé à `api-auth-gateway`, ne pas utiliser pour OpenGrow |
| **Short links** | https://go.vocostar.com/{slug} | ✅ Live |

---

## 🔑 Identifiants & Secrets

### Compte Admin Dashboard
```
URL      : https://opengrow-vocostar.pages.dev/login
Email    : admin@vocostar.com
Password : Vocostar2025!
```

### OAuth2 Client (dans la DB D1 — table oauth_applications)
```
client_id     : opengrow-vocostar
client_secret : opengrow-dashboard-secret-vocostar-2025
grant_type    : password
expires_in    : 2592000 secondes (30 jours)
```

> ⚠️ Le `client_id` utilisé dans les variables d'environnement Pages est `opengrow-vocostar`  
> (anciennement `opengrow-dashboard-vocostar` — mis à jour le 12/05/2026)

### Cloudflare
```
Account ID    : 4fec11873e7130ab0e44e795e3e3afd3
Zone          : vocostar.com
D1 DB name    : opengrow-db
D1 DB ID      : ce7fbaad-9f73-49ff-9b33-fb820c33c051
KV ID         : 21faee2703d54c58a7cc1d46e56391cc
Pages projet  : opengrow-vocostar
Worker nom    : opengrow
Worker ver.   : 566f8eac-8fb8-4492-847b-d451077fa289  (12/05/2026)
```

---

## ⚙️ Fichiers de Configuration

### `workers/opengrow/wrangler.toml`
```toml
name = "opengrow"
main = "src/index.ts"
compatibility_date = "2025-05-01"
compatibility_flags = ["nodejs_compat"]
account_id = "4fec11873e7130ab0e44e795e3e3afd3"
workers_dev = true

[vars]
ENVIRONMENT      = "production"
SHORTLINK_DOMAIN = "go.vocostar.com"
API_DOMAIN       = "go.vocostar.com"
SDK_DOMAIN       = "sdk.vocostar.com"
CORS_ORIGIN      = "*"

[[routes]]
pattern = "go.vocostar.com"
custom_domain = true

[[routes]]
pattern = "sdk.vocostar.com"
custom_domain = true

[[d1_databases]]
binding = "DB"
database_name = "opengrow-db"
database_id = "ce7fbaad-9f73-49ff-9b33-fb820c33c051"

[[kv_namespaces]]
binding = "KV"
id = "21faee2703d54c58a7cc1d46e56391cc"
```

### `workers/opengrow-dashboard/wrangler.toml`
```toml
name = "opengrow-dashboard"
compatibility_date = "2025-05-01"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = ".vercel/output/static"

[vars]
NEXT_PUBLIC_API_URL   = "https://go.vocostar.com"
NEXT_PUBLIC_API_PATH  = "/api/v1"
NEXT_PUBLIC_CLIENT_ID = "opengrow-vocostar"
NEXT_PUBLIC_ENV       = "production"
```

### `workers/opengrow-dashboard/.env.local`
```env
NEXT_PUBLIC_API_URL=https://go.vocostar.com
NEXT_PUBLIC_API_PATH=/api/v1
NEXT_PUBLIC_CLIENT_ID=opengrow-vocostar
NEXT_PUBLIC_ENV=production
CLIENT_SECRET=opengrow-dashboard-secret-vocostar-2025
```

### `workers/opengrow-dashboard/.npmrc`
```
legacy-peer-deps=true
```

---

## 🗄️ SQL — Migrations D1

### `migrations/0001_initial_schema.sql`
```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key TEXT NOT NULL UNIQUE,
  uri_scheme TEXT NOT NULL UNIQUE,
  get_started_dismissed INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS instance_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  instance_id INTEGER NOT NULL REFERENCES instances(id),
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, instance_id)
);

CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  slug TEXT NOT NULL UNIQUE,
  instance_id INTEGER REFERENCES instances(id),
  destination_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### `migrations/0002_oauth_tables.sql`
```sql
CREATE TABLE IF NOT EXISTS oauth_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  uid TEXT NOT NULL UNIQUE,
  secret TEXT NOT NULL,
  redirect_uri TEXT DEFAULT 'urn:ietf:wg:oauth:2.0:oob',
  scopes TEXT NOT NULL DEFAULT 'read write',
  confidential INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_owner_id INTEGER,
  application_id INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  refresh_token TEXT UNIQUE,
  expires_in INTEGER,
  revoked_at DATETIME,
  scopes TEXT DEFAULT 'read write',
  created_at DATETIME NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (resource_owner_id) REFERENCES users(id),
  FOREIGN KEY (application_id) REFERENCES oauth_applications(id)
);

-- SEED — Client OAuth du dashboard
INSERT OR IGNORE INTO oauth_applications (name, uid, secret, scopes)
VALUES (
  'OpenGrow Dashboard',
  'opengrow-vocostar',
  'opengrow-dashboard-secret-vocostar-2025',
  'read write'
);

CREATE INDEX IF NOT EXISTS idx_oauth_tokens_token ON oauth_access_tokens(token);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_owner ON oauth_access_tokens(resource_owner_id);
```

---

## 🏗️ Commandes de Déploiement

### Déployer le Worker Backend (opengrow)
```bash
cd cloudflare/workers/opengrow
CLOUDFLARE_ACCOUNT_ID=4fec11873e7130ab0e44e795e3e3afd3 wrangler deploy
```

### Déployer le Dashboard (opengrow-dashboard)
```bash
cd cloudflare/workers/opengrow-dashboard

# Étape 1 — Build Next.js
NEXT_PUBLIC_API_URL=https://go.vocostar.com \
NEXT_PUBLIC_API_PATH=/api/v1 \
NEXT_PUBLIC_CLIENT_ID=opengrow-vocostar \
NEXT_PUBLIC_ENV=production \
CLIENT_SECRET=opengrow-dashboard-secret-vocostar-2025 \
npx vercel build --yes

# Étape 2 — Transformer pour Cloudflare edge
npx @cloudflare/next-on-pages --skip-build

# Étape 3 — Upload sur Cloudflare Pages
CLOUDFLARE_ACCOUNT_ID=4fec11873e7130ab0e44e795e3e3afd3 \
wrangler pages deploy .vercel/output/static \
  --project-name opengrow-vocostar \
  --branch main \
  --commit-dirty=true
```

### Appliquer une migration D1
```bash
cd cloudflare/workers/opengrow
wrangler d1 migrations apply opengrow-db --remote
```

### Vérifier l'état du Worker
```bash
curl https://go.vocostar.com/health
# → {"status":"ok"}
```

### Tester l'API (obtenir un token)
```bash
curl -X POST https://go.vocostar.com/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "password",
    "email": "admin@vocostar.com",
    "password": "Vocostar2025!",
    "client_id": "opengrow-vocostar",
    "client_secret": "opengrow-dashboard-secret-vocostar-2025"
  }'
```

---

## 🔄 Redéployer depuis Zéro (nouveau Mac / nouveau dev)

```bash
# 1. Installer Wrangler globalement
npm install -g wrangler

# 2. Se connecter à Cloudflare
wrangler login

# 3. Worker backend
cd app-vocostar/cloudflare/workers/opengrow
npm install
wrangler d1 migrations apply opengrow-db --remote
CLOUDFLARE_ACCOUNT_ID=4fec11873e7130ab0e44e795e3e3afd3 wrangler deploy

# 4. Dashboard
cd ../opengrow-dashboard
npm install
# → puis les 3 étapes de build/deploy ci-dessus
```

---

## 🗺️ Routes API — Vue d'ensemble complète

### Worker `opengrow` — Routes implémentées

#### Auth & Users
| Méthode | Route | Description |
|---|---|---|
| POST | `/oauth/token` | Login (password grant) |
| POST | `/oauth/revoke` | Logout / révocation token |
| GET | `/oauth/token/info` | Info sur le token actif |
| GET | `/api/v1/users/me` | Profil utilisateur courant |
| PATCH | `/api/v1/users/me` | Mettre à jour le profil |
| DELETE | `/api/v1/users/me` | Supprimer le compte |
| GET | `/api/v1/users/me/otp_qr` | QR code 2FA |
| POST | `/api/v1/users/me/two_factor` | Activer/désactiver 2FA |
| POST | `/api/v1/users/invitations/accept` | Accepter une invitation |

#### Instances (Projets OpenGrow)
| Méthode | Route | Description |
|---|---|---|
| GET | `/api/v1/instances` | Liste des instances |
| POST | `/api/v1/instances` | Créer une instance |
| GET | `/api/v1/instances/:id` | Détail d'une instance |
| PUT | `/api/v1/instances/:id` | Modifier une instance |
| DELETE | `/api/v1/instances/:id` | Supprimer une instance |
| GET | `/api/v1/instances/:id/members` | Liste des membres |
| POST | `/api/v1/instances/:id/members` | Inviter un membre |
| DELETE | `/api/v1/instances/:id/members` | Retirer un membre |
| GET | `/api/v1/instances/:id/role` | Rôle de l'utilisateur |
| GET | `/api/v1/instances/:id/configurations` | Config globale |
| GET/PUT/DELETE | `/api/v1/instances/:id/configurations/ios` | Config iOS |
| GET/PUT | `/api/v1/instances/:id/configurations/ios/push` | Push iOS |
| GET/PUT/DELETE | `/api/v1/instances/:id/configurations/android` | Config Android |
| GET/PUT | `/api/v1/instances/:id/configurations/android/push` | Push Android |
| PUT | `/api/v1/instances/:id/configurations/android/api_access_key` | Webhook key |
| GET | `/api/v1/instances/:id/configurations/android/google_configuration_script` | Script Google |
| GET/PUT/DELETE | `/api/v1/instances/:id/configurations/web` | Config Web |
| GET/PUT/DELETE | `/api/v1/instances/:id/configurations/desktop` | Config Desktop |
| GET | `/api/v1/instances/:id/billing/subscription` | Abonnement actif |
| GET | `/api/v1/instances/:id/billing/subscriptions` | Historique abonnements |
| GET | `/api/v1/instances/:id/billing/mau` | MAU courant |
| GET | `/api/v1/instances/:id/billing/usage` | Utilisation |
| GET | `/api/v1/instances/:id/billing/stripe_portal` | URL portail Stripe |
| POST | `/api/v1/instances/:id/dismiss_get_started` | Cacher le get started |
| GET | `/api/v1/instances/:id/setup_progress` | Étapes de setup |
| POST | `/api/v1/instances/:id/setup_progress/complete` | Marquer comme complet |
| PUT | `/api/v1/instances/:id/revenue_collection` | Activer revenus |
| POST | `/api/v1/instances/:id/exports/usage` | Export usage |
| POST | `/api/v1/instances/:id/events/billing` | Événement billing |

#### Projects (liens, analytics, domaine…)
> ⚠️ Le dashboard envoie le project ID sous la forme `{instanceId}-prod` ou `{instanceId}-test`  
> Le Worker extrait automatiquement le vrai ID numérique (`6-prod` → `6`)

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/v1/projects/:id/links/random_path` | Chemin aléatoire |
| POST | `/api/v1/projects/:id/links/check_path` | Vérifier dispo d'un path |
| POST | `/api/v1/projects/:id/links` | Créer un lien |
| POST | `/api/v1/projects/:id/links/search_v2` | Chercher des liens |
| POST | `/api/v1/projects/:id/links/by_ids` | Liens par IDs |
| DELETE | `/api/v1/projects/:id/links/:linkId` | Supprimer un lien |
| GET | `/api/v1/projects/:id/domain` | Config domaine |
| PUT | `/api/v1/projects/:id/domain` | Modifier domaine |
| GET | `/api/v1/projects/:id/domain/defaults` | Valeurs par défaut |
| POST | `/api/v1/projects/:id/domain/check_availability` | Dispo sous-domaine |
| PUT | `/api/v1/projects/:id/domain/google_tracking_id` | Google Analytics ID |
| GET | `/api/v1/projects/:id/redirect_config` | Config redirections |
| PUT | `/api/v1/projects/:id/redirect_config` | Modifier redirections |
| PUT | `/api/v1/projects/:id/redirect_config/redirect` | Redirection par plateforme |
| POST | `/api/v1/projects/:id/dashboard/top_links` | Top liens (métriques) |
| POST | `/api/v1/projects/:id/dashboard/links_views` | Vues des liens |
| POST | `/api/v1/projects/:id/dashboard/metrics_overview` | Vue d'ensemble métriques |
| POST | `/api/v1/projects/:id/campaigns` | Créer une campagne |
| POST | `/api/v1/projects/:id/campaigns/search_v2` | Chercher campagnes |
| POST | `/api/v1/projects/:id/campaigns/metrics_overview` | Métriques campagnes |
| GET/PUT/DELETE | `/api/v1/projects/:id/campaigns/:campaignId` | CRUD campagne |
| POST | `/api/v1/projects/:id/events/overview` | Événements overview |
| POST | `/api/v1/projects/:id/events/sorted` | Événements triés |
| POST | `/api/v1/projects/:id/events/search` | Recherche événements |
| POST | `/api/v1/projects/:id/events/billing` | Événement billing |
| GET | `/api/v1/projects/:id/events/metric_values` | Valeurs métriques |
| POST | `/api/v1/projects/:id/visitors/search` | Chercher visiteurs |
| POST | `/api/v1/projects/:id/visitors/aggregated` | Visiteurs agrégés |
| GET | `/api/v1/projects/:id/visitors/:visitorId` | Détail visiteur |
| POST | `/api/v1/projects/:id/purchases/search` | Chercher achats |
| POST | `/api/v1/projects/:id/purchases/revenue` | Métriques revenus |
| POST | `/api/v1/projects/:id/notifications/search` | Chercher notifs |
| POST | `/api/v1/projects/:id/notifications` | Créer une notif |
| DELETE | `/api/v1/projects/:id/notifications/:notifId` | Archiver une notif |
| POST | `/api/v1/projects/:id/exports/links` | Exporter les liens |
| POST | `/api/v1/projects/add_event` | Ajouter un événement |

#### MCP
| Méthode | Route | Description |
|---|---|---|
| GET | `/api/v1/mcp/tokens` | Liste des tokens MCP |
| DELETE | `/api/v1/mcp/tokens/:id` | Révoquer un token MCP |

#### Short Links & Well-known
| Méthode | Route | Description |
|---|---|---|
| GET | `go.vocostar.com/:slug` | Redirection short link |
| GET | `/.well-known/apple-app-site-association` | Universal links iOS |
| GET | `/.well-known/assetlinks.json` | App links Android |

---

## ⚠️ Pièges Importants (Lessons Learned)

### 1. Format des Project IDs
Le dashboard envoie les appels avec `{instanceId}-prod` ou `{instanceId}-test` comme project ID (ex: `6-prod`). Le Worker utilise `parseInstanceId()` pour extraire `6`.

### 2. Format des réponses Billing
L'endpoint `/billing/subscription` doit retourner l'objet `Subscription` **directement** (pas wrappé dans `{ subscription: {...} }`), car le service Axios est typé `AxiosResponse<Subscription>` et le hook fait `subscription: response.data`.

### 3. Objet Instance Complet
L'objet instance retourné par `/api/v1/instances` doit inclure `production`, `test`, `projects`, `hash_id`, `revenue_collection_enabled`, `updated_at` — le dashboard accède directement à `selectedInstance.production.domain`.

### 4. Cache React Query
Si une API retournait une mauvaise réponse, le navigateur la met en cache React Query. Toujours faire **Ctrl+Shift+R** (hard refresh) après un fix de déploiement.

### 5. Séparation des sous-domaines
`api.vocostar.com` est réservé à l'API mobile Vocostar (`api-auth-gateway`). OpenGrow ne doit pas déclarer cette route. Le dashboard OpenGrow utilise `go.vocostar.com` pour OAuth/API OpenGrow, et `go.vocostar.com` sert aussi les redirections de short links. `sdk.vocostar.com` pointe vers le Worker OpenGrow pour les endpoints SDK.

---

## 📦 Versions

| Outil | Version |
|---|---|
| Node.js | v25.9.0 |
| npm | 11.12.1 |
| Wrangler | 4.68.1 |
| @cloudflare/next-on-pages | 1.13.16 |
| Next.js | 15.3.2 |
| React | 18.3.1 |
| Hono | 4.7.4 |
| jose (JWT) | 5.10.0 |
| bcryptjs | 3.0.2 |
| TypeScript | 5.x |

---

## 📅 Historique des Déploiements

| Date | Action | Worker Version |
|---|---|---|
| 11/05/2026 | Worker `opengrow` + D1 créés et déployés | — |
| 11/05/2026 | Routing subdomain `go/api/sdk.vocostar.com` | — |
| 12/05/2026 | Dashboard `opengrow-vocostar.pages.dev` déployé | — |
| 12/05/2026 | Fix OAuth JSON + champ `user` dans token response | — |
| 12/05/2026 | Routes `/api/v1/users/*` ajoutées au Worker | — |
| 12/05/2026 | Login dashboard ✅ fonctionnel | — |
| 12/05/2026 | Renommage → `opengrow-vocostar.pages.dev` | — |
| 12/05/2026 | Ajout routers `instances.ts`, `projects.ts`, `mcp.ts` | 1fb79448 |
| 12/05/2026 | Fix objet Instance complet (production/test/hash_id) | a63e0cc5 |
| 12/05/2026 | Fix parseInstanceId (`6-prod` → `6`) + endpoints manquants | 7c07181a |
| 12/05/2026 | Fix format réponse billing/subscription (objet direct) | 566f8eac |
| 12/05/2026 | Ajout configurations iOS/Android/Web/Desktop complets | 566f8eac |
| 12/05/2026 | Dashboard Settings ✅ fonctionnel | 566f8eac |
| 12/05/2026 | Compat Cloudflare OpenGrow: OAuth refresh, projets, liens, campagnes, domaines, configs app et dashboard BFF | local |

---

*12 mai 2026 — Antigravity pour Vocostar*
