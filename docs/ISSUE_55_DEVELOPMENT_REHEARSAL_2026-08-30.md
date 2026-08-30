# Issue #55 — état du rehearsal development

Ce document enregistre l’état réel du rehearsal `mbza-development/development`.
Il ne constitue pas un reçu de fin de ticket : les gates Release Front, trafic,
rollback et seconde répétition restent ouverts.

## Étapes distantes exécutées

- Le compte Cloudflare sélectionné expose le modèle Workers `standard` et le
  déploiement réel du Site a accepté le binding Dynamic Worker Loader.
- L’inventaire paginé a couvert 46 ressources sans drift blocker.
- Le bootstrap a créé les ressources Site D1/R2/KV et les ressources Support
  v2 D1/R2/Vectorize/Queues. Les quatre identifiants qui appartiennent au
  manifeste sont enregistrés dans `deploy/targets/mbza-development.json`.
- Treize D1 ont été exportés avant la première migration vers le répertoire
  protégé hors Git
  `/Users/appmonster/Workspace/.superboard-backups/issue-55-20260830`.
  Chaque export possède un reçu local `0600`, sa taille et son SHA-256.
- Le plan distant annonçait 31 migrations en attente : API 1, Site 6 et
  Support 24. L’application sérialisée et la relecture Wrangler terminent à
  zéro migration en attente sur les treize D1.
- Le Site EmDash route-free a d’abord validé son build, ses assets, son secret
  initial, ses bindings D1/R2/KV, son cron, son observabilité et son Worker
  Loader.
- Le flag explicite `--site-preview-route` a ensuite attaché uniquement
  `site.mbza.dev`, sans route `board.mbza.dev` et sans `workers.dev`.
- La version Cloudflare active observée après ce déploiement est
  `5fc3f3bb-bcaa-4894-ba65-e97529892112`.

## Smokes distants

| Surface | Résultat observé |
| --- | --- |
| `https://site.mbza.dev/superboard-system/health` | `200` |
| `https://site.mbza.dev/superboard-system/readiness` | `503`, aucune Release Front active |
| `https://site.mbza.dev/` | `503`, maintenance fail-closed |
| `https://site.mbza.dev/_emdash/admin` | `302` vers `/_emdash/admin/setup` |

Le Dashboard historique et ses domaines restent inchangés. Aucune cible
`vocostar/production` n’a été lue ou mutée pendant ces opérations.

## Gate ouvert exact

Le nouveau Site n’a encore aucun Opérateur SuperBoard initialisé. La suite exige
donc une intervention de l’Opérateur SuperBoard sur `/_emdash/admin/setup`, puis une vraie
strong reauthentication. Tant que ce gate humain n’est pas franchi :

- `SUPERBOARD_RELEASE_OPERATIONS` reste `disabled` ;
- aucun Front Release Candidate distant n’est compilé, prévisualisé, approuvé
  ou activé ;
- aucun palier 1 % → 10 % → 50 % → 100 % n’est ouvert ;
- aucun rollback distant ni second passage identique ne peut être attesté ;
- l’issue #55 reste ouverte et #56 reste bloquée.

## Commande de preview versionnée

Après initialisation opérateur et satisfaction des gates Release Front, le Site
development se déploie sur son domaine de preview explicite avec :

```sh
node scripts/cloudflare-deploy.mjs \
  --target mbza-development \
  --environment development \
  --service site \
  --site-preview-route
```

Le générateur refuse ce flag pour production, pour un autre service, en
preflight ou en combinaison avec `--no-routes`.
