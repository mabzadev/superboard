# Contributing to Grovs

## Setup

1. Fork and clone the repo (`grovs-io/dashboard`)
2. `npm install`
3. `cp .env.example .env.local` and configure
4. `npm run dev`

## Development

- **Branch naming:** `feat/description`, `fix/description`, `refactor/description`
- **Commit messages:** Conventional commits, lowercase — `feat:`, `fix:`, `refactor:`, `docs:`
- **Code style:** Enforced by ESLint + Prettier via pre-commit hooks. Run `npm run lint` to check.

## Pull Requests

1. Create a feature branch from `master`
2. Make your changes
3. Run `npm run build` to verify the build passes
4. Run `npm run lint` to verify no lint errors
5. Open a PR with a clear description of what changed and why

## Code Conventions

- TypeScript strict mode — no `any` without justification
- React components in PascalCase
- Hooks: `use[FeatureName].ts`
- Context providers: `use[Feature]Context.tsx`
- API services: `src/api/[domain]/[domain]Service.ts`
- Use `cn()` from `@/lib/utils` for Tailwind class merging
- Do not modify `src/components/ui/` directly (shadcn/ui managed)
