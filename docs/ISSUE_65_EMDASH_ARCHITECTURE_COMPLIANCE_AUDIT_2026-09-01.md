# Audit de conformité exécutable à l’architecture EmDash

- Date de l’audit : 1er septembre 2026
- Commit audité : `35aad4cb2fbe164e754ca55a67f79d9cb2ec1441`
- Périmètre : terminologie, Front du Site, Release Front, catalogue et lifecycle des plugins, Stores, Gateway, targets Cloudflare et reproductibilité d’une Instance vierge
- Sources admises : fichiers suivis au commit audité et résultats de commandes exécutées contre un export de ce commit
- Sources exclues comme preuves : tickets, labels, statuts, commentaires, messages de commit et reçus narratifs

## Résultat

Le commit audité ne satisfait aucun des huit invariants dans sa totalité. Il contient une Release Front signée, un pointeur d’activation, un repository de Stores, des manifests de targets, un générateur Wrangler et des migrations testées. Les chemins exécutables restent cependant divisés entre ces contrats et des registres ou routages codés.

| Invariant audité | Classification | Motif déterminant |
| --- | --- | --- |
| Terminologie Plugin full EmDash, Plugin module et Worker métier | **Partiel** | Les discriminants de manifest existent, mais le runtime publie encore les libellés `Full SuperBoard` et `Module SuperBoard` et n’expose aucun terme canonique dans ses sources actives. |
| Front sans dépendance runtime au Dashboard ou à Next.js | **Violé** | Le Site importe 82 fois `apps/dashboard/src` et résout des API Next.js par des shims Astro. |
| Routes, pages, navigation, sous-menus, permissions, renderers et états issus de la Release active et des manifests | **Violé** | Le matcher de routes lit la Release active, mais la navigation, le registre de composants, le montage des renderers et les états visibles sont codés dans le Site. |
| Catalogue de 18 plugins et lifecycle `available → installed → active` piloté par les données | **Violé** | Le catalogue contient bien 18 plugins concrets, mais les 18 sont configurés et activés implicitement ; le modèle d’état ne représente que `active` ou `inactive`. |
| Stores de plugins autoritatifs, Workers métier limités à l’exécution | **Violé** | Le repository de Stores fonctionne isolément, mais le Front lit et écrit encore via `API_SERVICE`; les Workers modifient directement leurs D1 métier. |
| Gateway piloté par son catalogue, ses politiques et le Gateway Manifest actif | **Violé** | La Release compile un Gateway Manifest vide, alors que 63 enregistrements de routes ou middlewares restent codés dans le Worker API. |
| Même compilateur de target et même graphe pour local, development et production | **Violé** | `local` est rejeté, aucun target suivi ne couvre development et production pour une même Instance, et le compilateur de Release ne consomme pas le target. |
| Instance vierge reproductible de local vers development puis production | **Violé** | Chaque propriétaire D1 peut créer isolément un schéma frais valide, mais aucun chemin exécutable ne reproduit une Instance complète entre les trois environnements sans configuration manuelle. |

## Méthode et état du worktree

Toutes les références `fichier:ligne` de ce document désignent le contenu de l’objet Git au SHA audité. La commande suivante a confirmé que `HEAD` correspondait au SHA demandé :

```text
$ git rev-parse HEAD
35aad4cb2fbe164e754ca55a67f79d9cb2ec1441
```

Le worktree contenait avant l’audit des modifications qui ne font pas partie de la preuve :

```text
 M apps/dashboard/src/analytics/posthog.ts
 M apps/site/emdash-env.d.ts
 M apps/site/src/lib/front-surface-registry.ts
 M apps/site/tests/front-surface-parity.test.ts
 M apps/site/wrangler.jsonc
?? apps/dashboard/src/analytics/__tests__/
?? apps/dashboard/src/context/__tests__/useProjectSelection.site.tsx
```

Ces chemins n’ont pas été modifiés par l’audit. Un `git archive` temporaire a servi aux commandes exécutables. Les commandes suivantes définissent explicitement le snapshot et affichent seulement les hashes comparés :

```text
$ audit_snapshot="$(mktemp -d /tmp/superboard-issue65-35aad4c.XXXXXX)"
$ git archive 35aad4c | tar -x -C "$audit_snapshot"
$ git show 35aad4c:apps/site/src/lib/front-surface-registry.ts \
    | shasum -a 256 | awk '{print $1}'
783520c52b37d16204abe8a67854ca9b8d291da30e8dd4b736e77149fc6bc864
$ shasum -a 256 "$audit_snapshot/apps/site/src/lib/front-surface-registry.ts" \
    | awk '{print $1}'
783520c52b37d16204abe8a67854ca9b8d291da30e8dd4b736e77149fc6bc864
$ shasum -a 256 apps/site/src/lib/front-surface-registry.ts | awk '{print $1}'
ed4434a03bae08d5fcfdf8036ecc8424d6d94eeb03ff2f1f4679d0a6d4f49136
```

Les recherches `git show` et `git grep` épinglées au SHA ont été exécutées depuis le checkout Git. Pour reproduire les tests et builds relatifs du tableau dans l’export isolé, installez le lockfile depuis le snapshot avant de lancer les commandes :

```text
$ cd "$audit_snapshot"
$ pnpm install --frozen-lockfile
```

Le lint de référence était déjà bloqué avant la création de ce rapport. `pnpm lint:json` ne produit pas de JSON exploitable parce qu’Oxlint cherche `sdks/flows/upstream/product/icons/../../.oxlintrc.json`, absent du checkout. Ce blocage n’est pas causé par le rapport.

Les commandes ciblées exécutées dans le snapshot du SHA ont produit les résultats suivants :

| Commande | Résultat |
| --- | --- |
| `pnpm --dir packages/supbrd-core test` | 7 fichiers, 16 tests passés |
| `pnpm --dir apps/site exec vitest run --config vitest.config.ts tests/front-surface-parity.test.ts tests/user-front-release.test.ts tests/operator-api-proxy.test.ts tests/plugin-runtime-contract.test.ts` | 4 fichiers, 12 tests passés |
| `pnpm --dir apps/site exec vitest run --config vitest.runtime.config.ts runtime-tests/plugin-store-authority.runtime.test.ts` | 1 fichier, 10 tests passés |
| `pnpm --filter '@superboard/site^...' build`, puis `pnpm --dir apps/site build` | dépendances construites, puis build Astro du Site terminé |
| `node --test scripts/cloudflare-target.test.mjs scripts/cloudflare-services.test.mjs scripts/cloudflare-deploy-plan.test.mjs` | 45 tests passés |
| `node --test scripts/cloudflare-d1-schema.test.mjs` | 17 tests passés, dont 16 propriétaires de schéma D1 |

Un test vert est interprété selon le comportement qu’il exerce. Par exemple, le premier test runtime des Stores passe précisément parce que la synchronisation rend les 18 plugins `active`; il confirme donc l’activation implicite au lieu de satisfaire le lifecycle demandé.

## 1. Terminologie des plugins et Workers

**Classification : partiel.** Le modèle distingue les familles d’exécution, mais le runtime actif n’utilise pas les trois termes canoniques confirmés.

`packages/supbrd-core/src/plugin-manifest.ts:57-80` définit `plugin_kind: "full" | "module"` et `execution.worker: "none" | "dedicated"`. Ces discriminants permettent de distinguer un Plugin full EmDash d’un Plugin module et son Worker métier, sans toutefois porter les termes eux-mêmes dans les surfaces actives.

La description enregistrée par `apps/site/src/lib/superboard-plugin-catalog.ts:101` produit à la place `Full SuperBoard` ou `Module SuperBoard` :

```text
$ git grep -n 'manifest.plugin_kind === "full"' 35aad4c -- \
    apps/site/src/lib/superboard-plugin-catalog.ts
35aad4c:apps/site/src/lib/superboard-plugin-catalog.ts:101:		const description = `${manifest.plugin_kind === "full" ? "Full" : "Module"} SuperBoard · ${manifest.stores.length} Stores · ${manifest.commands.length} commands`;
```

Une recherche bornée aux sources runtime ne trouve aucun des trois termes canoniques :

```text
$ git grep -l -E 'Plugin full EmDash|Plugin module|Worker métier' 35aad4c -- \
    apps/site/src packages/supbrd-* workers/*/src | wc -l
0
```

### Remplacements terminologiques

1. Remplacer la description de `superboard-plugin-catalog.ts:101` par les libellés Plugin full EmDash et Plugin module dans les surfaces opérateur.
2. Conserver le `worker_descriptor` distinct déjà exposé par `superboard-plugin-catalog.ts:14-29`, le nommer Worker métier dans les surfaces actives et préserver les champs utiles de son contrat au-delà de `deployment_status` et `checksum`.
3. Conserver `full`, `module` et `dedicated` comme identifiants de code anglais tout en utilisant les termes canoniques dans les descriptions et preuves en français.

## 2. Dépendances runtime du Front

**Classification : violé.** Le paquet du Site ne déclare pas `next` comme dépendance directe (`apps/site/package.json:16-35`), mais son graphe compilé incorpore le Dashboard historique et des compatibilités Next.js.

### Imports du Dashboard

`apps/site/src/components/SuperBoardFrontApp.tsx:3-111` importe les pages, composants, providers, traductions et feuilles de style du Dashboard. `apps/site/src/components/SuperBoardFrontProviders.tsx:3-6` importe quatre providers supplémentaires. Le Site configure aussi `../dashboard/src` comme racine d’alias dans `apps/site/astro.config.mjs:16-17,39-74` et `apps/site/tsconfig.json:5-30`.

La commande épinglée au SHA mesure le couplage direct :

```text
$ git grep -c '../../../dashboard/src' 35aad4c -- apps/site/src
apps/site/src/components/SuperBoardFrontApp.tsx:78
apps/site/src/components/SuperBoardFrontProviders.tsx:4
```

Le résultat total est 82 imports runtime. Le build Astro vert du snapshot confirme que ces imports appartiennent au bundle exécutable ; ils ne sont pas des restes inaccessibles.

### Compatibilité Next.js

`apps/site/astro.config.mjs:49-52` remplace `next/link`, `next/image`, `next/navigation` et `next/dynamic` par des shims du Site. Les mêmes résolutions apparaissent dans `apps/site/tsconfig.json:11-14`. Le Dashboard historique contient 80 imports Next.js répartis sur huit modules :

```text
$ git grep -h -E 'from .next/|import .next/' 35aad4c -- apps/dashboard/src \
    | rg -o 'next/[A-Za-z0-9_./-]+' | sort | uniq -c
   4 next/dynamic
   1 next/font/google
  11 next/image
  15 next/link
  40 next/navigation
   1 next/script
   7 next/server
   1 next/web-vitals
```

Ce comptage décrit l’arbre historique complet, pas la fermeture transitive du bundle Site. La dépendance runtime est établie séparément par les 82 imports directs, les alias et le build du Site. Les shims maintiennent le contrat de composants Next.js dans le Front final.

### Remplacements du Front historique

1. Remplacer les imports de `apps/site/src/components/SuperBoardFrontApp.tsx:3-111` et `apps/site/src/components/SuperBoardFrontProviders.tsx:3-6` par des renderers natifs EmDash fournis par les artefacts verrouillés dans la Release active.
2. Supprimer `dashboardSource` et les alias Dashboard/Next de `apps/site/astro.config.mjs:16-17,39-74` et `apps/site/tsconfig.json:5-30` lorsque plus aucun renderer ne les consomme.
3. Retirer `apps/site/src/compat/next-*.ts*` de la surface Front après remplacement des imports. Les adaptateurs d’API métier doivent être rattachés aux commands et data sources de plugins, pas aux conventions du Dashboard.

## 3. Autorité de la Release Front sur la présentation

**Classification : violé.** La Release active gouverne le premier niveau de résolution des routes, mais elle ne gouverne pas l’ensemble de la présentation demandée.

### Fragment conforme : sélection de la Release et matching de route

`apps/site/src/lib/release-source.ts:67-105` charge le pointeur actif et la Release depuis D1, puis `:142-165` vérifie son identité, sa signature et ses checksums. Le fallback KV repasse par la même vérification (`:126-139`). `apps/site/src/lib/front-page.ts:38-45` charge cette Release, et `packages/supbrd-core/src/front-runtime.ts:36-94` choisit la route, applique l’authentification, l’expression de permission et les politiques de dépendances.

Les 16 tests de `packages/supbrd-core` et les 12 tests Front ciblés passent dans le snapshot. Ils valident cette résolution et l’intégrité cryptographique, pas l’origine dynamique des composants visibles.

### Registres de routes et de pages statiques

La Release composée n’est pas issue de données d’Instance. `apps/site/src/lib/user-front-release.ts:5,17-19,78-138` lit `config/emdash-parity-matrix.json`, transforme ses lignes Dashboard en routes/pages/navigation et ajoute deux routes codées. Le fichier fixe aussi les transitions, le layout, le thème et les états (`:139-205`).

Le renderer visible repasse ensuite par un second routeur codé. `apps/site/src/lib/front-surface-registry.ts:1-96` contient la table des chemins et quatre expressions régulières. `apps/site/src/components/SuperBoardFrontApp.tsx:329-486` transforme le composant trouvé en un `switch` de composants importés du Dashboard. Les routes Identity possèdent encore un autre routeur codé dans `:583-627`.

Le test `apps/site/tests/front-surface-parity.test.ts:30-97` prouve que chaque ligne de la matrice statique possède une entrée dans ce registre statique. Il ne démontre pas qu’une modification de manifest actif change le renderer sans modification du code.

### Navigation et sous-menus statiques

`apps/site/src/components/SuperBoardFrontApp.tsx:145-261` déclare huit groupes et tous leurs items. Le shell affiche directement cette constante dans `:263-325`. Il ne lit ni `model.release.release.payload.presentation.navigation` ni une contribution de plugin.

Une fonction sait filtrer la navigation d’une Release dans `apps/site/src/lib/user-front-release.ts:209-220`, mais elle n’est appelée que par son test. Les recherches au SHA donnent :

```text
$ git grep -n 'presentation.navigation' 35aad4c -- apps/site/src | wc -l
1
$ git grep -n 'visibleUserNavigation(' 35aad4c -- apps/site/src apps/site/tests | wc -l
3
```

Le premier résultat est la définition de la fonction. Les trois occurrences du second résultat sont la définition et deux appels de test ; le renderer de production n’en contient aucun.

### Permissions aplaties

Le matcher compare bien `permission_expression` aux permissions reçues (`packages/supbrd-core/src/front-runtime.ts:59-68`). Cependant, `apps/site/src/lib/front-page.ts:168-182` accorde à tout utilisateur EmDash possédant `settings:manage` l’ensemble des expressions présentes dans la Release. La navigation statique n’est pas filtrée par ces permissions (`apps/site/src/components/SuperBoardFrontApp.tsx:283-310`). Le manifest fournit donc les noms de permissions mais pas les droits réels ni la visibilité des sous-menus.

### Renderers, états et thème statiques

`apps/site/src/components/FrontPage.astro:29-48` ne sélectionne pas un artefact par `renderer_id`; il détecte seulement le suffixe `.renderer.admin_surface` puis monte l’unique `SuperBoardFrontApp` aux lignes `119-127`. Les trois renderers utilisateur sont traités par un `if` local aux lignes `33-47`.

Les identifiants d’états viennent de la route, mais le rendu ne les utilise pas. `FrontPage.astro:49-54,160-167` choisit un titre et un paragraphe statiques d’après `resolution.result`, sans monter `resolution.state_renderer_id`. Le thème de la Release n’est pas consommé ; les styles et les variantes clair/sombre sont codés dans `:64-110`.

Le compilateur ne compense pas ces limites. `packages/supbrd-core/src/release-compiler.ts:139-178` vérifie le schéma, l’unicité des routes Front et la présence des états. `:237-258` crée ensuite treize Validation Receipts `passed` sans exécuter les validations annoncées par leurs noms.

### Remplacements de la présentation

1. Remplacer `apps/site/src/lib/front-surface-registry.ts:1-115` et le `switch` de `SuperBoardFrontApp.tsx:329-486` par un registre construit exclusivement depuis le Plugin Lock et les manifests vérifiés de la Release active.
2. Remplacer `navigationGroups` dans `SuperBoardFrontApp.tsx:145-261` par `presentation.navigation`, y compris les sous-menus et leur filtrage par les droits réels.
3. Faire monter par `FrontPage.astro:29-48,119-167` les layouts, renderers et state renderers déclarés, puis appliquer `presentation.theme`, les traductions et les médias de la Release.
4. Remplacer la composition depuis `config/emdash-parity-matrix.json` dans `user-front-release.ts:5,17-19,78-138` par un snapshot de l’Instance et des contributions des seuls plugins actifs sur le target.
5. Remplacer `operatorFrontPermissions` dans `front-page.ts:168-182` par la résolution des grants de l’Instance ; ne pas convertir automatiquement toutes les expressions déclarées en permissions accordées.
6. Remplacer les receipts synthétiques de `release-compiler.ts:237-258` par des validateurs qui résolvent réellement pages, navigation, layouts, renderers, états, permissions et artefacts.

## 4. Catalogue et lifecycle des 18 plugins

**Classification : violé.** Le catalogue et la terminologie nominale existent, mais `available`, `installed` et `active` ne sont pas trois états gouvernés séparément par l’Instance et le target.

### Catalogue complet

Le contrat distingue `plugin_kind: "full" | "module"` et `execution.worker: "none" | "dedicated"` dans `packages/supbrd-core/src/plugin-manifest.ts:57-80`. Les 18 plugins concrets suivis dans `config/emdash-plugin-topology.json` sont :

| Plugin full EmDash | Plugin module |
| --- | --- |
| `supbrd-plug-user` | `supbrd-plugmod-gateway` |
| `supbrd-plug-settings` | `supbrd-plugmod-billing` |
| `supbrd-plug-content` | `supbrd-plugmod-support` |
| `supbrd-plug-products` | `supbrd-plugmod-flows` |
| `supbrd-plug-audit` | `supbrd-plugmod-analytics` |
|  | `supbrd-plugmod-marketing` |
|  | `supbrd-plugmod-email` |
|  | `supbrd-plugmod-dynamic-links` |
|  | `supbrd-plugmod-files` |
|  | `supbrd-plugmod-paywalls` |
|  | `supbrd-plugmod-onboardings` |
|  | `supbrd-plugmod-observability` |
|  | `supbrd-plugmod-mcp` |

Les premières déclarations se trouvent à `config/emdash-plugin-topology.json:11,668,1083,1554,2170,2571,3128,3690,4504,5053,5759,6442,6997,7616,8073,8599,9137,9566`. Le template non installable `supbrd-plugmod-custom-*` apparaît à `:9997`.

Le comptage exécuté sur le JSON du SHA confirme la cardinalité :

```text
$ git show 35aad4c:config/emdash-plugin-topology.json \
    | jq '{
        all: (.plugins | length),
        concrete: (.plugins
          | map(select(.manifest.plugin_id | contains("*") | not))
          | length),
        installable: (.plugins
          | map(select(
              (.manifest.plugin_id | contains("*") | not)
              and (.manifest.plugin_kind == "full"
                or .worker_descriptor.deployment_status == "ready")
            ))
          | length)
      }'
{
  "all": 19,
  "concrete": 18,
  "installable": 18
}
```

### Activation implicite

`apps/site/superboard-emdash-plugins.mjs:13-54` transforme automatiquement les 18 entrées concrètes en plugins sandboxed configurés. `apps/site/astro.config.mjs:19,31-35` injecte toute cette liste dans l’intégration EmDash au build.

L’absence d’une ligne de données n’empêche pas l’activation. `packages/core/src/emdash-runtime.ts:1427-1433,1515-1521,2586-2607` considère un plugin configuré comme activé lorsque son état est absent ou vaut `active`. Le type persistant ne connaît que `active | inactive` (`packages/core/src/plugins/state.ts:12-34`), et `enable` ou `disable` écrit directement l’un de ces deux états (`:201-213`).

La synchronisation du catalogue fusionne installation et activation. `apps/site/src/lib/superboard-plugin-catalog.ts:76-181` parcourt tous les plugins, écrit leur manifest comme actif, force `_plugin_state.status = 'active'` et publie leur santé `ready`. `loadActiveSuperBoardPluginLock` exige ensuite que la taille de l’ensemble actif soit exactement celle du catalogue (`:192-219`).

Le test runtime confirme ce comportement : `apps/site/runtime-tests/plugin-store-authority.runtime.test.ts:29-69` appelle une seule synchronisation puis exige 18 lignes `_plugin_state` actives, 18 manifests actifs et 18 dépendances `ready`.

```text
$ pnpm --dir apps/site exec vitest run --config vitest.runtime.config.ts \
    runtime-tests/plugin-store-authority.runtime.test.ts
Test Files  1 passed (1)
Tests       10 passed (10)
```

Le succès du test établit que le passage `available → installed → active` n’exige aucune décision de données intermédiaire.

### Remplacements du lifecycle des plugins

1. Séparer la découverte `available` de l’installation et de l’activation dans `superboard-plugin-catalog.ts:64-190`; une synchronisation de catalogue ne doit plus écrire `superboard_active_plugin_manifests`, `_plugin_state.status = 'active'` ni la santé `ready`.
2. Remplacer le modèle `active | inactive` de `packages/core/src/plugins/state.ts:12-34,115-213` par un lifecycle qui représente explicitement catalogue, installation et activation, ou par trois relations persistantes distinctes.
3. Supprimer la règle « absence d’état = activé » dans `packages/core/src/emdash-runtime.ts:1427-1433,1515-1521,2586-2607`. Seul un état actif pour l’Instance et le target doit charger le plugin.
4. Remplacer la liste build-time de `superboard-emdash-plugins.mjs:13-54` et son injection dans `astro.config.mjs:31-35` par le chargement des artefacts installés, puis actifs, résolus par le target.
5. Remplacer l’égalité catalogue = ensemble actif de `loadActiveSuperBoardPluginLock` (`superboard-plugin-catalog.ts:203-219`) par un Plugin Lock issu du sous-ensemble actif exact.

## 5. Autorité des Stores et rôle des Workers métier

**Classification : violé.** Le repository de Stores fournit une base partielle conforme, mais le chemin produit du Front conserve les Workers et leurs D1 comme sources métier réelles.

### Fragment conforme : repository de Stores

Chaque Store déclare son autorité dans `packages/supbrd-core/src/plugin-manifest.ts:9-18`. `apps/site/src/lib/plugin-store-repository.ts:41-173` vérifie le manifest actif et l’autorité, chiffre la charge utile, applique un compare-and-swap de révision et associe l’opération. Les triggers de `apps/site/migrations/0005_plugin_store_authority.sql:33-160` imposent le namespace, l’outbox et l’interdiction de suppression.

`apps/site/runtime-tests/plugin-store-authority.runtime.test.ts:112-176` exerce chiffrement, idempotence, compare-and-swap, outbox et rejet inter-Store. Les 10 tests runtime passent.

### Le repository de Store n’est pas le chemin d’écriture produit

La fonction d’écriture `putPluginStoreRecord` n’a aucun appel de production. La recherche au SHA trouve une définition dans `apps/site/src/lib/plugin-store-repository.ts:41` et neuf appels dans le test runtime :

```text
$ git grep -n 'putPluginStoreRecord' 35aad4c -- apps/site | wc -l
10
$ git grep -n 'putPluginStoreRecord' 35aad4c -- apps/site/src | wc -l
1
```

La data source de plugin lit ces Stores dans `apps/site/src/pages/_superboard/api/plugins/[pluginId]/data-sources/[dataSourceId].ts:15-56`, mais les composants Dashboard montés dans le Front utilisent les API historiques.

### Les mutations sont journalisées puis exécutées par le Worker autoritatif

Les routes `apps/site/src/pages/api/v1/[...path].ts:8-16` et `api/v2/[...path].ts:8-16` transmettent toutes les requêtes au proxy. Les lectures vont directement à `API_SERVICE` (`apps/site/src/lib/operator-api-proxy.ts:61-65`). Pour une mutation, le Site chiffre et insère la requête dans `superboard_plugin_command_operations`, puis appelle quand même `API_SERVICE` et conserve sa réponse (`:86-145`; `plugin-command-authority.ts:40-145`). Cette table est un journal de commande et de réponse ; elle ne met pas à jour `superboard_plugin_store_records`.

Les Workers effectuent encore les écritures métier. Un exemple complet apparaît dans `workers/api/src/routes/links.ts:35-104,119-142`, qui insère, met à jour et supprime directement dans `redirect_configs`, `links` et `custom_redirects` via `c.env.DB`.

La recherche suivante trouve 115 fichiers source Worker hors tests contenant une écriture SQL directe :

```text
$ git grep -l -E 'INSERT INTO|UPDATE [a-zA-Z_]+ SET|DELETE FROM' 35aad4c \
    -- workers/api/src workers/*/src | rg -v '\.(test|spec)\.' | wc -l
115
```

Le test `plugin-store-authority.runtime.test.ts:178-230` appelle cette approche « compatibility mutations » et prouve l’ordre acceptation → exécution → replay. Il ne prouve pas que le Store contient l’état métier après l’exécution.

### Remplacements de l’autorité des Stores

1. Raccorder les commands de chaque manifest à `putPluginStoreRecord` ou à un repository de Store typé équivalent avant toute exécution Worker. Le point de passage actuel `operator-api-proxy.ts:86-145` ne persiste qu’un journal de commande.
2. Remplacer les lectures directes `API_SERVICE` de `operator-api-proxy.ts:61-65` par les data sources des Stores, avec un mode de compatibilité borné uniquement pendant migration.
3. Migrer les écritures directes des routes Worker, dont `workers/api/src/routes/links.ts:35-142`, vers des commands consommant un état déjà autoritatif. Le Worker peut produire un effet ou un callback, mais ne doit plus posséder la ligne métier canonique.
4. Utiliser les leases et callbacks de `plugin-store-repository.ts:380-420` pour rapporter les effets d’exécution sans donner au Worker l’autorité de présentation ou de stockage.
5. Ajouter des tests produit qui créent, lisent, modifient et suppriment une entité par le Front, puis prouvent que le Store est l’unique source et que le Worker peut être reconstruit depuis celle-ci.

## 6. Gateway Manifest et routage effectif

**Classification : violé.** Le catalogue Gateway est descriptif, le manifest de Release est vide et le Worker API reste l’autorité de routage.

### Catalogue nominal sans implémentation spécifique

`config/emdash-plugin-topology.json:2568-2580` déclare `supbrd-plugmod-gateway`. Ses deux Stores sont `rate_limits` et `route_manifests`, et ses commandes de publication, modification et politique apparaissent à `:3003-3033`.

L’entrypoint n’implémente aucun comportement Gateway : `packages/supbrd-runtime-plugins/src/entries/supbrd-plugmod-gateway.ts:1-3` appelle la fabrique commune. Cette fabrique ne fournit que les routes descriptives `admin`, `contract`, `health`, `settings/effective`, `commands/catalog` et `data-sources/catalog` (`packages/supbrd-runtime-plugins/src/runtime.ts:44-87`). Elle n’exécute aucune command Gateway et ne lit aucun Store métier.

Deux data sources sont en outre rattachées au mauvais Store. `active_gateway_manifest` et `gateway_routes` pointent vers `rate_limits` dans `config/emdash-plugin-topology.json:3037-3058`, alors que `route_manifests` existe à `:2704` et son repository à `:3091-3100`.

### Manifest vide et non consommé

`apps/site/src/lib/user-front-release.ts:161-165` compose toujours :

```json
{
  "gateway_manifest": {
    "schema_version": "1.0.0",
    "gateway_manifest_id": "01J00000000000000000000221",
    "routes": []
  }
}
```

Le runtime de Release omet le Gateway Manifest (`packages/supbrd-core/src/front-runtime.ts:4-7`), et `apps/site/src/lib/release-source.ts:168-179` ne transmet que le Front Route Manifest et les dependency policies.

Le Worker API enregistre en revanche ses routes, redirections et middlewares dans `workers/api/src/index.ts:95-145,314-534`. Ses destinations et politiques restent codées dans `workers/api/src/lib/domain-modules.ts:15-73,177-324`.

Les commandes au SHA mesurent le décalage :

```text
$ git show 35aad4c:workers/api/src/index.ts \
    | grep -Ec '^\s*app\.(get|post|put|patch|delete|options|all|route|use)\('
63
$ git grep -l 'gateway_manifest' 35aad4c -- workers/api/src | wc -l
0
```

### Validation Gateway non exécutée

Le contrat `packages/supbrd-core/src/contracts.ts:70-89` décrit méthode, chemin, destination, auth, audience, scopes et timeout. Le compilateur calcule son checksum (`release-compiler.ts:63-80`) mais ne contrôle pas les collisions Gateway. Le contrôle de `assertFrontReleaseInput` porte uniquement sur les routes Front (`:139-178`).

La commande suivante reprend l’input valide du test du compilateur, injecte deux routes Gateway strictement identiques, des transitions Front non résolues et aucun plugin ou renderer, puis compile en mémoire :

```sh
node --input-type=module <<'NODE'
import { readFileSync } from "node:fs";
import { compileFrontRelease } from "./packages/supbrd-core/dist/index.js";

const source = readFileSync("./packages/supbrd-core/tests/release-compiler.test.ts", "utf8");
const start = source.indexOf("function validReleaseInput()");
const end = source.indexOf('\ndescribe("Front Release compiler"', start);
const body = source.slice(start, end);
const states = ["loading", "empty", "forbidden", "not_found", "error", "unavailable", "maintenance"];
const makeInput = new Function("REQUIRED_STATES", `${body}; return validReleaseInput`)(states);
const input = makeInput();
const duplicate = {
	route_id: "gateway.duplicate",
	method: "GET",
	path_pattern: "/duplicate",
	destination: "api",
	auth_policy: "public",
	audience: "public",
	scopes: [],
	timeout_ms: 1000,
};
input.gateway_manifest.routes = [duplicate, { ...duplicate }];
input.front_route_manifest.auth_transitions = {
	login_route_id: "missing.login",
	authenticated_home_route_id: "missing.home",
};
input.plugin_lock = [];
input.renderers = [];
const keys = await crypto.subtle.generateKey(
	{ name: "ECDSA", namedCurve: "P-256" },
	true,
	["sign", "verify"],
);
const release = await compileFrontRelease(input, { kid: "audit", private_key: keys.privateKey });
const receipts = new Map(release.validation_receipts.map(({ layer, status }) => [layer, status]));
console.log(`verification_status=${release.verification_status}`);
console.log(`gateway_routes=${release.payload.gateway_manifest.routes.length}`);
console.log(
	`validation_receipts=${release.validation_receipts.length} ${
		release.validation_receipts.every(({ status }) => status === "passed") ? "passed" : "mixed"
	}`,
);
for (const layer of ["routing", "permissions_security", "plugins_stores_workers", "migrations"]) {
	console.log(`${layer}=${receipts.get(layer)}`);
}
NODE
```

Exécuté avec `node --input-type=module` après le build de `packages/supbrd-core`, ce programme a retourné :

```text
verification_status=verified
gateway_routes=2
validation_receipts=13 passed
routing=passed
permissions_security=passed
plugins_stores_workers=passed
migrations=passed
```

Ce résultat suit directement `release-compiler.ts:237-258`, qui construit chaque receipt avec `status: "passed"`.

### Remplacements du routage Gateway

1. Remplacer l’entrypoint générique `packages/supbrd-runtime-plugins/src/entries/supbrd-plugmod-gateway.ts:1-3` par une implémentation dédiée de ses commands, data sources et Stores.
2. Fermer les schémas Route, Policy et Manifest dans `config/emdash-plugin-topology.json:2815-2955`, corriger les `store_id` à `:3042,3054`, puis ajouter une migration Site corrective.
3. Remplacer `routes: []` dans `apps/site/src/lib/user-front-release.ts:161-165` par la composition déterministe du snapshot Gateway de l’Instance et des plugins actifs.
4. Valider dans `packages/supbrd-core/src/release-compiler.ts` les collisions méthode + chemin, destinations, bindings, scopes, politiques, timeouts et références de Store.
5. Ajouter le Gateway Manifest vérifié à `LastVerifiedFrontRelease` (`front-runtime.ts:4-7`) et à `release-source.ts:168-179`.
6. Remplacer le routage de `workers/api/src/index.ts:314-534` et `workers/api/src/lib/domain-modules.ts:15-73` par un matcher du manifest actif. Les modules existants peuvent rester des adaptateurs de destination métier.
7. Fournir au Gateway un binding vers le manifest actif ou son cache signé dans `scripts/cloudflare-config.mjs:331-392` et `workers/api/src/types.ts:30-98`, sans ajouter une lecture D1 par requête.

## 7. Compilateur de target et parité des environnements

**Classification : violé.** Les chemins development et production partagent plusieurs bibliothèques, mais il n’existe pas un artefact compilé unique qui relie target, ressources, bindings, migrations, plugins et Release pour les trois environnements.

### Fragments conformes pour development et production

Les manifests de target sont fermés et validés par `deploy/targets/schema.json:1-31` et `scripts/cloudflare-target.mjs:30-58`. Les ressources requises selon les features sont contrôlées dans `cloudflare-target.mjs:85-145`. `scripts/cloudflare-bootstrap-core.mjs:53-240` construit l’inventaire physique, et `scripts/cloudflare-d1-registry.mjs:10-153` résout les propriétaires D1 et leurs migrations.

`scripts/cloudflare-config.mjs:230-448` assemble les configs Site/API et `:451-586` les modules. Le plan de déploiement impose les migrations avant le Worker en development et un batch D1 avant tous les Workers en production (`scripts/cloudflare-deploy-plan.mjs:105-175`; `scripts/cloudflare-deploy.mjs:71-129,192-231`). Les 45 tests target/services/deploy passent au SHA.

### `local` n’est pas un target compilable

Le schéma n’autorise que `development` et `production` (`deploy/targets/schema.json:418-425`). `scripts/cloudflare-target.mjs:331-339` rejette explicitement toute autre valeur.

```text
$ node scripts/cloudflare-config.mjs --target mbza-development \
    --environment local --service site --allow-unprovisioned --no-routes --preflight
Error: --environment must be development or production
```

Le Site local utilise à la place `apps/site/wrangler.jsonc:1-27`, un fichier manuel qui déclare D1, R2, KV et Worker Loader. Il ne déclare pas le binding `API_SERVICE` pourtant requis par `apps/site/src/lib/operator-api-proxy.ts:36-39`, ni les contrats secrets du repository de commands. Les configs development et production générées déclarent toutes deux `API_SERVICE` dans `scripts/cloudflare-config.mjs:230-263`.

### Aucun target suivi ne couvre toute la promotion

La commande suivante montre que les deux manifests suivis contiennent chacun un seul environnement :

```text
$ for target in mbza-development vocostar; do
    git show 35aad4c:deploy/targets/$target.json \
      | jq -c --arg target "$target" \
          '{target:$target,environments:(.environments|keys),has_release:has("release")}'
  done
{"target":"mbza-development","environments":["development"],"has_release":false}
{"target":"vocostar","environments":["production"],"has_release":false}
```

`mbza-development` et `vocostar` sont deux targets distincts dont les features peuvent légitimement différer. Leur comparaison ne prouve donc rien sur une divergence causée par l’environnement. Le constat pertinent est l’absence d’un target suivi qui matérialise une même Instance en development puis en production. Combinée au rejet de `local`, cette absence empêche d’exécuter la promotion exigée contre un même graphe logique.

### Parité des migrations non vérifiée

`scripts/cloudflare-d1-schema.test.mjs:38-70` déduplique les descriptors par `migrationsPath`, applique chaque chaîne une fois sur une base SQLite neuve, puis contrôle son intégrité. Le test démontre que chaque propriétaire suivi peut construire isolément un schéma frais valide. Il ne compare ni liste de migrations, ni checksum, ni schéma final entre local, development et production pour une même Instance.

Les 17 tests verts ne constituent donc pas une preuve que les trois environnements utilisent les mêmes migrations. Cette parité reste à intégrer à l’artefact de target et à vérifier avant promotion.

### Le compilateur de Release et le générateur Cloudflare sont disjoints

`FrontReleaseInput` ne contient ni target, ni ressource physique, ni binding, ni état de migration (`packages/supbrd-core/src/contracts.ts:148-175`). `compileFrontRelease` signe ce seul input (`release-compiler.ts:56-90`). Inversement, les scripts Cloudflare n’importent ni `compileFrontRelease`, ni le Gateway Manifest.

Le Plugin Lock perd les données qui permettraient de relier les deux mondes. `apps/site/src/lib/superboard-plugin-catalog.ts:192-219` réduit chaque plugin actif à `plugin_id`, `version`, `artifact_checksum` et `native`; les ressources, migrations, Stores, commands et data sources du manifest ne font pas partie de la résolution target.

`scripts/cloudflare-config.mjs:45-151` effectue la sélection et l’écriture au chargement, puis choisit une fonction de config par une longue branche `service`. Il ne produit pas un artefact canonique et checksumé réutilisé par bootstrap, migration, déploiement et compilation de Release.

### Workflow de Release différent selon l’environnement

Les opérations de Release Front sont limitées au Site development avec route de preview explicite (`scripts/cloudflare-site-preview.mjs:29-41`). Elles sont désactivées dans le Site local (`apps/site/wrangler.jsonc:17-20`) et refusées pour production. `apps/site/src/lib/operator-guard.ts:10-20` retourne `503 RELEASE_OPERATIONS_DISABLED` lorsque le flag n’est pas activé.

Le schéma target est fermé et ne contient aucun champ Release (`deploy/targets/schema.json:6-31`). La config API injecte `SUPERBOARD_RELEASE` depuis l’environnement ou le SHA Git, avec un fallback `local`, dans `scripts/cloudflare-config.mjs:286-293`; cet identifiant n’est pas le Front Release Payload signé et ne relie pas les autres Workers au même artefact.

### Remplacements du compilateur de target

1. Extraire de `scripts/cloudflare-config.mjs:45-151` une fonction pure `compileTarget` qui retourne un artefact canonique et checksumé : target, environnement, Instance, services, ressources, bindings, migrations, plugins actifs et identité de Release.
2. Faire consommer ce même artefact par `cloudflare-bootstrap-core.mjs`, `cloudflare-d1-registry.mjs`, `cloudflare-deploy.mjs:130-136,260-320` et `compileFrontRelease`, au lieu de recalculer des vues séparées.
3. Ajouter `local` au schéma `deploy/targets/schema.json:418-425` et au parser `scripts/cloudflare-target.mjs:331-339`, avec le même graphe logique que development et production.
4. Remplacer `apps/site/wrangler.jsonc:1-27` par une sortie du compilateur de target local. Le binding `API_SERVICE`, les migrations, les KV, R2, secrets contractuels et le Loader doivent provenir du même graphe.
5. Produire les matérialisations local, development et production d’une même Instance depuis un target logique unique ; comparer uniquement ces matérialisations, sans forcer deux targets distincts à partager les mêmes features.
6. Étendre le Plugin Lock de `superboard-plugin-catalog.ts:192-219` avec la résolution des manifests complets et leurs ressources/migrations, ou joindre ces manifests par checksum dans l’artefact target.
7. Définir un workflow de Release commun dans `cloudflare-site-preview.mjs:29-41` et `operator-guard.ts:10-20`. Les gates peuvent différer par environnement, mais compilation, validation, activation et rollback doivent rester le même protocole.
8. Remplacer les receipts synthétiques de `release-compiler.ts:237-258` par des validations du graphe résolu : bindings, ressources, migrations, Stores, Workers, secrets et rollback.

## 8. Preuve d’une Instance vierge reproductible

**Classification : violé.** Le code prouve la création de schémas D1 frais, pas la reproduction d’une Instance complète de local vers development puis production.

### Ce que la preuve actuelle couvre

`scripts/cloudflare-d1-schema.test.mjs:38-70` charge tous les targets suivis, déduplique les propriétaires par chemin de migrations, applique chaque fichier sur une base SQLite neuve, puis vérifie l’intégrité, les clés étrangères et la présence de tables.

Le bloc suivant résume la sortie de la commande ; il regroupe les seize sous-tests sans prétendre reproduire le format TAP brut :

```text
$ node --test scripts/cloudflare-d1-schema.test.mjs
✔ api: workers/api/migrations
✔ site: apps/site/migrations
✔ email, identity, files, custom, app, products, dynamic-links
✔ support, analytics, marketing, flows, paywalls, onboardings
tests 17, pass 17, fail 0
```

Cette commande est une preuve valable de migrations fraîches pour 16 propriétaires D1. Elle ne crée pas une Instance, ne résout pas ses plugins, n’active pas une Release Front, ne provisionne pas les autres ressources, ne transfère pas les valeurs entre environnements et ne compare pas le résultat final.

### Pourquoi la chaîne demandée ne peut pas être exécutée au commit audité

1. `local` est rejeté par `scripts/cloudflare-target.mjs:331-339`, donc le premier environnement ne peut pas passer par le même compilateur.
2. Le fichier local `apps/site/wrangler.jsonc:1-27` ne possède pas `API_SERVICE`. Sur une configuration vierge, `operator-api-proxy.ts:36-39` répond `503 GATEWAY_BRIDGE_UNAVAILABLE` avant toute opération métier.
3. La synchronisation de plugins active les 18 plugins d’un coup (`superboard-plugin-catalog.ts:76-181`) au lieu de reproduire les choix de lifecycle de l’Instance.
4. Aucun target suivi ne relie development et production pour une même Instance, donc aucun graphe logique ne traverse ces deux environnements.
5. Les opérations de Release ne sont disponibles qu’en development (`cloudflare-site-preview.mjs:29-41`).
6. Aucun artefact target ne contient l’identité de la Release, et aucun script ne relie dans une même exécution Instance, plugins, Stores, Gateway, ressources, migrations et activation.

La recherche suivante n’a trouvé aucun orchestrateur sous `scripts`, `apps/site/runtime-tests` ou `e2e` qui enchaîne les trois environnements :

```text
$ git grep -l -E 'local.{0,80}development.{0,80}production|development.{0,80}production.{0,80}local' \
    35aad4c -- scripts apps/site/runtime-tests e2e | wc -l
0
```

Cette recherche n’est pas, seule, une preuve d’absence. Elle complète les impossibilités exécutables ci-dessus : le parser refuse `local`, aucun target suivi ne couvre toute la chaîne et production refuse le workflow de Release.

### Preuve d’arrivée à construire

La preuve d’arrivée doit exercer un seul protocole contre une Instance neuve et un manifest de target sans identifiants préexistants :

1. Compiler le target local et son graphe complet sans modifier un fichier suivi.
2. Provisionner les ressources locales, appliquer toutes les migrations et créer l’Instance.
3. Synchroniser le catalogue, installer un sous-ensemble explicite, puis activer seulement les plugins choisis par les données.
4. Compiler, valider, activer et rendre une Release Front contenant Front Route Manifest, Gateway Manifest, navigation, permissions, renderers et états.
5. Promouvoir le même artefact logique vers development, puis production, en remplaçant uniquement les valeurs de ressources et de secrets.
6. Comparer les checksums canoniques du graphe logique, du Plugin Lock, des manifests, des migrations et de la Release ; exercer aussi le rollback.
7. Exécuter un parcours produit qui lit et écrit par les Stores avec les Workers indisponibles puis disponibles, afin de prouver leur absence d’autorité.

Cette preuve doit remplacer l’assemblage séparé de `apps/site/wrangler.jsonc`, `scripts/cloudflare-config.mjs`, `scripts/cloudflare-d1-registry.mjs`, `scripts/cloudflare-deploy.mjs`, `apps/site/src/lib/superboard-plugin-catalog.ts` et `packages/supbrd-core/src/release-compiler.ts`. Le test D1 frais existant reste utile comme sous-gate de migrations.

## Ordre de remplacement

Les dépendances entre les écarts imposent l’ordre suivant :

1. Rendre le lifecycle des plugins et l’artefact target data-driven. Le Front, le Gateway et les Stores ont besoin du sous-ensemble actif exact.
2. Relier manifests complets, ressources, bindings et migrations au compilateur de Release, puis remplacer les Validation Receipts synthétiques.
3. Faire du Gateway Manifest actif l’autorité de routage et migrer les commands/data sources vers les Stores autoritatifs.
4. Remplacer le registre Front, la navigation et les renderers statiques par la Release active.
5. Retirer tous les imports Dashboard et les shims Next.js du Site.
6. Exécuter la preuve d’Instance vierge local → development → production et conserver ses artefacts canoniques sans valeurs secrètes.

La conformité ne peut pas être déduite des 45 tests target, des 17 tests de schémas frais ou des tests de Release actuels. Les futurs tests d’acceptance doivent échouer si un registre statique redevient autoritatif, si un plugin sans état actif est chargé, si un Worker écrit l’état canonique ou si le graphe logique change entre environnements.
