---
date: 2026-09-19
type: amelioration
cible: AGENTS.md
statut: integre
---

## Observation

« tu dois toujours tester avant » et « 17 woerks mais lis tu correctement le dossier ? ».
L'agent a partagé une URL locale (`http://127.0.0.1:4321`) avant qu'elle ne soit prête et a déduit une architecture de « 17 workers » depuis la sortie brute de `ps`, au lieu de consulter `packages/plugins/WORKERS.md` qui documente 10 groupes de déploiement.

## Contexte

Dépôt SuperBoard (`mabzadev/superboard`), lors de la commande `pnpm local:start` et de l'analyse de l'état du dépôt.

## Action proposée

Inscrire et faire respecter deux invariants stricts dans `AGENTS.md` pour tous les agents :
1. « Verify before announcing » : interdiction d'annoncer un service ou un lien prêt sans vérification préalable (`curl -f -I`, probe, test).
2. « Canonical docs over runtime guessing » : interdiction de déduire l'architecture depuis des listes de processus (`ps`) ; obligation de citer les documents autoritatifs (`CONTEXT.md`, `WORKERS.md`).

## Critère de vérification

Lorsqu'un agent lance un serveur local ou décrit l'architecture des Workers, il vérifie l'accès HTTP effectif avant de répondre et cite le tableau des groupes de déploiement de `WORKERS.md`.

## Trace

- statut : integre
- décision : Invariants « Verify before announcing » et « Canonical docs over runtime guessing » inscrits dans AGENTS.md.
- changements : AGENTS.md
