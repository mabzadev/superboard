# Installation et mises à jour dans Cloudflare

SuperBoard utilise l’autorisation OAuth de Cloudflare pour installer une instance
complète et maintenir ses services. Le navigateur ne demande aucun jeton API.
Le déploiement s’exécute depuis le dépôt canonique avec GitHub Actions : une
installation ne crée pas de copie du dépôt à synchroniser.

## Installer une instance

1. Ouvrez le parcours d’installation depuis GitHub. Cloudflare vous demande de
   vous connecter, de choisir le compte autorisé et d’accepter les permissions.
2. De retour dans SuperBoard, choisissez le compte, un domaine actif, un nom
   d’instance et l’adresse de son administrateur.
3. Choisissez si les publications de `main` doivent mettre à jour cette instance,
   puis cliquez sur **Installer SuperBoard**.
4. Suivez l’exécution dans **Vos installations**. **En attente** signifie que le
   travail est enregistré ; **Installée** apparaît après le déploiement et ses
   contrôles HTTP. Le lien GitHub donne accès aux journaux de l’exécution.
5. Ouvrez SuperBoard et terminez la création du compte administrateur dans le Site.

L’interface existe en français (`?lang=fr`) et en anglais (`?lang=en`).
**Autoriser un autre compte** ouvre un nouveau consentement Cloudflare.
Les installations déjà enregistrées restent visibles pour le même utilisateur.
Un nom et un identifiant propres à chaque installation séparent les Workers,
les bases, les files, les buckets et les sous-domaines. Le provisionnement refuse
de remplacer un Worker ou une route déjà utilisés.

Un domaine actif dans le compte est nécessaire. Les adresses suivent la forme
`instance-identifiant-board.example.com`, avec des adresses distinctes pour
l’API, l’authentification et les liens courts. Aucun domaine privé n’est nécessaire
dans le bouton GitHub. Les quotas et les produits Cloudflare requis doivent être
disponibles dans le compte choisi.

Le déploiement crée les ressources, initialise les clés, applique les migrations
et publie l’ensemble des services. Les fournisseurs externes restent à configurer
selon l’usage : messagerie sortante, boutiques mobiles, paiements ou fournisseurs
d’identité. La supervision des nouvelles instances utilise les observations D1
de l’instance et ne demande pas de jeton Analytics supplémentaire.

## Mises à jour

Le workflow `cloudflare-installations.yml` traite les publications de `main` et
`dev`, les déclenchements manuels et les installations en attente lors de son
passage périodique. GitHub peut retarder les exécutions planifiées.

| Installation                          | Source | Déclenchement                           |
| ------------------------------------- | ------ | --------------------------------------- |
| Développement raccordé                | `dev`  | Publications et vérification périodique |
| Production avec automatisme activé    | `main` | Publications et vérification périodique |
| Production avec automatisme désactivé | `main` | **Mettre à jour maintenant**            |

Décochez **Mises à jour automatiques** pour suspendre les publications futures.
Une mise à jour encore en attente est annulée ; une exécution déjà commencée
termine son déploiement. **Réessayer** reprend une exécution en échec. Si
l’autorisation a expiré ou a été révoquée, reconnectez le compte dans Cloudflare,
puis réessayez. Les secrets initiaux restent disponibles pour reprendre une
première installation partiellement terminée ; ils ne sont pas régénérés.

Le contrôleur associe chaque exécution à un compte, une instance, une branche et
un commit. L’identité OIDC de GitHub doit provenir du workflow canonique sur
`main` ou `dev`. Une exécution issue de `dev` ne peut pas réclamer au contrôleur
un déploiement de production. Chaque instance ne peut avoir qu’un déploiement actif.
Les permissions OAuth restent celles des comptes autorisés dans Cloudflare.
Pour séparer aussi ces permissions, autorisez chaque compte séparément et utilisez
des comptes distincts pour le développement et la production.

## Raccorder le développement existant

L’exploitant du contrôleur configure `INSTALLER_DEVELOPMENT_TARGET` avec un objet
JSON contenant `id` (UUID stable), `accountId` et `target` (le manifeste complet
déjà provisionné). Il ne contient aucun secret de service.
Si cette valeur dépasse 4 000 octets, encodez-la avec `encodeBuildVariables` dans
`scripts/cloudflare/build-variables.mjs` et conservez les variables `__PART_*`
produites avec le marqueur principal. Le contrôleur vérifie leur empreinte avant
de lire le manifeste ; chaque liaison reste sous la limite Cloudflare de 5 Ko.

Après autorisation de ce compte, **Raccorder le développement existant aux mises
à jour de dev** enregistre le manifeste. Le contrôleur vérifie la présence du
Worker Site. L’exécution réutilise les ressources et les secrets existants et
applique uniquement les migrations et déploiements nécessaires. Elle n’exécute
pas l’initialisation d’une nouvelle instance.

Avant ce raccordement, inspectez les anciens déclencheurs Workers Builds pour
éviter deux pipelines actifs sur les mêmes services. Le contrôleur ne supprime
pas les anciennes connexions automatiquement.

## Héberger le contrôleur

Le Worker `infra/cloudflare-installer` conserve le registre et les autorisations
chiffrées dans une base D1 dédiée. Il requiert :

- `INSTALLER_DB`, liaison vers la base avec les migrations du dossier `migrations` ;
- `INSTALLER_ORIGIN`, origine HTTPS exacte du contrôleur ;
- `INSTALLER_SESSION_KEY`, secret de 32 octets aléatoires encodé en base64 ;
- `CLOUDFLARE_OAUTH_CLIENT_ID` et `CLOUDFLARE_OAUTH_SCOPES` ;
- `INSTALLER_RUNNER_ENABLED=1`, après publication et vérification des sources.

Enregistrez un [client OAuth Cloudflare](https://developers.cloudflare.com/fundamentals/oauth/create-an-oauth-client/)
avec les grants `authorization_code` et `refresh_token`, PKCE et l’URI exacte
`https://<origine-du-controleur>/oauth/callback`. Le client public doit avoir son
domaine éditeur vérifié. Les scopes utilisés sont `account-settings.read`,
`user-details.read`, `zone.read`, `dns.write`, `workers-scripts.write`,
`workers-kv-storage.write`, `workers-r2.write`, `workers-routes.write`, `d1.write`,
`queues.write`, `vectorize.write` et `offline_access`.

La session du navigateur utilise un cookie opaque, HttpOnly et Secure. Les
autorisations durables sont chiffrées côté serveur. Le contrôleur renouvelle les
accès OAuth ; il ne crée pas de jeton API de compte. Les runners reçoivent un
accès temporaire limité à l’autorisation Cloudflare de leur installation.
Conservez la clé du contrôleur pour pouvoir déchiffrer son registre sauvegardé.
Se déconnecter de l’interface n’interrompt pas les mises à jour autorisées.
Cloudflare permet de révoquer l’accès dans les applications connectées du profil.

Utilisez une configuration Wrangler privée dans `infra/generated/` pour les
identifiants de ressources. Appliquez ses migrations D1, définissez le secret
avec Wrangler et déployez ce Worker. La variable GitHub
`SUPERBOARD_INSTALLER_ORIGIN` doit correspondre à son origine HTTPS.
Le workflow `installer-launcher.yml` publie la redirection GitHub Pages vers
`/oauth/start`. Activez GitHub Pages avec la source **GitHub Actions**.

`/api/readiness` vérifie la configuration, l’activation du runner et la présence
des sources publiées. Sa réponse ne prouve ni la disponibilité des produits d’un
compte ni la réussite d’une installation.

## Vérifications et reprise

Avant de provisionner, le pipeline construit les packages et le SDK Web, puis
exécute lint, contrats, types, tests locaux et tests d’installation. Il renouvelle
l’accès OAuth après ces contrôles. Un reçu lie les artefacts préparés au compte,
au manifeste et au commit ; le déploiement refuse un reçu incompatible.

En production, les exports D1 sont chiffrés dans un bucket privé et relus pour
vérifier leur intégrité avant les migrations. La clé est conservée dans le
registre chiffré. Les sauvegardes ne sont pas supprimées automatiquement.
Les mises à jour conservent les clés de signature et de chiffrement des services.

Le déploiement de plusieurs Workers n’est pas transactionnel. Une erreur peut
laisser des services déjà mis à jour ; consultez le journal avant de réessayer.
Les contrôles HTTP français et anglais ne remplacent pas la vérification des
parcours métier dans le navigateur.

```sh
pnpm cloudflare:builds:test
pnpm cloudflare:installer:check
```

Les tests OAuth et du registre utilisent SQLite et des API simulées. Ils couvrent
notamment les comptes distincts, le rejeu OAuth, les renouvellements concurrents,
les mises à jour et l’isolation `dev`/production. Une installation vierge et sa
mise à jour doivent aussi être vérifiées avec les API et le navigateur réels.

Les commandes historiques `cloudflare:builds:install` et le protocole API avec
Bearer restent disponibles pour les connexions Workers Builds existantes. Elles
ne constituent pas le parcours du bouton GitHub. Le [bouton natif Cloudflare](https://developers.cloudflare.com/workers/platform/deploy-buttons/)
clone un dépôt et ne déploie pas ensemble tous les Workers de ce monorepo.
