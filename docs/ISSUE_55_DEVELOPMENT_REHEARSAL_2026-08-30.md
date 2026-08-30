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

## Correction finale du catalogue de plugins

La première clôture de #55 comptait à tort les manifests de contrôle comme des
plugins runtime installés. Le ticket a été rouvert et cette lacune a été
corrigée avant la clôture finale.

- Les 18 plugins SuperBoard concrets possèdent maintenant un entrypoint EmDash
  bundlé et apparaissent comme plugins configurés. Le template
  `supbrd-plugmod-custom-*` reste exclu : son Worker Descriptor est
  `not_ready` et son identifiant wildcard ne représente pas une installation.
- `_plugin_state` contient 18 états SuperBoard `active`, source `config`.
  L’écran EmDash Plugins affiche 19 cartes : les 18 plugins SuperBoard plus
  `cloudflare-email`.
- `supbrd-plug-user` v1.3.0 est devenu le manifest actif avec les six Stores
  canoniques `access_keys`, `credentials`, `customers`, `directory`,
  `referrals` et `sessions`. Les tests d’autorité, chiffrement, CAS,
  idempotence et shadow read restent verts après promotion.
- Les 18 dependencies possèdent un health receipt `ready` borné. La
  synchronisation distante du catalogue a été exécutée le
  `2026-08-30T10:30:28.196Z` et expire le `2026-08-31T10:30:28.196Z`.
- La Release Front complète `01M193JMG6NKBDJXW9TMSBN48E`, candidat
  `01M193JMG61VZPZ8W5QGGMSY3Q`, contient 19 entrées de Plugin Lock : Core et
  les 18 plugins concrets. Elle contient 18 Dependency Policies, 13 reçus de
  validation, le content checksum
  `sha256:d522335008dea064a8171c1d161c29f2321dbf3201068f300a759b9425bfc471`
  et le validation set
  `sha256:c4a30c43729b26004152432dfff853cc4f9c91d624878e32adad3fc913c287db`.
- Cette Release complète a été approuvée puis activée par
  `0adb66e7-c880-4622-8064-b8e55c04025e` en révision 4. Le rollback
  pointer-only `722c7421-2593-446f-b342-975f250ce8c8` a restauré v1 en
  révision 5. Les deux opérations possèdent un reçu de réauthentification,
  un historique et une outbox vérifiés.
- Le Worker final de cette correction est
  `f5fddd59-1781-4cbf-88bf-fbd699147c2e`. Le commit d’implémentation est
  `912a8fd`.

## Correction fonctionnelle finale des plugins

La correction catalogue ci-dessus prouvait le lifecycle runtime, mais ses
adaptateurs restaient trop minces pour prouver la parité produit. La reprise
fonctionnelle suivante remplace cette preuve incomplète.

- Les 18 plugins installables exposent des paramètres typés, une page Admin,
  un Renderer Front, leurs catalogues de Commands et Data Sources, ainsi que
  leurs Stores réels. Le template wildcard `supbrd-plugmod-custom-*` reste
  volontairement non installable.
- Le catalogue couvre 41 Stores installables et 74 entités de migration. Sur
  `1-test`, 36 lignes source sont présentes dans 6 Stores peuplés ; sur
  `1-prod` du compte development, 37 lignes source sont présentes dans 7
  Stores peuplés. Les deux passages vérifient 74/74 entités côté repository et
  projection. Les deux reverse deltas sont replayable, avec zéro changement et
  zéro suppression.
- La Data Source live
  `supbrd-plugmod-flows.data_source.workflows` lit le Store EmDash, déchiffre
  ses enregistrements et retourne un objet métier réel avec HTTP 200.
- La release fonctionnelle `01M19MG9YN6KQ4KQVF4FRETW1Q`, candidat
  `01M19MG9YNYYMM0M4VJZK7GAY7`, contient 19 entrées de Plugin Lock, 114 routes
  et 13 reçus de validation. Son content checksum est
  `sha256:2aad752715597eb1c2e59209dfd5ef6d7e2ab91189b7080a523c0057aae04495`
  et son validation set est
  `sha256:3596b8485b170004b985dd4a22207bd02eff1bed1a894b3387293b9329fd1dd6`.
- Après réauthentification forte par magic link de `mabzadev@gmail.com`, la
  release a été approuvée le `2026-08-30T18:42:04.691Z`, puis activée par
  `5f12f930-1a18-40eb-9744-e639d0094990` le
  `2026-08-30T18:42:23.892Z`, en révision 6. Les reçus de réauthentification,
  historique et outbox sont tous présents.
- Les routes actives `/analytics`, `/identity/en/users`,
  `/marketing/settings`, `/products/offerings`, `/support/inbox`,
  `/flows/workflows` et `/infrastructure` ont été rendues directement dans
  Vivaldi, sans erreur console ni alerte d'erreur. L'écran Plugins expose 18
  plugins SuperBoard distincts ; la page User affiche notamment `Mfa Policy`,
  `Allow Anonymous Upgrade` et `Max Active Sessions`.
- Les deux jetons opérateur temporaires créés pour le rehearsal ont été
  révoqués ; le compte development en contient zéro. Aucune cible
  `vocostar/production` n'a été lue ou mutée.

Le reçu valeur-free complet est versionné dans
`docs/evidence/issue-54/development-store-authority.receipt.json`. Les commits
de la reprise fonctionnelle sont `aa63f660` et `9b898bc5`.

Cette preuve clôt l'écart « plugins runtime vides » qui avait motivé la seconde
réouverture de #55.

La gate repository-first de #54 a ensuite été fermée par la migration
`0013_repository_first_plugin_commands.sql`. Le gateway de compatibilité du
Site accepte et chiffre chaque mutation dans D1, produit une outbox append-only,
puis seulement appelle le Worker API comme exécuteur transitoire. Un même
operation ID rejoue la réponse chiffrée sans second dispatch. Le runtime test
vérifie explicitement l'ordre acceptance → Worker et le fail-closed lorsque le
repository est indisponible.

La version Site `56cbb24d-7a74-4b4a-b599-4a39c6e41f2a` a été déployée après
convergence de la migration, avec les adaptateurs `/api/v1/*` et `/api/v2/*`.
Un smoke Vivaldi a créé puis supprimé un rapport Analytics sur `1-prod` : opérations
`4d74095c-a60b-477f-802c-74902ead2a73` (`201`) et
`294a84a6-acf2-4439-9c82-afdd11ea9efe` (`200`), toutes deux `completed`, avec
quatre événements outbox et zéro payload métier visible en clair. Le rapport de
smoke a été supprimé après vérification.

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
