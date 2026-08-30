# Issue #55 — état du rehearsal development

Ce document enregistre le résultat final du rehearsal
`mbza-development/development`. Les gates Release Front, trafic, rollback
Worker, rollback pointer-only et seconde répétition ont été exercés. Il ne
constitue aucune autorisation de mutation de `vocostar/production`.

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
- La première version Cloudflare observée était
  `5fc3f3bb-bcaa-4894-ba65-e97529892112`. La version finale après ajout des
  consoles opérateur et récupération du rollback Worker est
  `dc8ae1c3-f5d3-4ef2-85e8-b6a9eea31dc0` à 100 %.

## Smokes distants

| Surface | Résultat observé |
| --- | --- |
| `https://site.mbza.dev/superboard-system/health` | `200` |
| `https://site.mbza.dev/superboard-system/readiness` | `503`, aucune Release Front active |
| `https://site.mbza.dev/` | `503`, maintenance fail-closed |
| `https://site.mbza.dev/_emdash/admin` | session Opérateur SuperBoard vérifiée après magic link |

Le Dashboard historique et ses domaines restent inchangés. Aucune cible
`vocostar/production` n’a été lue ou mutée pendant ces opérations.

## Résultat final du rehearsal

- L’Opérateur SuperBoard `mabzadev@gmail.com` est initialisé sans passkey. Les
  opérations sensibles ont utilisé des magic links à usage unique et des reçus
  séparés pour `front_release.approve`, `front_release.activate` et
  `front_release.rollback`.
- `SUPERBOARD_RELEASE_OPERATIONS` est activé uniquement sur
  `mbza-development/development`, conjointement à la route preview explicite.
- La migration `0007_front_activation_reauthentication.sql` est appliquée ; les
  sept migrations Site sont convergées. L’export SQL additionnel a été refusé
  par D1 à cause des tables virtuelles FTS5. Le restore point officiel Time
  Travel enregistré hors Git est
  `00000002-00000936-000050d7-e267b9d78a59b8a498c27593dfbf5a62`.
- La première release activée est `01M190CCWS162J978MKGDEYS0Z`, candidat
  `01M190CCWSG2XAX372WM488H6S`, content checksum
  `sha256:85c1460b7db8540aa5cb4cebbd35734a6a4145c9ff8595595018a0b6c20e8bf4`
  et validation set
  `sha256:0a5914ff8097ff9e8a714a93e7d3e859a1348471ebf19f2119283b2098240651`.
  Son activation `7c399a20-3d5c-4ad7-b48b-2ffe3364f416` a créé la révision 1.
- Le second passage a produit la séquence 2 avec predecessor exact
  `01M190CCWS162J978MKGDEYS0Z`. La release v2
  `01M1919PWED5VBX5FK1VBHCTGS`, candidat
  `01M1919PWEEA1CHN866SN23V16`, content checksum
  `sha256:80e01bef9921dd3ac0ca6673a8b7a1af699e5b1a2693d324875a1f6ea30ee18a`
  et validation set
  `sha256:9a21a3790ee8f9df46aa3b34bdd8a76a425dce130a93d3da779c4a86ae8ed796`
  a été prévisualisée, approuvée puis activée par
  `2f93d905-43e5-42d3-901a-37e58c7e7abd` en révision 2.
- Le rollback pointer-only `459380ab-e8d7-4717-937c-7e3e63a41504` a restauré
  v1 en révision 3. Les historiques, outboxes et liens de réauthentification
  sont présents pour l’activation v2 et le rollback. Aucun Store, objet ou
  session n’a été supprimé.
- Le rollout Worker a été observé aux paliers 1 %, 10 %, 50 % et 100 % avec les
  déploiements `b3e6c270-4387-4d67-8e83-e058886fa450`,
  `fa321ee3-db3c-42e2-8e0e-0f90252fd468`,
  `7f528aec-3867-4847-8163-58f83500d7f4` et
  `5ff3048a-7683-4c05-8755-610faf3dc74f`. Une clé
  `Cloudflare-Workers-Version-Key` stable est restée sur la même version à
  chaque palier. Les overrides de version ont servi la même Release Front.
- Le rollback Worker a déployé `fb991c80-8090-43c6-8334-653a7ed07408` à 100 %
  (`ea64a293-59ed-4054-a63d-c3312dab0e2a`) puis restauré
  `dc8ae1c3-f5d3-4ef2-85e8-b6a9eea31dc0` à 100 %
  (`a36cad1d-98d1-4e5e-8b22-c2c64e53da8f`). Vingt requêtes pendant le rollback
  et cinquante après récupération ont toutes retourné `200` avec v1.
- Le contrôle final sous charge a exécuté 100 requêtes en cinq vagues de 20 :
  100 réponses `200`, release unique v1, sources D1 et Last Verified Cache
  normalisées identiques, p50 `270,6 ms`, p95 `884,8 ms`, maximum `1 744,3 ms`.
- Les deux passages rendent la même Présentation EmDash. Leurs checksums de
  release diffèrent volontairement parce que la séquence et le predecessor font
  partie du Canonical Release Payload.
- Aucune lecture ni mutation `vocostar/production` n’a été effectuée.

## Commande de preview versionnée

Après initialisation opérateur et satisfaction des gates Release Front, le Site
development se déploie sur son domaine de preview explicite avec :

```sh
node scripts/cloudflare-deploy.mjs \
  --target mbza-development \
  --environment development \
  --service site \
  --site-preview-route \
  --release-operations
```

Le générateur refuse les opérations Release pour production, pour un autre
service, sans route preview, en preflight ou en combinaison avec `--no-routes`.
