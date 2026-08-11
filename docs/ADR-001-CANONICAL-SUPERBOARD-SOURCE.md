# ADR-001 — Canonical SuperBoard source

Status: superseded by the monorepo consolidation on 11 August 2026.

## Context

The repository inherited documentation and an inventory command for comparing a
former Rails implementation below `upstream/opengrow/*`. No such comparison
source, submodule declaration or immutable repository mapping is present in the
current checkout. An empty comparison previously looked green because zero
upstream routes and tables produced zero missing entries.

The target architecture requested for SuperBoard has a different ownership rule:
one maintained Git source deploys the reusable platform to several Cloudflare
accounts, while application manifests and at most one custom Worker contain the
differences. Continuing to make an unavailable historical tree a release
authority would contradict that rule and make a fresh project depend on a source
that cannot be reproduced.

## Decision

`mbzadev/superboard` is the canonical product source. Its checked-in target
schemas, Worker contracts, D1 migrations, SDK catalogues, tests and protected Git
history are the release authority. The acceptance application lives at
`apps/reference`; it does not become a second platform authority.

Historical upstream parity is retired as a release gate. The source revisions
already recorded in `docs/HISTORY_MIGRATION.md` remain provenance evidence. If
the former repositories are restored at immutable revisions, operators may run
`npm run migration:parity:check` as a forensic comparison. Its result can inform
new porting work, but an absent or moving upstream can never make a release green
or override the current SuperBoard contracts.

## Consequences

- new applications reuse `superboard` and a target manifest;
- fixes are made once in the canonical source and promoted through `dev` and
  `main`;
- Cloudflare account IDs and secrets remain outside source;
- historical route/schema comparison is explicit and fail-closed when invoked;
- the operational readiness report verifies this governance decision and its
  provenance files;
- any future external source proposed as a release authority requires a new ADR,
  immutable revision policy and reproducible checkout contract.
