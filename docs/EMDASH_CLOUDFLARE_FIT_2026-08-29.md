# Compatibilité d’EmDash avec la topologie Cloudflare de SuperBoard

> Recherche liée au ticket [Vérifier la compatibilité d’EmDash avec la topologie Cloudflare SuperBoard](https://github.com/mabzadev/superboard/issues/42), enfant de la carte [Migration complète de SuperBoard vers EmDash CMS](https://github.com/mabzadev/superboard/issues/33).
>
> État observé le 29 août 2026. Cette note établit des faits, incompatibilités et prérequis. Elle ne choisit pas l’architecture cible et n’implémente rien.

## Réponse courte

Cloudflare Workers peut techniquement exécuter un Site EmDash à côté des Workers métier de SuperBoard. La release EmDash 0.35.0 se construit avec Astro 7 et passe un dry-run Wrangler comme Worker Cloudflare lié à D1, R2, KV Sessions, Assets, AI Search et Dynamic Worker Loader. Le paquet mesuré reste sous la limite du plan Workers Paid.

En revanche, EmDash n’est pas compatible avec le Dashboard ou le control plane SuperBoard actuels sans changement :

- EmDash est une intégration Astro SSR ; le Dashboard actuel est une application Next.js produisant un Worker OpenNext.
- Le Worker Dashboard actuel ne possède aucun binding D1 EmDash, R2 MEDIA, KV SESSION, Worker Loader ni Cron EmDash.
- Les manifests de cibles, le registre des services, le registre des propriétaires D1, les secrets, le déploiement et les contrôles de santé de SuperBoard ne connaissent aucun service CMS.
- Le mécanisme obligatoire de sauvegarde de production SuperBoard repose sur wrangler d1 export. Cloudflare ne sait pas exporter une base contenant des tables virtuelles, alors qu’EmDash crée des tables FTS5 virtuelles lorsque la recherche d’une collection est activée.
- Le flag global_fetch_strictly_public est actuellement appliqué à tous les Workers SuperBoard. EmDash documente que ce flag bloque le transport interne des D1 Sessions et fait pendre les requêtes lorsque la réplication de lecture est activée.
- Cloudflare limite à quatre le nombre de Dynamic Workers distincts simultanément actifs dans une requête Worker. EmDash 0.35.0 lance en parallèle tous les hooks différés des plugins sandboxés, sans borne à quatre.
- Le Tail Worker SuperBoard peut observer le Worker hôte EmDash, mais le runner EmDash n’attache pas de tail aux Dynamic Workers. Les appels ctx.log repassent par le bridge hôte ; les console.log, exceptions et métadonnées propres à l’isolate dynamique ne sont pas automatiquement collectés.

La conclusion factuelle est donc : **compatibilité de plateforme conditionnelle, incompatibilité de contrôle et d’exploitation en l’état**. Aucun basculement, même en développement, n’est prêt avant la levée des prérequis listés dans cette note.

## Références immuables examinées

| Élément | Référence épinglée | Observation |
| --- | --- | --- |
| SuperBoard | commit [d1850233e97b79c3cde7eae18a0123d4d39c8ae2](https://github.com/mabzadev/superboard/commit/d1850233e97b79c3cde7eae18a0123d4d39c8ae2) | Point de départ imposé à cette recherche. |
| EmDash publié | tag emdash@0.35.0, commit [3c99225d80a38a9751ed0e4b56e3924e40308e70](https://github.com/emdash-cms/emdash/commit/3c99225d80a38a9751ed0e4b56e3924e40308e70) | Dernière release trouvée dans le clone complet ; base reproductible utilisée pour les mesures de paquet. |
| EmDash main | commit [1717d31b351164a5f78e95fe004ee582c7c50f40](https://github.com/emdash-cms/emdash/commit/1717d31b351164a5f78e95fe004ee582c7c50f40) | État du dépôt le 28 août 2026, soixante commits après 0.35.0. Utilisé uniquement pour vérifier les évolutions déjà présentes en amont. |

Le dépôt EmDash a été cloné sans shallow clone et avec récursion des submodules. Aucun submodule n’était déclaré. Le dépôt se décrit lui-même comme une beta preview ; une migration ne doit donc pas confondre la branche main, qui affiche toujours 0.35.0 dans ses manifests, avec l’artefact immuable de la release 0.35.0. Sources : [README EmDash 0.35.0](https://github.com/emdash-cms/emdash/blob/3c99225d80a38a9751ed0e4b56e3924e40308e70/README.md), [package core 0.35.0](https://github.com/emdash-cms/emdash/blob/3c99225d80a38a9751ed0e4b56e3924e40308e70/packages/core/package.json), [package Cloudflare 0.35.0](https://github.com/emdash-cms/emdash/blob/3c99225d80a38a9751ed0e4b56e3924e40308e70/packages/cloudflare/package.json).

La release fixe le socle de démonstration Cloudflare à Astro 7.0.0, @astrojs/cloudflare 14.0.0, React 19.2.4, Wrangler 4.124.0, pnpm 11.9.0 et Node 22.16 au minimum. SuperBoard utilise npm, Next 16.3, React 18.3 et Wrangler 4.120.0 dans son Dashboard, tandis que ses workflows sélectionnent Node 22. Il n’y a pas d’incompatibilité de version Node démontrée, mais il existe deux graphes de build et deux versions de Wrangler à unifier ou à isoler explicitement. Sources : [workspace EmDash](https://github.com/emdash-cms/emdash/blob/3c99225d80a38a9751ed0e4b56e3924e40308e70/pnpm-workspace.yaml), [package du Dashboard](https://github.com/mabzadev/superboard/blob/d1850233e97b79c3cde7eae18a0123d4d39c8ae2/apps/dashboard/package.json), [workflow Cloudflare](https://github.com/mabzadev/superboard/blob/d1850233e97b79c3cde7eae18a0123d4d39c8ae2/.github/workflows/deploy-cloudflare.yml).

## Topologie SuperBoard constatée

SuperBoard est un monorepo canonique pilotant plusieurs cibles Cloudflare depuis des manifests déclaratifs. Le développement mbza-development et la production vocostar peuvent vivre dans des comptes Cloudflare différents ; chaque compte est sélectionné à l’exécution et les identifiants de compte ne sont pas committés. Sources : [README SuperBoard](https://github.com/mabzadev/superboard/blob/d1850233e97b79c3cde7eae18a0123d4d39c8ae2/README.md), [cible mbza-development](https://github.com/mabzadev/superboard/blob/d1850233e97b79c3cde7eae18a0123d4d39c8ae2/deploy/targets/mbza-development.json), [cible vocostar](https://github.com/mabzadev/superboard/blob/d1850233e97b79c3cde7eae18a0123d4d39c8ae2/deploy/targets/vocostar.json).

Les manifests nomment dix-sept Workers de plateforme ou de domaine par cible ; VocoStar déclare en plus deux Workers managés d’orchestration. Certaines fonctionnalités sont désactivées selon la cible, de sorte que ce nombre est un plafond déclaratif et non le nombre exact d’instances actives. Cette topologie est très en dessous de la limite actuelle de 500 Workers par compte Paid. Les Dynamic Workers chargés par EmDash ne sont pas des scripts statiques supplémentaires de ce catalogue, mais ils ont leur propre facturation et leur propre limite de concurrence. Sources : [registre de services SuperBoard](https://github.com/mabzadev/superboard/blob/d1850233e97b79c3cde7eae18a0123d4d39c8ae2/scripts/cloudflare-services.mjs), [limites Workers](https://developers.cloudflare.com/workers/platform/limits/), [tarification Dynamic Workers](https://developers.cloudflare.com/dynamic-workers/pricing/).

Le générateur de configuration SuperBoard applique actuellement à chaque service :

- la date de compatibilité 2026-08-08 ;
- nodejs_compat et global_fetch_strictly_public ;
- workers.dev et les preview URLs désactivés ;
- Workers Logs à 100 %, traces à 10 % ;
- un Tail Worker observability pour tous les services sauf le Tail Worker lui-même.

Le Dashboard est ensuite une exception de build : le point d’entrée est apps/dashboard/.open-next/worker.js, les assets viennent de .open-next/assets, le cache incrémental Next est un bucket R2 NEXT_INC_CACHE_R2_BUCKET, et le Worker possède un service binding vers lui-même. Il ne possède ni D1, ni R2 MEDIA, ni KV SESSION, ni Worker Loader, ni Cron. Source : [générateur Cloudflare SuperBoard](https://github.com/mabzadev/superboard/blob/d1850233e97b79c3cde7eae18a0123d4d39c8ae2/scripts/cloudflare-config.mjs).

Les domaines du Dashboard sont des Custom Domains exacts : board.mbza.dev en développement et grow.vocostar.com en production. Les autres Workers communiquent largement par Service bindings et possèdent chacun leurs ressources D1, R2, KV, Queues, Durable Objects, Workflows ou Analytics Engine selon leur rôle. Les migrations D1 sont attribuées à un seul propriétaire de schéma et sont des fichiers SQL ordonnés. Sources : [cible mbza-development](https://github.com/mabzadev/superboard/blob/d1850233e97b79c3cde7eae18a0123d4d39c8ae2/deploy/targets/mbza-development.json), [cible vocostar](https://github.com/mabzadev/superboard/blob/d1850233e97b79c3cde7eae18a0123d4d39c8ae2/deploy/targets/vocostar.json), [registre D1](https://github.com/mabzadev/superboard/blob/d1850233e97b79c3cde7eae18a0123d4d39c8ae2/scripts/cloudflare-d1-registry.mjs).

## Forme Cloudflare d’EmDash constatée

EmDash n’est pas une bibliothèque CMS agnostique du framework à injecter dans Next.js. C’est une intégration Astro qui ajoute au Site Astro l’administration, les routes API, l’authentification, les migrations et le runtime de plugins. Le démonstrateur Cloudflare est en output server et utilise l’adapter Cloudflare. Sources : [README EmDash](https://github.com/emdash-cms/emdash/blob/3c99225d80a38a9751ed0e4b56e3924e40308e70/README.md), [configuration Astro du démonstrateur](https://github.com/emdash-cms/emdash/blob/3c99225d80a38a9751ed0e4b56e3924e40308e70/demos/cloudflare/astro.config.mjs).

Le Worker officiel lie :

| Binding ou capacité | Rôle observé | Caractère |
| --- | --- | --- |
| D1 DB | Tables internes, collections, utilisateurs, plugins et contenu | Requis par la configuration Cloudflare examinée |
| R2 MEDIA | Binaire des médias | Requis par la configuration examinée |
| KV SESSION | Sessions Astro | Ajouté automatiquement par l’adapter Cloudflare |
| Assets | Assets Astro compilés | Ajouté par l’adapter |
| Worker Loader LOADER | Dynamic Workers des plugins sandboxés | Requis si les plugins sandboxés sont utilisés |
| PluginBridge exporté | RPC contrôlé entre isolates et Worker hôte | Requis avec LOADER |
| Cron | Publication planifiée, tâches plugins et maintenance | Un cron général sur main ; deux crons dans la release 0.35.0 du démonstrateur |
| Observability | Logs du Worker hôte | Activé dans le démonstrateur |
| KV CACHE | Cache objet D1 | Optionnel et distinct de SESSION |
| AI_SEARCH et Images | Recherche IA et transformations média | Options du démonstrateur, pas minimum universel du CMS |

Sources : [Wrangler EmDash 0.35.0](https://github.com/emdash-cms/emdash/blob/3c99225d80a38a9751ed0e4b56e3924e40308e70/demos/cloudflare/wrangler.jsonc), [entrypoint Worker](https://github.com/emdash-cms/emdash/blob/3c99225d80a38a9751ed0e4b56e3924e40308e70/demos/cloudflare/src/worker.ts), [déploiement Cloudflare EmDash](https://github.com/emdash-cms/emdash/blob/3c99225d80a38a9751ed0e4b56e3924e40308e70/docs/src/content/docs/deployment/cloudflare.mdx), [adapter Astro Cloudflare](https://docs.astro.build/en/guides/integrations-guide/cloudflare/).

Le bucket NEXT_INC_CACHE_R2_BUCKET du Dashboard OpenNext ne remplit donc pas le rôle de MEDIA. De même, le KV général du Worker API SuperBoard n’est pas automatiquement le KV SESSION du Site Astro. Accepter l’auto-provisionnement de SESSION par Wrangler contournerait le manifeste de cible et ses identités immuables ; le resource binding doit être explicitement modélisé ou son auto-provisionnement explicitement enregistré par le control plane. Cloudflare prend désormais en charge l’auto-provisionnement de D1, R2 et KV lorsqu’un binding n’a pas d’identifiant, mais cela ne remplace pas les règles de gouvernance propres à SuperBoard. Sources : [provisionnement automatique Cloudflare](https://developers.cloudflare.com/changelog/post/2025-10-24-automatic-resource-provisioning/), [adapter Astro Cloudflare](https://docs.astro.build/en/guides/integrations-guide/cloudflare/), [frontières de configuration SuperBoard](https://github.com/mabzadev/superboard/blob/d1850233e97b79c3cde7eae18a0123d4d39c8ae2/docs/CONFIGURATION_BOUNDARIES.md).

## Matrice de compatibilité

| Sujet | Fait vérifié | État |
| --- | --- | --- |
| Runtime SSR | Astro Cloudflare produit un Worker ES modules valide ; le dry-run de la release passe. | Compatible |
| Dashboard actuel | Le build et l’entrypoint sont Next/OpenNext, pas Astro. | Incompatible sans remplacement ou surface distincte |
| D1 | EmDash fournit un adapter D1 et un workflow de migrations. | Compatible sous nouvelles ressources et nouveau control plane |
| R2 | EmDash fournit un adapter R2 natif. | Compatible ; ressource et politique média à déclarer |
| KV | Astro utilise KV pour SESSION ; EmDash peut utiliser un second KV pour CACHE. | Compatible ; identités absentes aujourd’hui |
| Plugins sandboxés | Worker Loader et bridge fonctionnent dans le modèle Cloudflare. | Compatible sous Workers Paid, avec limites de concurrence et observabilité à traiter |
| Workers for Platforms | Le code officiel utilise worker_loaders, pas dispatch_namespaces. | Non requis par la forme EmDash examinée |
| Service bindings | Un Site Astro Worker peut recevoir des bindings vers les Workers SuperBoard du même compte. | Compatible sous même compte et contrats explicites |
| Appels depuis plugin sandboxé | ctx.http utilise globalThis.fetch vers des hôtes HTTP autorisés, pas un binding SuperBoard privé. | Lacune fonctionnelle pour tout contrat privé attendu |
| Routage | Custom Domains, Routes et versions permettent une coexistence orchestrée. | Compatible, mais aucun plan de propriété de route n’existe |
| Local | D1, R2, KV et Service bindings ont des simulations locales ; la preuve complète LOADER du démo n’est pas locale et autonome. | Partiellement prouvé |
| Migrations | EmDash peut générer un manifest, appliquer et vérifier avant trafic. | Compatible en principe, non intégré au registre SQL SuperBoard |
| Sauvegarde | L’export obligatoire SuperBoard échoue sur les bases avec FTS5 virtuel. | Bloquant |
| D1 read replicas | EmDash les prend en charge avec Sessions. | Bloqué par le flag SuperBoard si le mode session est activé |
| Observabilité hôte | Workers Logs, traces et Tail Worker sont disponibles. | Compatible |
| Observabilité isolates | Aucun tail attaché par le runner EmDash 0.35.0. | Incomplète |
| Déploiement multi-cible | Astro 6+ exige un build par environnement ; SuperBoard construit déjà le Dashboard par cible. | Compatible après remplacement du build |
| Rollback | Les versions Worker se restaurent, mais pas l’état D1, R2 ou KV. | Preuve de rollback données toujours requise |

## Incompatibilités et contraintes détaillées

### 1. Astro face à OpenNext

Le script de déploiement SuperBoard génère une configuration Dashboard, exécute opennextjs-cloudflare build, puis déploie apps/dashboard/.open-next/worker.js. EmDash demande Astro, @astrojs/cloudflare, @astrojs/react et son intégration emdash/astro. Les deux outputs n’ont ni le même entrypoint, ni les mêmes assets, ni les mêmes bindings générés. Sources : [déploiement SuperBoard](https://github.com/mabzadev/superboard/blob/d1850233e97b79c3cde7eae18a0123d4d39c8ae2/scripts/cloudflare-deploy.mjs), [configuration OpenNext](https://github.com/mabzadev/superboard/blob/d1850233e97b79c3cde7eae18a0123d4d39c8ae2/apps/dashboard/open-next.config.ts), [configuration EmDash](https://github.com/emdash-cms/emdash/blob/3c99225d80a38a9751ed0e4b56e3924e40308e70/demos/cloudflare/astro.config.mjs).

Fait de frontière : le runtime Cloudflare n’empêche pas de déployer le paquet Astro. En revanche, aucune preuve ne permet de considérer EmDash comme une intégration directement ajoutable au bundle Next actuel. Que le Site Astro remplace le service Dashboard, soit déployé comme service transitoire, ou soit placé derrière un Worker d’aiguillage est une décision d’architecture ultérieure.

Astro 6 et suivants déterminent l’environnement Cloudflare pendant le build. Chaque cible doit donc exécuter son propre build avant déploiement. Cette contrainte correspond au principe SuperBoard d’un code canonique et de builds dérivés des manifests, mais la commande actuelle est spécifique à OpenNext. Source : [adapter Astro Cloudflare, changement des environnements](https://docs.astro.build/en/guides/integrations-guide/cloudflare/).

### 2. Resources D1, R2 et KV absentes

Ni le schéma deploy/targets/schema.json, ni mbza-development, ni vocostar ne déclarent un CMS, un D1 EmDash, un bucket MEDIA EmDash, un KV SESSION ou un KV CACHE EmDash. Le registre des services refuse tout service extérieur à sa liste, et le registre D1 refuse tout propriétaire extérieur à sa liste. Sources : [schéma de cible](https://github.com/mabzadev/superboard/blob/d1850233e97b79c3cde7eae18a0123d4d39c8ae2/deploy/targets/schema.json), [registre de services](https://github.com/mabzadev/superboard/blob/d1850233e97b79c3cde7eae18a0123d4d39c8ae2/scripts/cloudflare-services.mjs), [registre D1](https://github.com/mabzadev/superboard/blob/d1850233e97b79c3cde7eae18a0123d4d39c8ae2/scripts/cloudflare-d1-registry.mjs).

La D1 d’EmDash contient à la fois l’administration, l’authentification, le modèle de contenu, le contenu et le stockage logique des plugins. Le bridge sandboxé accède directement à DB et MEDIA du Worker hôte. Il n’est pas possible de remplacer ce D1 par une liste de Service bindings vers les D1 métiers existantes sans réécrire l’adapter et le bridge. Sources : [runner sandbox](https://github.com/emdash-cms/emdash/blob/3c99225d80a38a9751ed0e4b56e3924e40308e70/packages/cloudflare/src/sandbox/runner.ts), [bridge sandbox](https://github.com/emdash-cms/emdash/blob/3c99225d80a38a9751ed0e4b56e3924e40308e70/packages/cloudflare/src/sandbox/bridge.ts).

L’adapter R2 natif ne fournit pas d’URL signée ; les uploads passent par le Worker. EmDash fixe par défaut son upload maximal à 50 MiB. Les manifests SuperBoard fixent 10 MiB en développement et 50 MiB en production pour le service Files, mais cette règle ne s’applique pas automatiquement au Site EmDash. La politique média du CMS doit donc être explicitement alignée. Sources : [stockage EmDash](https://github.com/emdash-cms/emdash/blob/3c99225d80a38a9751ed0e4b56e3924e40308e70/docs/src/content/docs/deployment/storage.mdx), [configuration EmDash](https://github.com/emdash-cms/emdash/blob/3c99225d80a38a9751ed0e4b56e3924e40308e70/docs/src/content/docs/reference/configuration.mdx), [cibles SuperBoard](https://github.com/mabzadev/superboard/tree/d1850233e97b79c3cde7eae18a0123d4d39c8ae2/deploy/targets).

### 3. D1 Sessions et global_fetch_strictly_public

Le mode D1 session d’EmDash est désactivé par défaut, mais son démonstrateur Cloudflare utilise session auto pour les read replicas. EmDash documente qu’avec global_fetch_strictly_public, la requête interne des D1 Sessions est bloquée et peut rester suspendue jusqu’à l’arrêt du Worker. Le code courant contient un garde de cinq secondes qui abandonne la session et revient au binding direct, mais ce fallback ne transforme pas cette combinaison en configuration saine ou en preuve de réplication. Sources : [documentation Cloudflare EmDash](https://github.com/emdash-cms/emdash/blob/3c99225d80a38a9751ed0e4b56e3924e40308e70/docs/src/content/docs/deployment/cloudflare.mdx), [adapter D1 EmDash](https://github.com/emdash-cms/emdash/blob/3c99225d80a38a9751ed0e4b56e3924e40308e70/packages/cloudflare/src/db/d1.ts), [garde de session](https://github.com/emdash-cms/emdash/blob/3c99225d80a38a9751ed0e4b56e3924e40308e70/packages/cloudflare/src/db/d1-session-guard.ts).

Cloudflare confirme que la réplication de lecture exige D1 Sessions et que les sessions fournissent la cohérence séquentielle par bookmarks. Cloudflare décrit par ailleurs global_fetch_strictly_public comme un routage de fetch par la porte publique de la zone. Sources : [réplication D1](https://developers.cloudflare.com/d1/best-practices/read-replication/), [flags Workers](https://developers.cloudflare.com/workers/configuration/compatibility-flags/).

Conséquence factuelle : la fonction baseConfig de SuperBoard ne peut pas être réutilisée sans décision pour un EmDash qui active D1 Sessions. Les deux états possibles à étudier plus tard sont une politique de flags différente pour le CMS ou des sessions D1 désactivées ; cette note ne choisit pas.

### 4. Dynamic Workers, plans, facturation et concurrence

Le Worker Loader est devenu la primitive Dynamic Workers de Cloudflare. Il permet de composer un isolate à l’exécution, de contrôler ses bindings, son accès réseau et ses limites. Il est actuellement disponible uniquement avec Workers Paid. Workers Paid est un abonnement distinct du plan de zone Cloudflare et commence à 5 USD par compte et par mois. Puisque les cibles SuperBoard peuvent appartenir à des comptes distincts, chaque compte exécutant les plugins sandboxés doit avoir l’entitlement. Sources : [Dynamic Workers](https://developers.cloudflare.com/dynamic-workers/), [tarification Dynamic Workers](https://developers.cloudflare.com/dynamic-workers/pricing/), [tarification Workers](https://developers.cloudflare.com/workers/platform/pricing/), [cibles SuperBoard](https://github.com/mabzadev/superboard/blob/d1850233e97b79c3cde7eae18a0123d4d39c8ae2/README.md).

Au 29 août 2026 :

- 1 000 Dynamic Workers uniques par mois sont inclus ;
- l’excédent est facturé 0,002 USD par Dynamic Worker et par jour ;
- les appels RPC et fetch comptent comme requêtes Worker ;
- le CPU de démarrage et le CPU d’exécution sont facturés ;
- un même identifiant et le même code réutilisés avec get comptent une fois par jour ;
- un même identifiant avec un code différent compte comme une nouvelle création.

EmDash utilise l’identifiant plugin-id:version avec loader.get, puis invoque les hooks et routes par RPC. Cette forme est cohérente avec la réutilisation facturable de Cloudflare, à condition que les versions de plugin identifient réellement leur code. Sources : [runner EmDash](https://github.com/emdash-cms/emdash/blob/3c99225d80a38a9751ed0e4b56e3924e40308e70/packages/cloudflare/src/sandbox/runner.ts), [tarification Dynamic Workers](https://developers.cloudflare.com/dynamic-workers/pricing/).

Cloudflare limite à quatre le nombre de Dynamic Workers distincts ayant des requêtes simultanément en vol dans le contexte d’une requête Worker. EmDash exécute séquentiellement les hooks beforeSave, beforeDelete et page:metadata, mais construit un tableau de promesses puis appelle Promise.allSettled pour afterSave, afterDelete et plusieurs hooks différés. Plus de quatre plugins distincts actifs sur un tel événement peuvent donc atteindre la limite de plateforme. Sources : [limites Dynamic Workers](https://developers.cloudflare.com/dynamic-workers/platform/limits/), [orchestration de hooks EmDash](https://github.com/emdash-cms/emdash/blob/3c99225d80a38a9751ed0e4b56e3924e40308e70/packages/core/src/emdash-runtime.ts).

EmDash fixe par défaut des limites plus basses par plugin : 50 ms CPU, dix subrequests et trente secondes de wall time. Cloudflare sait appliquer CPU et subrequests ; la wall time est imposée par Promise.race dans EmDash. La mémoire déclarée de 128 MiB n’est pas configurable par isolate dans le runner. Source : [runner EmDash](https://github.com/emdash-cms/emdash/blob/3c99225d80a38a9751ed0e4b56e3924e40308e70/packages/cloudflare/src/sandbox/runner.ts), [limites personnalisées Dynamic Workers](https://developers.cloudflare.com/dynamic-workers/usage/limits/).

Workers for Platforms n’est pas utilisé par le démonstrateur ou le runner EmDash : aucun dispatch namespace n’est déclaré. Il n’est donc pas un prérequis constaté. Il deviendrait pertinent uniquement si une décision ultérieure transformait SuperBoard en plateforme déployant des Workers clients persistants via des namespaces, ce qui dépasse cette enquête. Sources : [fonctionnement de Workers for Platforms](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/how-workers-for-platforms-works/), [Wrangler EmDash](https://github.com/emdash-cms/emdash/blob/3c99225d80a38a9751ed0e4b56e3924e40308e70/demos/cloudflare/wrangler.jsonc).

### 5. Service bindings et Workers métier

Les Service bindings peuvent relier le Worker Astro à l’API et aux autres Workers SuperBoard sans URL publique. Le Worker cible doit se trouver dans le même compte Cloudflare. Une requête peut traverser au maximum trente-deux invocations Worker ; chaque appel de binding compte aussi comme subrequest. Le Worker cible doit être déployé avant le Worker appelant. Sources : [Service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/), [ordre de déploiement SuperBoard](https://github.com/mabzadev/superboard/blob/d1850233e97b79c3cde7eae18a0123d4d39c8ae2/scripts/cloudflare-deploy-plan.mjs).

Cloudflare Access ne propage pas automatiquement son contexte ctx.access dans un Service binding. Le Worker aval ne doit donc pas considérer l’appel comme authentifié sans contrat explicite. Source : [Service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/).

Le bridge sandbox d’EmDash n’expose pas les Service bindings arbitraires du Worker hôte. Son ctx.http vérifie une capability réseau, une liste d’hôtes et les redirections, puis utilise globalThis.fetch. Les plugins sandboxés peuvent donc appeler un endpoint public autorisé, mais pas invoquer directement API_SERVICE, FILES_SERVICE ou un autre binding privé SuperBoard avec l’API actuelle. Cloudflare permet techniquement d’exposer des custom bindings aux Dynamic Workers, mais EmDash devrait être étendu pour cela. Sources : [HTTP bridge EmDash](https://github.com/emdash-cms/emdash/blob/3c99225d80a38a9751ed0e4b56e3924e40308e70/packages/cloudflare/src/sandbox/bridge-http.ts), [bindings Dynamic Workers](https://developers.cloudflare.com/dynamic-workers/usage/bindings/).

### 6. Routes, domaines et coexistence

Un Custom Domain est l’origine Worker de tous les chemins d’un hostname exact. Le Dashboard SuperBoard possède déjà ce rôle sur board.mbza.dev et grow.vocostar.com. Une Route plus spécifique peut s’exécuter devant un Worker Custom Domain et appeler ensuite l’origine par fetch. Cloudflare choisit la route la plus spécifique lorsqu’il existe plusieurs patterns. Sources : [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), [Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/).

Ces primitives rendent une coexistence technique possible, mais aucun état actuel de SuperBoard ne déclare :

- un hostname de prévisualisation EmDash ;
- un Worker CMS ;
- une propriété séparée des chemins /_emdash ;
- un aiguillage entre OpenNext et Astro ;
- un reçu liant la parité à un changement de route.

Le gate public-routing de SuperBoard protège les hostnames actuels ; le nouveau propriétaire et la séquence de transfert devront y être ajoutés avant toute mutation. Sources : [gate de routage](https://github.com/mabzadev/superboard/blob/d1850233e97b79c3cde7eae18a0123d4d39c8ae2/scripts/public-routing-gate.mjs), [plan de domaines](https://github.com/mabzadev/superboard/blob/d1850233e97b79c3cde7eae18a0123d4d39c8ae2/scripts/cloudflare-domain-plan.mjs).

Cloudflare conserve des versions complètes du code, des assets, bindings et réglages du Worker. Un déploiement peut contenir deux versions et partager progressivement le trafic. Pour des assets hashés, la version affinity est nécessaire afin d’éviter qu’un HTML d’une version demande un asset uniquement présent dans l’autre. Sources : [versions et déploiements](https://developers.cloudflare.com/workers/versions-and-deployments/), [version affinity](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/version-affinity/).

Un rollback Worker ne restaure pas les données D1, R2 ou KV, et peut être refusé si une ressource attendue a été supprimée. La preuve de rollback exigée par la carte doit donc couvrir séparément le routage, le code, les sessions, les médias et la base. Source : [rollbacks Workers](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

### 7. Migrations et sauvegardes

EmDash sépare les migrations internes du CMS de l’évolution des collections. Un build Astro génère .emdash/migrations.json avec la version, l’ordre des migrations et l’exécuteur. La CLI peut afficher le statut, appliquer avec un fingerprint de cible, puis vérifier. Sur D1, EmDash demande de sérialiser les jobs par compte et UUID de base, car D1 ne fournit pas de verrou consultatif de migration. Le runtime auto-migre par défaut ; les modes check et manual permettent de déplacer la mutation dans le déploiement. Source : [migrations core EmDash](https://github.com/emdash-cms/emdash/blob/3c99225d80a38a9751ed0e4b56e3924e40308e70/docs/src/content/docs/deployment/core-migrations.mdx).

Ce modèle peut respecter l’intention du gate SuperBoard, mais son format n’est pas celui que SuperBoard exécute aujourd’hui. SuperBoard :

- ne reconnaît que des fichiers SQL nommés et triés dans un migrations_dir ;
- interroge wrangler d1 migrations list ;
- exporte chaque base avant la première écriture ;
- applique wrangler d1 migrations apply ;
- vérifie un reçu de lot avant de déployer les Workers.

Sources : [registre D1](https://github.com/mabzadev/superboard/blob/d1850233e97b79c3cde7eae18a0123d4d39c8ae2/scripts/cloudflare-d1-registry.mjs), [convergence D1](https://github.com/mabzadev/superboard/blob/d1850233e97b79c3cde7eae18a0123d4d39c8ae2/scripts/cloudflare-d1-converge.mjs), [workflow de production](https://github.com/mabzadev/superboard/blob/d1850233e97b79c3cde7eae18a0123d4d39c8ae2/.github/workflows/deploy-cloudflare.yml).

L’incompatibilité la plus dure est la sauvegarde. La fonction SuperBoard appelle wrangler d1 export sur toute base propriétaire de schéma avant migration, refuse skip-backup en production, chiffre ensuite les exports et conserve les artefacts. Cloudflare indique que l’export n’est pas supporté pour une base contenant des tables virtuelles. EmDash active la recherche SQLite avec des tables CREATE VIRTUAL TABLE ... USING fts5 pour les collections recherchables. Sources : [backup SuperBoard](https://github.com/mabzadev/superboard/blob/d1850233e97b79c3cde7eae18a0123d4d39c8ae2/scripts/cloudflare-d1-backup.mjs), [déploiement SuperBoard](https://github.com/mabzadev/superboard/blob/d1850233e97b79c3cde7eae18a0123d4d39c8ae2/scripts/cloudflare-deploy.mjs), [export D1](https://developers.cloudflare.com/d1/best-practices/import-export-data/), [FTS EmDash](https://github.com/emdash-cms/emdash/blob/3c99225d80a38a9751ed0e4b56e3924e40308e70/packages/core/src/search/fts-manager.ts).

Cette incompatibilité apparaît dès qu’au moins une collection EmDash possède un index FTS5 ; elle ne doit pas être supposée sur une base fraîche sans recherche. Elle empêche néanmoins de considérer le pipeline complet comme compatible, car la recherche fait partie des capacités normales d’EmDash.

D1 Time Travel est toujours activé et permet un retour à la minute jusqu’à trente jours sur Workers Paid, contre sept jours sur Free. La restauration écrase la base en place et annule les requêtes en vol. Cette capacité est une ressource de récupération, pas une équivalence automatique à l’export chiffré et hors compte exigé aujourd’hui par SuperBoard. Sources : [Time Travel D1](https://developers.cloudflare.com/d1/reference/time-travel/), [limites D1](https://developers.cloudflare.com/d1/platform/limits/).

### 8. Développement local

Cloudflare simule localement D1, R2, KV et les Service bindings dans workerd/Miniflare. Les ressources locales sont vides au départ et sont persistées par défaut sous .wrangler/state ; elles n’accèdent pas aux données de production sauf binding remote explicite. Plusieurs Workers peuvent être démarrés ensemble avec plusieurs fichiers de configuration ou séparément et reliés par Service bindings. Sources : [données locales](https://developers.cloudflare.com/workers/local-development/local-data/), [multi-Workers local](https://developers.cloudflare.com/workers/local-development/multi-workers/), [support des bindings](https://developers.cloudflare.com/workers/local-development/bindings-per-env/).

La matrice Cloudflare courante ne liste pas Dynamic Worker Loaders parmi les bindings simulés localement ou reliés à distance. Le démonstrateur EmDash complet inclut en plus AI Search et des capacités média qui nécessitent une connexion distante. Lors de cette enquête, astro preview sur la release a demandé de sélectionner un compte pour établir une remote proxy session ; l’opération a été annulée avant tout accès distant. Il n’existe donc pas ici de preuve que la totalité du sandbox plugin peut être testée hors ligne.

Le dépôt EmDash fournit des pages manuelles sandbox-test et sandbox-plugin-test, mais aucun test automatisé trouvé n’exécute un vrai Worker Loader Cloudflare dans le pipeline de la release ; les tests unitaires du runner utilisent des mocks. Sources : [page sandbox simple](https://github.com/emdash-cms/emdash/blob/3c99225d80a38a9751ed0e4b56e3924e40308e70/demos/cloudflare/src/pages/sandbox-test.astro), [page sandbox complète](https://github.com/emdash-cms/emdash/blob/3c99225d80a38a9751ed0e4b56e3924e40308e70/demos/cloudflare/src/pages/sandbox-plugin-test.astro), [tests Cloudflare EmDash](https://github.com/emdash-cms/emdash/tree/3c99225d80a38a9751ed0e4b56e3924e40308e70/packages/cloudflare/tests).

Prérequis factuel : la migration doit posséder deux niveaux de preuve distincts, un environnement local déterministe pour D1/R2/KV et Workers métier, puis une acceptance sur le compte mbza-development pour LOADER et toute capacité non simulée.

### 9. Observabilité

Le Worker hôte EmDash peut recevoir exactement les réglages de Workers Logs, traces et tail_consumers déjà générés par SuperBoard. Workers Logs sur Paid conserve au maximum sept jours, avec vingt millions d’événements inclus par mois ; la taille maximale d’un log est 256 Ko. Les métriques Worker sont consultables jusqu’à trois mois. Les traces sont encore en beta le 29 août 2026 et leur facturation doit commencer le 1er octobre 2026. Sources : [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/), [métriques](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/), [traces](https://developers.cloudflare.com/workers/observability/traces/).

Les Dynamic Workers sont des contexts séparés. Cloudflare exige de leur attacher un Tail Worker dans la propriété tails pour conserver leurs console.log, exceptions et métadonnées. Activer observability sur le loader ne capture que le loader. Le runner EmDash 0.35.0 construit ses isolates avec modules, globalOutbound, limits et env, mais sans tails. Son API ctx.log appelle le PluginBridge, qui écrit avec console dans le Worker hôte ; ce chemin contrôlé est visible, contrairement aux logs directs de l’isolate. Sources : [observabilité Dynamic Workers](https://developers.cloudflare.com/dynamic-workers/usage/observability/), [runner EmDash](https://github.com/emdash-cms/emdash/blob/3c99225d80a38a9751ed0e4b56e3924e40308e70/packages/cloudflare/src/sandbox/runner.ts), [bridge EmDash](https://github.com/emdash-cms/emdash/blob/3c99225d80a38a9751ed0e4b56e3924e40308e70/packages/cloudflare/src/sandbox/bridge.ts).

Le Worker observability de SuperBoard est un Tail Worker Paid et peut rester le collecteur du host. Il ne devient pas automatiquement le tail de chaque plugin dynamique ; une adaptation et une preuve de corrélation plugin, version, cible, requête et release sont nécessaires.

## Limites et coûts à inscrire dans le gate

Les chiffres suivants proviennent de la documentation Cloudflare courante au 29 août 2026. Ils ne constituent pas une estimation de facture SuperBoard.

| Produit | Limite ou inclusion courante | Incidence vérifiable |
| --- | --- | --- |
| Workers Paid | Minimum 5 USD par compte/mois ; 10 M requêtes et 30 M ms CPU inclus | Requis par Dynamic Workers sur chaque compte cible |
| Worker | 10 MiB gzip Paid, 128 MiB mémoire, 500 Workers, 250 Cron Triggers | Le paquet EmDash mesuré tient ; mémoire runtime non mesurée |
| Worker | 10 000 subrequests Paid, 32 invocations Worker par requête | Borne les graphes de Service bindings et plugins |
| Dynamic Workers | 1 000 uniques/mois inclus, puis 0,002 USD par Worker/jour | Dépend du nombre de plugins et versions effectivement invoqués |
| Dynamic Workers | 4 isolates distincts simultanés par requête Worker | Conflit possible avec le fan-out parallèle des hooks EmDash |
| D1 Paid | 50 000 DB par compte, 10 Go par DB, 1 To par compte | Nombre de DB non bloquant ; 10 Go par Site est une borne dure |
| D1 Paid | 1 000 requêtes DB par invocation, ligne/BLOB 2 Mo, 100 colonnes/table | À vérifier contre les contenus Portable Text et collections réels |
| D1 Paid | 30 jours Time Travel | Retour base possible, destructif et non hors compte |
| R2 | 5 Tio par objet, 5 Gio en upload simple, 4,995 Tio multipart | EmDash limite par défaut à 50 Mio avant ces plafonds |
| R2 Standard | 10 Go-mois, 1 M opérations A et 10 M opérations B inclus | À mesurer sur les médias et leur lecture |
| KV Paid | valeur 25 Mio, 1 écriture/s sur une même clé | Sessions/cache possibles ; hotspots d’invalidation à tester |
| KV Paid | 10 M lectures, 1 M écritures, 1 Go inclus par mois | SESSION et CACHE ont des profils séparés |
| Routes | 1 000 routes/zone, 100 Custom Domains/zone | Pas de pression quantitative constatée |

Sources : [limites Workers](https://developers.cloudflare.com/workers/platform/limits/), [tarification Workers](https://developers.cloudflare.com/workers/platform/pricing/), [tarification Dynamic Workers](https://developers.cloudflare.com/dynamic-workers/pricing/), [limites Dynamic Workers](https://developers.cloudflare.com/dynamic-workers/platform/limits/), [limites D1](https://developers.cloudflare.com/d1/platform/limits/), [tarification D1](https://developers.cloudflare.com/d1/platform/pricing/), [limites R2](https://developers.cloudflare.com/r2/platform/limits/), [tarification R2](https://developers.cloudflare.com/r2/pricing/), [limites KV](https://developers.cloudflare.com/kv/platform/limits/), [tarification KV](https://developers.cloudflare.com/kv/platform/pricing/).

Le plafond de corps de requête dépend du plan de zone et non du plan Workers : 100 Mo sur Free/Pro, 200 Mo sur Business et 500 Mo par défaut sur Enterprise. Le maximum EmDash de 50 MiB reste sous le plus petit plafond documenté, mais la politique SuperBoard de développement à 10 MiB n’est pas automatiquement respectée. Source : [limites Workers](https://developers.cloudflare.com/workers/platform/limits/).

## Mesures reproductibles effectuées

Les commandes suivantes ont été exécutées dans un worktree détaché du clone complet EmDash au commit de release 3c99225d80a38a9751ed0e4b56e3924e40308e70 :

1. pnpm install --frozen-lockfile
2. pnpm --filter @emdash-cms/demo-cloudflare build:all
3. pnpm exec wrangler deploy --dry-run --outdir /tmp/emdash-dry-run-release-0.35.0-20260829

Environnement de mesure : Node 26.7.0, pnpm 11.9.0 et Wrangler 4.124.0 issu du lock EmDash.

Résultat release 0.35.0 :

- installation réussie, avec avertissement de dépendance workspace cyclique entre auth-atproto et core ;
- build source et build Astro réussis ;
- avertissements présents : export handleSchemaCollectionReorder manquant pendant le build du package core, imports virtuels laissés externes pendant le build du package Cloudflare, imports dynamiques inefficaces et chunks client supérieurs à 500 Ko ;
- dry-run Wrangler réussi ;
- 426 modules Worker ;
- 10 179,63 KiB upload total, 2 551,09 KiB gzip ;
- 66 fichiers assets ;
- bindings générés : SESSION, DB, AI_SEARCH, MEDIA, ASSETS et LOADER.

Le même contrôle au HEAD 1717d31b351164a5f78e95fe004ee582c7c50f40 a produit 437 modules, 10 598,23 KiB total et 2 675,75 KiB gzip. Les deux paquets sont sous la limite Paid de 10 MiB gzip ; la release ne rentrerait pas sous la limite Free de 3 MiB avec une marge suffisante pour la migration, et Dynamic Workers impose Paid de toute façon.

Le build réussi n’est pas une preuve de comportement fonctionnel ou de charge. Les avertissements empêchent de qualifier la construction source de propre. La mesure prouve seulement que le bundle officiel est accepté par le dry-run de son Wrangler épinglé et respecte les limites statiques mesurables.

## Prérequis bloquants avant le gate d’architecture

Les éléments suivants doivent devenir des décisions ou preuves séparées ; ils ne sont pas des tâches de construction autorisées par ce ticket de recherche.

1. **Épingler la source EmDash.** Choisir explicitement entre l’artefact publié 0.35.0 à 3c99225d… et un commit post-release. Interdire main, latest et un simple numéro 0.35.0 construit depuis un checkout différent comme identité de release.
2. **Modéliser le CMS dans le control plane.** Ajouter un service ou un remplacement de service reconnu par les manifests, le schéma, la liste de déploiement, les checks, les types, les secrets et les moniteurs. La forme exacte reste à décider.
3. **Déclarer chaque ressource par cible.** D1 DB, R2 MEDIA, KV SESSION, Worker Loader, Cron et EMDASH_ENCRYPTION_KEY sont le minimum observé avec plugins sandboxés. KV CACHE, AI_SEARCH, Images, Email et OAuth sont conditionnels. Aucun auto-provisionnement silencieux ne doit échapper à l’inventaire cible.
4. **Vérifier Workers Paid sur chaque compte.** mbza-development et chaque cible de production utilisant LOADER doivent être éligibles et budgétées. Le code ne peut pas prouver cet entitlement.
5. **Remplacer ou isoler le build OpenNext.** Produire l’artefact Astro par cible avec une version de Wrangler éprouvée, sans supposer que .open-next et dist/server sont interchangeables.
6. **Intégrer les migrations EmDash.** Conserver ensemble artefact et .emdash/migrations.json, sérialiser par compte/UUID, appliquer avec fingerprint, vérifier avant trafic et faire reconnaître le résultat par le reçu de déploiement SuperBoard.
7. **Résoudre la sauvegarde FTS5.** Fournir un mécanisme vérifié pour sauvegarder et restaurer une D1 EmDash avec tables virtuelles tout en conservant les garanties de chiffrement, rétention hors checkout et reçu. wrangler d1 export seul ne satisfait pas ce besoin.
8. **Fixer la politique D1 Sessions.** Prouver soit le fonctionnement sans global_fetch_strictly_public pour le Site, soit le fonctionnement avec sessions désactivées. Ne pas déployer session auto avec le baseConfig actuel.
9. **Borner les hooks sandboxés.** Prouver le comportement avec plus de quatre plugins concernés, puis imposer une stratégie qui respecte la limite Cloudflare. Le fan-out actuel ne constitue pas cette preuve.
10. **Définir les contrats vers les Workers métier.** Lister les appels qui utilisent une URL publique, un Service binding du host ou une nouvelle capability bridge. Respecter la contrainte de même compte et ne pas compter sur la propagation de Cloudflare Access.
11. **Compléter l’observabilité.** Relier le Worker hôte au collecteur SuperBoard et décider si les logs/exceptions directs des Dynamic Workers doivent être tailés. Ajouter corrélation et tests d’alerte.
12. **Prouver local puis mbza-development.** Séparer les tests locaux D1/R2/KV/multi-Workers de l’acceptance distante LOADER, sans accès implicite aux données de production.
13. **Créer le plan de route et rollback.** Définir qui possède le Custom Domain à chaque phase, comment les assets restent affines, comment l’ancienne version est rappelée, et comment les mutations D1/R2/KV sont récupérées indépendamment du code.
14. **Mesurer la capacité réelle.** Taille D1 projetée, taille maximale d’une entrée, nombre de champs, volume médias, fréquence KV, nombre de plugins, fan-out et CPU/mémoire du SSR. Les limites de plateforme seules ne prouvent pas la marge en charge.

## Faits encore inconnus

Cette enquête ne prétend pas connaître :

- le plan Workers réellement actif sur les comptes mbza-development et vocostar ;
- le nombre, la taille et la localisation des ressources Cloudflare déjà provisionnées hors manifests ;
- le volume final du contenu et des médias après migration ;
- le nombre de plugins sandboxés simultanément actifs ;
- la charge CPU et mémoire du Front SuperBoard rendu par EmDash ;
- la stratégie d’authentification finale entre EmDash, Identity et les SDK ;
- la stratégie de propriété du domaine pendant le cutover ;
- la solution de sauvegarde FTS5 ou de restauration hors compte ;
- la parité fonctionnelle et visuelle du Dashboard.

Ces inconnues ne contredisent pas les faits établis. Elles interdisent simplement de qualifier la migration de prête à construire ou à basculer.

## Conclusion

Le socle Cloudflare est assez riche pour héberger EmDash : Worker Astro SSR, D1, R2, KV, Service bindings, Dynamic Workers, routes, versions et observabilité existent et le bundle publié passe le dry-run. Le nombre actuel de Workers SuperBoard et la taille du bundle EmDash ne saturent pas les limites Paid.

Le chemin n’est cependant pas une substitution de package dans apps/dashboard. Il faut intégrer un runtime Astro et un nouveau jeu de ressources dans le control plane, traiter deux incompatibilités de production — sauvegarde D1 avec FTS5 et D1 Sessions face à global_fetch_strictly_public —, borner les Dynamic Workers, compléter leurs logs et construire une preuve de route et de rollback qui inclut les données.

La décision d’architecture peut partir de ces contraintes. Elle ne doit considérer aucune de ces incompatibilités comme déjà résolue.
