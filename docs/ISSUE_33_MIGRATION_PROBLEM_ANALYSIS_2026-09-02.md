# Issue #33 — analyse du problème de migration vers EmDash

- Date de l’analyse : 2 septembre 2026
- Ticket : [#33 — Migration complète de SuperBoard vers EmDash CMS](https://github.com/mabzadev/superboard/issues/33)
- Commit vérifié : [`d58b49306e63db4fffc73d6e3c115dd4d5d05154`](https://github.com/mabzadev/superboard/commit/d58b49306e63db4fffc73d6e3c115dd4d5d05154)
- Périmètre : ticket et commentaires GitHub, événements de fermeture et réouverture, code et tests au commit vérifié, historique Git local

## Nature du ticket

Le ticket #33 n’est pas le signalement d’une erreur isolée. Il porte la migration complète de SuperBoard depuis son architecture historique vers un Site EmDash unique. Le résultat demandé réunit EmDash Admin, le Front SuperBoard, les données autoritatives, les plugins, les Workers métier, les API et les SDK dans un modèle qui peut être déployé progressivement puis revenir en arrière sans perte de données ni rupture de contrat. Le Dashboard historique doit disparaître seulement après la preuve de parité, de sauvegarde, de restauration et de rollback. [Le corps du ticket fixe cette destination et ces contraintes](https://github.com/mabzadev/superboard/issues/33).

Le problème concret est donc un écart entre deux architectures :

- l’architecture historique contient une application Dashboard Next.js, des routes et composants connus par le code, des Workers qui portent encore des comportements métier et plusieurs autorités de données ;
- l’architecture cible exige que le Site EmDash possède la présentation et les données autoritatives, que la Release Front active sélectionne les routes, Views, menus et renderers, et que les Workers métier restent des exécuteurs transitoires.

Le ticket reste ouvert tant que le second modèle n’est pas le seul modèle actif, reproductible et prouvé en production. Le ticket #64 a reconfirmé que les commentaires, labels, états fermés et commits annoncés ne suffisent pas : le code courant et un comportement exécutable sont les seules preuves admises. [#64, résolution](https://github.com/mabzadev/superboard/issues/64#issuecomment-5492202982).

## Comportement attendu

Les décisions liées à #33 imposent les invariants suivants :

1. Le Front final est natif EmDash et n’a aucune dépendance runtime à `apps/dashboard` ou à Next.js.
2. La Release Front active et les manifests de plugins fournissent toutes les routes, Views, pages, layouts, menus, permissions, renderers et états.
3. Les 18 plugins concrets suivent un lifecycle piloté par les données de l’Instance et du target, avec des états distincts tels que `available`, `installed` et `active`.
4. Les Stores de plugins sont les seules autorités d’écriture durable. Les Workers métier exécutent les commandes sans posséder la présentation ni les données autoritatives.
5. Le Gateway exécute le Gateway Manifest actif. Aucune route ou politique ne reste cachée dans le code du Worker API.
6. Local, development et production utilisent le même compilateur de target, le même graphe de ressources, les mêmes migrations et le même workflow de release. Seules les valeurs de ressources et les secrets diffèrent.
7. Une Instance vierge doit pouvoir suivre le chemin local → development → production sans modification manuelle du code ou de la configuration.
8. La production doit être sauvegardée, migrée, comparée, basculée par paliers, observée au moins 30 jours et encore restaurable avant le retrait du Dashboard.

Ces invariants viennent de la [résolution de #64](https://github.com/mabzadev/superboard/issues/64#issuecomment-5492202982) et des critères de production de [#56](https://github.com/mabzadev/superboard/issues/56).

## État vérifié au commit `d58b4930`

Le dépôt contient une partie substantielle de la cible : chargement et vérification d’une Release Front depuis D1 avec fallback KV vérifié, compilation et signature, projection de navigation, Views EmDash, repository de Stores, migrations et tests. Les trois suites ciblées du Site exécutées pendant cette analyse passent avec 14 tests, et le test du renderer Dashboard passe avec 4 tests.

Ces résultats ne terminent pas #33. Trois violations de l’architecture cible sont directement visibles au commit courant, et la bascule production reste à faire.

### Le Site embarque encore le Dashboard historique et Next.js

`NativeFrontApp` importe directement `DashboardViewRenderer` depuis `apps/dashboard`, puis le monte pour les chemins reconnus par le Dashboard. [Source au commit vérifié](https://github.com/mabzadev/superboard/blob/d58b49306e63db4fffc73d6e3c115dd4d5d05154/apps/site/src/components/NativeFrontApp.tsx#L9-L46).

La configuration Astro du Site définit `apps/dashboard/src` comme source, remplace `next/navigation`, `next/link`, `next/image` et `next/dynamic` par des adaptateurs, puis redirige plusieurs familles d’imports vers le Dashboard. [Source au commit vérifié](https://github.com/mabzadev/superboard/blob/d58b49306e63db4fffc73d6e3c115dd4d5d05154/apps/site/astro.config.mjs#L27-L87).

Le Front peut donc être construit par Astro, mais son bundle runtime incorpore toujours l’application historique et des contrats Next.js. Le nom `NativeFrontApp` et la présence de Views EmDash ne changent pas cette dépendance observable.

### Le choix du composant réel reste codé par chemin

`DashboardViewRenderer` importe les pages et composants historiques puis déclare `ANALYTICS_KINDS` et `VIEW_FACTORIES`, une table qui associe chaque chemin connu à un composant React. [Imports et registres](https://github.com/mabzadev/superboard/blob/d58b49306e63db4fffc73d6e3c115dd4d5d05154/apps/dashboard/src/emdash/DashboardViewRenderer.tsx#L5-L169). `renderView()` choisit ensuite le composant à partir de ces deux tables. [Résolution du composant](https://github.com/mabzadev/superboard/blob/d58b49306e63db4fffc73d6e3c115dd4d5d05154/apps/dashboard/src/emdash/DashboardViewRenderer.tsx#L231-L243).

La Release et la View EmDash contrôlent une partie du graphe, des libellés et des bindings. Elles ne fournissent pas le composant métier final : le chemin doit encore exister dans le registre TypeScript. Une nouvelle View ou un nouveau renderer métier ne peut donc pas devenir une interface réelle uniquement par une modification de Release ou de manifest.

Le dernier commentaire de #66 confirme l’origine de cet état : le premier passage laissait 70 Views vides, puis le correctif `d58b4930` a monté « les vrais composants React déjà utilisés par le dashboard ». [#66, commentaire final](https://github.com/mabzadev/superboard/issues/66#issuecomment-5499003396). Le code confirme cette affirmation, mais contredit l’invariant de #64 qui interdit la dépendance runtime au Dashboard.

### La découverte des plugins entraîne encore leur activation

La configuration du Site parcourt la topologie suivie dans Git et transforme chaque Plugin full EmDash ou Plugin module dont le Worker est `ready` en plugin sandboxed configuré au build. [Configuration des plugins](https://github.com/mabzadev/superboard/blob/d58b49306e63db4fffc73d6e3c115dd4d5d05154/apps/site/superboard-emdash-plugins.mjs#L13-L54).

La synchronisation du catalogue écrit ensuite chaque plugin dans `_plugin_state` avec `status = 'active'` et remet aussi à `active` une ligne existante. [Synchronisation du catalogue](https://github.com/mabzadev/superboard/blob/d58b49306e63db4fffc73d6e3c115dd4d5d05154/apps/site/src/lib/superboard-plugin-catalog.ts#L78-L182).

Le runtime EmDash active par défaut un plugin configuré lorsqu’aucune ligne d’état n’existe, ou lorsque son état vaut `active`. [Activation par défaut](https://github.com/mabzadev/superboard/blob/d58b49306e63db4fffc73d6e3c115dd4d5d05154/packages/core/src/emdash-runtime.ts#L1427-L1433). Le modèle persistant ne représente que `active` et `inactive`. [Type d’état](https://github.com/mabzadev/superboard/blob/d58b49306e63db4fffc73d6e3c115dd4d5d05154/packages/core/src/plugins/state.ts#L12-L18).

La topologie, l’installation et l’activation restent donc confondues. Le lifecycle `available → installed → active` demandé par #64 n’existe pas dans ce chemin exécutable.

### La production n’a pas été basculée

Le commentaire d’avancement de #33 indique qu’aucune mutation production n’a été réalisée pendant le rehearsal development. [#33, avancement du rehearsal](https://github.com/mabzadev/superboard/issues/33#issuecomment-5468039824). Le ticket #56 reste ouvert avec le label `ready-for-human`. Il exige encore l’accès et les approbations production, une preuve de restauration de D1 avec FTS5, R2, KV et sessions, la bascule progressive, un rollback exercé et une observation réelle d’au moins 30 jours avant le retrait du Dashboard. [#56, état et prérequis](https://github.com/mabzadev/superboard/issues/56#issuecomment-5468039053).

Les tickets #51 à #55 sont également ouverts au moment de cette analyse. Leur timeline GitHub montre une fermeture initiale puis une réouverture le 31 août 2026. Le commentaire ancien de #33 qui les présente comme terminés ne décrit donc pas leur état courant : [#51](https://github.com/mabzadev/superboard/issues/51), [#52](https://github.com/mabzadev/superboard/issues/52), [#53](https://github.com/mabzadev/superboard/issues/53), [#54](https://github.com/mabzadev/superboard/issues/54), [#55](https://github.com/mabzadev/superboard/issues/55).

## Scénarios de reproduction

### Vérifier la dépendance au Dashboard

Depuis le commit vérifié, recherchez les imports et alias historiques :

```sh
rg -n 'dashboard/src|dashboard-compat|next/(link|image|navigation|dynamic)' \
  apps/site/src apps/site/astro.config.mjs apps/site/tsconfig.json
```

La commande trouve l’import direct de `DashboardViewRenderer`, les adaptateurs Next et les alias vers `apps/dashboard/src`. Le comportement actuel est un Site Astro qui compile ces dépendances. Le comportement attendu est une absence complète de ces correspondances dans le runtime du Front.

### Ajouter une View sans modifier le registre TypeScript

1. Ajoutez un chemin et un renderer valides au Front Draft, au manifest de plugin et à la collection `Views`.
2. Compilez et activez la Release sans modifier `DashboardViewRenderer.tsx`.
3. Ouvrez le nouveau chemin.

Le routeur et la navigation peuvent reconnaître la nouvelle entrée, mais `isDashboardViewPath()` et `renderView()` ne peuvent monter un composant métier absent de `ANALYTICS_KINDS` et `VIEW_FACTORIES`. Le résultat attendu est que l’artefact renderer verrouillé par la Release suffise, sans modification d’un registre central.

### Synchroniser un catalogue sans activer un plugin

1. Laissez un plugin concret et `ready` dans `config/emdash-plugin-topology.json`.
2. Exécutez la synchronisation du catalogue pour une Instance vierge.
3. Lisez `_plugin_state`.

Le code courant insère le plugin directement avec `status = 'active'`. Même sans ligne d’état, le runtime le considère actif. Le résultat attendu est une progression explicite et persistée de `available` vers `installed`, puis vers `active` seulement après les gates et l’activation de target.

### Vérifier la fin opérationnelle du ticket

Une reproduction complète part d’une Instance vierge, exécute le même workflow en local, development et production, migre les données sans divergence, bascule le trafic avec rollback puis observe la production pendant 30 jours. Ce scénario ne peut pas être reproduit à l’état courant : #56 documente les prérequis production encore absents et le Dashboard historique n’est pas retiré.

## Cause racine

La cause racine confirmée est une migration par couches dont la couche de compatibilité est encore utilisée comme implémentation finale. La Release Front, les Views et les manifests existent, mais les composants produit restent dans `apps/dashboard` et sont sélectionnés par un registre de chemins. Le correctif `d58b4930` a résolu les Views vides en réutilisant ces composants, ce qui restaure la parité visible pour les 71 chemins connus sans satisfaire l’indépendance runtime demandée.

Le second mécanisme est la réutilisation du modèle EmDash `active | inactive` pour un lifecycle SuperBoard plus riche. La configuration au build, la synchronisation du catalogue et l’activation par défaut transforment encore la présence d’un plugin en activation. Tant que découverte, installation, activation, drain, quarantaine et purge ne sont pas des transitions distinctes, la Release et les données de target ne gouvernent pas seules le runtime.

Les écarts sur les Stores, le Gateway et la reproductibilité des targets ont été établis au commit `35aad4cb` par l’audit #65. [Rapport versionné](https://github.com/mabzadev/superboard/blob/35aad4cb2fbe164e754ca55a67f79d9cb2ec1441/docs/ISSUE_65_EMDASH_ARCHITECTURE_COMPLIANCE_AUDIT_2026-09-01.md) et [résultat de #65](https://github.com/mabzadev/superboard/issues/65#issuecomment-5492504851). Les commits #66 postérieurs portent sur le Front et les Views ; cette analyse ne considère pas les autres écarts de #65 comme corrigés sans une nouvelle preuve exécutable au commit courant.

## Impacts

- Le Dashboard historique ne peut pas être supprimé : le Site compile ses composants.
- Une Release ne constitue pas encore l’autorité exclusive de la présentation : elle sélectionne des identifiants dont l’implémentation réelle reste associée à un chemin dans le code.
- Un plugin présent dans la topologie peut être activé sans transition explicite de lifecycle.
- Les tests verts prouvent la compatibilité des 71 chemins connus et la cohérence des fixtures. Ils ne prouvent pas l’absence de dépendance historique ni l’ajout d’un renderer inconnu sans modification du Core.
- Une clôture prématurée exposerait la production à un retrait du Dashboard avant la preuve de restauration, de rollback et d’observation exigée.

## Critères d’acceptation restants

Le ticket #33 peut être considéré terminé lorsque le code et les preuves exécutables démontrent ensemble les résultats suivants :

- `apps/site` ne compile aucun fichier de `apps/dashboard` et ne contient aucun alias ou adaptateur Next utilisé par le Front ;
- les renderers métier appartiennent à leurs plugins, sont résolus depuis le Plugin Lock et les manifests de la Release active, et peuvent être ajoutés ou retirés sans modifier un registre central de chemins ;
- le lifecycle des 18 plugins est persistant, data-driven et distinct de leur présence dans la topologie ;
- les Stores de plugins reçoivent les écritures autoritatives avant toute exécution Worker, et le Gateway applique uniquement le Gateway Manifest actif ;
- une Instance vierge utilise le même compilateur et le même graphe en local, development et production ;
- toutes les lignes `required` de la Parity Matrix possèdent une preuve exécutable et les contrats API, JavaScript, React Native, Flutter et FlutterFlow restent compatibles ;
- les sauvegardes et restaurations D1 avec FTS5, R2, KV et sessions sont exercées, puis le cutover production, le rollback et l’observation de 30 jours sont documentés ;
- le Dashboard historique, ses routes et ses autorités d’écriture sont retirés seulement après ces preuves.

## Vérifications exécutées

```text
$ pnpm --dir apps/site exec vitest run --config vitest.config.ts \
    tests/native-front-presentation.test.ts \
    tests/native-front-views-seed.test.ts \
    tests/superboard-views-bootstrap.test.ts
3 fichiers, 14 tests passés

$ pnpm --dir apps/dashboard exec vitest run \
    src/emdash/__tests__/DashboardViewRenderer.test.tsx
1 fichier, 4 tests passés
```

Les deux commandes signalent que `node_modules` ne correspond pas entièrement au lockfile courant. `pnpm lint:json` reste bloqué avant l’analyse par la configuration Oxlint absente sous `sdks/flows/upstream/product/icons`; le même blocage est déjà consigné dans l’audit #65. Les fichiers produit n’ont pas été modifiés par cette analyse.
