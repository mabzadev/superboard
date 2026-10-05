# Installation et mises à jour dans Cloudflare

Cloudflare Workers Builds exécute les vérifications, prépare les artefacts et
déploie chaque Instance SuperBoard. `dev` alimente `mbza-development` ; les
installations de production suivent `main`. GitHub héberge le code. Les
déploiements n'attendent pas un workflow GitHub Actions.

## Publier l’installateur

L’installateur est un Worker indépendant dans `infra/cloudflare-installer`.
Il propose le choix du compte, du domaine et du jeton Builds, puis lance une
installation dans le compte sélectionné. Son interface existe en français
(`?lang=fr`) et en anglais (`?lang=en`).

Publiez d’abord les sources de cette fonctionnalité dans `main`. Dans le
compte destiné à héberger l’installateur, configurez `CLOUDFLARE_ACCOUNT_ID` et
les accès Wrangler, puis lancez :

```sh
pnpm cloudflare:installer:check
pnpm cloudflare:installer:deploy
```

Ouvrez l’adresse retournée par Wrangler. `pnpm cloudflare:installer:dev`
démarre le même Worker localement avec les API Cloudflare réelles : les
actions d’installation y créent donc de vraies ressources.

## Installer dans un compte supplémentaire

L’autorisation initiale de l’application GitHub de Cloudflare doit donner accès
à `mabzadev/superboard`. Une copie du dépôt n’hérite pas des futurs pushes du
dépôt d’origine. Configurez cette autorisation dans chaque compte avant
d’utiliser l’installateur. Consultez la
[procédure Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/).

Le jeton API de configuration doit être un jeton utilisateur, avec accès aux
comptes concernés, aux domaines et à Workers Builds. Le provisionnement
nécessite aussi les droits de création des Workers, D1, KV, R2, Queues et
Vectorize. Le jeton de déploiement choisi dans Builds doit couvrir tous les
services et ressources de l’instance, ainsi que ses routes ; un jeton limité
au seul Worker Site ne suffit pas.

La supervision de production demande aussi un jeton Cloudflare Analytics
distinct, limité à la lecture du compte. L’installateur le demande séparément
et le transmet au Worker de supervision ; il ne réutilise pas le jeton de
configuration pour les requêtes analytiques.

1. Connectez le compte avec son jeton API.
2. Choisissez un domaine actif, un nom d’instance et l’adresse de
   l’administrateur. Les adresses `board.`, `sdk.`, `api.` et `in.` doivent être
   libres sur ce domaine.
3. Sélectionnez le jeton Builds et l’option de mise à jour automatique.
4. Cliquez sur **Installer dans ce compte**. Suivez le résultat dans Cloudflare
   Builds. L’affichage « installation lancée » confirme l’acceptation du build,
   pas la réussite du déploiement.
5. Utilisez **Ajouter un autre compte** pour une autre installation.

Chaque installation reçoit un identifiant et des noms de ressources propres.
Elle ne nécessite aucune entrée supplémentaire dans le dépôt central. La
configuration est conservée dans les variables Builds de son compte. Le jeton
de configuration et les clés initiales sont des secrets temporaires de Builds ;
leurs copies sont supprimées à la fin d’une installation réussie. En cas
d’échec, ils restent disponibles pour reprendre le build. Révoquez le jeton si
vous abandonnez l’installation. Le navigateur ne conserve aucun jeton.

Le déploiement initialise les ressources et les secrets, applique les migrations
et publie les services. Configurez ensuite les fournisseurs externes nécessaires
à vos usages, par exemple l’envoi d’e-mails et les boutiques mobiles.

## Raccorder une instance existante

`pnpm cloudflare:builds:install` prépare ou applique la connexion aux mises à
jour. Placez un fichier de configuration hors du dépôt. Il contient
`schemaVersion: 1`, `accountId`, `environment`, `automaticUpdates`,
`repoConnectionUuid`, `buildTokenUuid` et `target` (le manifeste complet de
l’instance, avec ses ressources provisionnées). La production demande aussi
`backupBucket`, un bucket R2 privé existant.

Définissez `CLOUDFLARE_API_TOKEN` pour le compte concerné. En production,
conservez et réutilisez `SUPERBOARD_BACKUP_ENCRYPTION_KEY`, une clé de 32 octets
encodée en base64, pour pouvoir restaurer les sauvegardes historiques.

```sh
pnpm cloudflare:builds:install --installation /chemin/prive/instance.json
pnpm cloudflare:builds:install --installation /chemin/prive/instance.json --apply
```

La commande vérifie le Worker Site, détecte les connexions concurrentes,
configure les variables, puis active les pushes sur la branche attendue.
Pour suspendre les mises à jour, réappliquez le fichier avec
`automaticUpdates: false`. La connexion reste disponible pour un build manuel.

Pour migrer Mabza, retirez ses anciennes connexions Builds par service avant
d’enregistrer la connexion par instance sur le Worker Site. L’outil refuse les
connexions concurrentes et ne les supprime pas automatiquement.

## Ordre d’un déploiement

Le build vérifie la branche (`dev` ou `main`), exécute lint, contrats, types et
tests locaux, puis prépare le déploiement. Un reçu lie cette préparation au
commit, au compte et au manifeste. La commande de déploiement refuse une
préparation modifiée ou provenant d’un autre compte.

En production, les exports D1 sont chiffrés et envoyés dans le bucket de
sauvegarde. Chaque objet est relu pour vérifier son intégrité avant les
migrations. Les sauvegardes R2 ne sont pas supprimées par le pipeline ;
configurez leur rétention et conservez la clé de chiffrement. Les mises à jour
réutilisent les secrets déjà installés. Elles ne régénèrent pas les clés de
signature ou de chiffrement.

La première installation garde les pushes automatiques désactivés jusqu’à la
fin du déploiement. Les contrôles HTTP finaux couvrent les réponses du Site en
français et en anglais ; ils ne remplacent pas les parcours métier dans le
navigateur. Une erreur de validation ou de déploiement fait échouer Builds.
Le déploiement de plusieurs Workers n’est pas transactionnel : une erreur peut
laisser des services déjà mis à jour. Consultez le journal avant de relancer.

## Vérification locale

```sh
pnpm cloudflare:builds:test
pnpm cloudflare:installer:check
```

`node tests/fixtures/cloudflare/installer.mjs` sert l’interface sur
`http://127.0.0.1:4768` avec une API Cloudflare simulée. Ce parcours permet de
tester les langues, la sélection des comptes et le lancement sans toucher un
compte distant. Il ne prouve pas qu’une installation réelle est opérationnelle.
