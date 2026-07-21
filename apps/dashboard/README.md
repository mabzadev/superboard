<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://s3.eu-north-1.amazonaws.com/grovs.io/full-white.svg">
    <img src="https://s3.eu-north-1.amazonaws.com/grovs.io/full-black.svg" width="120" alt="Grovs">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/grovs-io/dashboard/releases"><img src="https://img.shields.io/github/v/release/grovs-io/dashboard?style=flat-square&color=4F46E5" alt="Latest release"/></a>
  <a href="#"><img src="https://img.shields.io/badge/Next.js-15-4F46E5?style=flat-square&logo=nextdotjs&logoColor=white" alt="Next.js 15"/></a>
  <a href="#"><img src="https://img.shields.io/badge/React-19-4F46E5?style=flat-square&logo=react&logoColor=white" alt="React 19"/></a>
  <a href="#"><img src="https://img.shields.io/badge/shadcn%2Fui-latest-4F46E5?style=flat-square" alt="shadcn/ui"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/grovs-io/dashboard?style=flat-square&color=4F46E5" alt="MIT License"/></a>
  <a href="https://github.com/grovs-io/dashboard/stargazers"><img src="https://img.shields.io/github/stars/grovs-io/dashboard?style=flat-square&color=4F46E5" alt="GitHub stars"/></a>
</p>

**Open-source dashboard for mobile app growth** — deep links, messaging campaigns, revenue tracking, and audience analytics.

Grovs helps mobile developers grow their apps by providing a single dashboard to manage deep links, send targeted push notifications, track revenue, and understand their audience. Self-host it or connect it to the [Grovs](https://grovs.io) managed backend.

## Tech Stack

- [Next.js 15](https://nextjs.org/) (App Router)
- [React 19](https://react.dev/)
- [TypeScript 5](https://www.typescriptlang.org/) (strict mode)
- [Tailwind CSS 4](https://tailwindcss.com/)
- [shadcn/ui](https://ui.shadcn.com/) (new-york style)

## Prerequisites

- Node.js 20+
- npm 10+

## Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/grovs-io/dashboard.git
   cd dashboard
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create your environment file:

   ```bash
   cp .env.example .env.local
   ```

   Fill in the required values (see `.env.example` for documentation).

4. Start the development server:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3001](http://localhost:3001).

## Docker

You can also run the dashboard using Docker:

```bash
cp .env.example .env.local
docker compose up --build
```

The app will be available at [http://localhost:3036](http://localhost:3036). See `docker-compose.yml` for configuration options.

## Project Structure

```
src/
├── app/                     # Next.js App Router pages
│   └── (protected)/         # Auth-required pages
├── api/                     # API service functions (async/await)
├── components/
│   ├── ui/                  # shadcn/ui primitives
│   ├── layout/              # App chrome (sidebar, header, nav)
│   ├── common/              # Shared utility components
│   └── auth/                # Auth-related components
├── context/                 # React Context providers
├── hooks/                   # Custom React hooks
├── lib/                     # Utilities (API client, storage, helpers)
└── constants/               # App constants
```

## Environment Variables

See [`.env.example`](.env.example) for all available configuration options.

**Required:** `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_CLIENT_ID`, `CLIENT_SECRET`

**Optional:** Firebase, Chatwoot, PostHog, GTM (features gracefully disable when not configured)

## Scripts

| Command                 | Description                             |
| ----------------------- | --------------------------------------- |
| `npm run dev`           | Start dev server (port 3001, Turbopack) |
| `npm run build`         | Production build                        |
| `npm run lint`          | Run ESLint                              |
| `npm test`              | Run unit tests (Vitest)                 |
| `npm run test:watch`    | Run tests in watch mode                 |
| `npm run test:coverage` | Run tests with coverage report          |
| `npm start`             | Start production server                 |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## Security

See [SECURITY.md](SECURITY.md) for our vulnerability disclosure policy.

## License

[MIT](LICENSE)
