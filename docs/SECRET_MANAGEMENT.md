# Gestion des secrets SuperBoard

## Décision d'architecture

Chaque couple `cible/environnement` possède un graphe de secrets indépendant.
Une valeur de développement MBZA ne doit jamais être réutilisée par VocoStar,
et deux applications de production ne doivent jamais partager leurs clés, même
si elles utilisent exactement les mêmes Workers SuperBoard.

Le dépôt public contient uniquement :

- les noms autorisés et obligatoires ;
- les relations entre producteurs et consommateurs ;
- la provenance attendue ;
- la procédure de rotation ;
- les identifiants non secrets des ressources Cloudflare.

Les valeurs résident dans le gestionnaire de secrets approuvé et dans les
secrets chiffrés des Workers Cloudflare. Elles ne résident ni dans Git, ni dans
les manifests de cible, ni dans FlutterFlow, ni dans une variable publique du
Dashboard.

## Plan exécutable et sans valeur

La commande suivante génère le contrat exact de la cible :

```bash
npm run cloudflare:secrets:plan -- --target vocostar
```

La sortie JSON de schéma 2 contient :

- `services` : l'allowlist complète des noms acceptés par Worker ;
- `required` : les noms strictement nécessaires à cette cible ;
- `coordination.contracts` : les valeurs qui doivent être identiques entre
  plusieurs Workers, les valeurs locales et les valeurs fournies par un tiers ;
- `values_included: false` : garantie qu'aucune valeur n'a été lue ou affichée.

Le plan échoue si un binding obligatoire n'appartient pas exactement à un
contrat de coordination. Une nouvelle feature ou un nouveau secret ne peut donc
pas être ajouté silencieusement sans propriétaire ni stratégie de rotation.

## Contrats communs

| Contrat logique                         | Bindings recevant la même valeur                                           | Rôle                                                                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `module-internal-token`                 | API `MODULE_INTERNAL_TOKEN` + `INTERNAL_API_TOKEN` de chaque module activé | Authentifie les appels privés API vers App, Products, Paywalls, Dynamic Links, Support, Marketing et Onboardings.                          |
| `email-internal-token`                  | API, Email, Identity et Marketing                                          | Authentifie la création d'e-mails transactionnels et la délégation privée du transport SMTP Marketing.                                     |
| `files-internal-token`                  | Identity et Files                                                          | Autorise Identity à publier ou lire les artefacts privés nécessaires aux parcours d'identité.                                              |
| `observability-internal-token`          | API et Observability                                                       | Autorise Grow à agréger l'état des Workers et des jobs sans exposer Observability publiquement.                                            |
| `custom-worker-internal-token`          | API et Custom Worker de la cible                                           | Authentifie les jobs propres à l'application sans rendre le Custom Worker public.                                                          |
| `billing-credential-keyring`            | API et Billing                                                             | Chiffre et déchiffre les copies de credentials Apple/Google. Le format keyring versionné est obligatoire pour toute nouvelle installation. |
| `billing-credential-active-version`     | API et Billing                                                             | Désigne la version d'écriture active du keyring.                                                                                           |
| `purchases-signing-keyset`              | Autorité d'exécution Billing ; API également en mode local                 | Signe les informations d'abonnement consommées par les SDK.                                                                                |
| `apple-root-certificates`               | Autorité d'exécution Billing ; API également en mode local                 | Matériel de confiance public téléchargé et vérifié par empreinte.                                                                          |
| `entitlement-webhook-secret`            | Autorité d'exécution + destinataires externes configurés                   | Signe les webhooks d'entitlements. Sa rotation doit inclure chaque destinataire.                                                           |
| `managed-worker-gateway-callback-token` | Orchestrateurs applicatifs + binding déclaré du gateway externe            | Authentifie les callbacks de progression/notification. Le bundle reste bloqué sans confirmation explicite du peer externe.                 |

Les contrats partagés sont propres à une cible. Par exemple,
`vocostar/production/module-internal-token` et
`mbza-development/development/module-internal-token` sont deux valeurs
différentes.

## Contrats propres à une application

Le protocole Custom Worker isole les fonctionnalités qui ne sont pas communes à
toutes les applications :

- l'API reçoit `CUSTOM_WORKER_TOKEN` ;
- le Custom Worker de la cible reçoit exactement la même valeur ;
- les secrets supplémentaires déclarés par `customWorker.secrets` restent
  propres à l'application et sont classés
  `application-specific-operator-or-provider` ;
- les capacités, bindings, D1, crons et fournisseurs propres à l'application
  restent dans son manifest et son répertoire `workers/custom/<application>`.

Pour VocoStar, `custom-worker-internal-token` protège l'adaptateur. Les
orchestrateurs de clonage vocal et de conversion sont des Service Bindings privés,
mais leurs callbacks partagent en plus le contrat
`managed-worker-gateway-callback-token`. Ses membres Worker reçoivent exactement
la même valeur que le peer externe déclaré par la target,
`api-auth-gateway/INTERNAL_CALLBACK_TOKEN`. Le plan de bundle refuse toute
préparation de ce contrat sans `--external-peers-ready`; aucune valeur n'est
stockée dans le manifest.

## Valeurs locales et valeurs externes

Les valeurs suivantes ne doivent pas être partagées entre Workers, sauf mention
explicite du plan :

- `JWT_SECRET`, clés de traitement Queue, clé d'administration, clé de
  diagnostic et jeton de cutover : aléatoires, propres à l'API et à la cible ;
- `IDENTITY_KEYSET` : keyset asymétrique propre à Identity, avec chevauchement
  des clés publiques pendant une rotation ;
- `SUPPORT_WEBHOOK_ENCRYPTION_KEY` : chiffrement des secrets de webhook Support ;
- `SMTP_ENCRYPTION_KEY` et `TRACKING_SIGNING_KEY` : chiffrement des profils
  Marketing et signature du tracking ;
- `CLIENT_SECRET` du Dashboard : valeur couplée au hash stocké dans
  `oauth_applications`, jamais un simple secret Worker isolé ;
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USERNAME` et `SMTP_PASSWORD` :
  configuration ou credentials du fournisseur de mail transactionnel ;
- `CLOUDFLARE_ANALYTICS_ACCOUNT_ID` : dérivé du compte cible ;
- `CLOUDFLARE_ANALYTICS_TOKEN` : jeton Cloudflare durable et limité à la lecture
  des données nécessaires au Dashboard.

Les clés SMTP de Marketing ne sont pas les credentials SMTP eux-mêmes. Elles
chiffrent les profils de fournisseurs saisis dans Grow. Le Worker Email utilise
les credentials SMTP de la cible pour les e-mails transactionnels. Marketing
décrypte uniquement le profil sélectionné en mémoire et le transmet au Worker
Email via Service Binding authentifié; Email n'en conserve que l'empreinte de
requête et le reçu. Newsletter et transactionnel restent donc séparés au niveau
métier avec une seule autorité d'effet SMTP.

## Arborescence logique dans le gestionnaire de secrets

Le gestionnaire peut utiliser cette convention sans l'exposer dans Git :

```text
opengrow/
  <target>/
    <environment>/
      contracts/
        module-internal-token
        email-internal-token
        files-internal-token
        observability-internal-token
        billing-credential-keyring
        billing-credential-active-version
        purchases-signing-keyset
        entitlement-webhook-secret
        custom-worker-internal-token
        managed-worker-gateway-callback-token
      services/
        api/<secret-name>
        dashboard/client-secret
        email/<secret-name>
        identity/identity-keyset
        observability/cloudflare-analytics-token
        support/support-webhook-encryption-key
        marketing/<secret-name>
      recovery/
        d1-backup-encryption-key
```

Les chemins sont des identités logiques, pas des noms de variables hardcodés
dans le runtime. Le plan généré reste la source qui mappe un contrat vers ses
bindings Worker réels.

## GitHub et comptes Cloudflare

Les dépôts `superboard-platform` et `superboard-reference` restent publics. Les
secrets de déploiement sont attachés aux GitHub Environments, pas au dépôt :

- `development` sélectionne `mbza-development` et le compte Cloudflare MBZA ;
- `production` sélectionne `vocostar` et le compte Cloudflare VocoStar ;
- `config/cloudflare-deployments.json` permet à une même branche de sélectionner
  plusieurs Environments et donc plusieurs comptes/applications ;
- `SUPERBOARD_TARGET` est une variable d'Environment qui doit être strictement
  égale à la cible versionnée dans l'entrée de matrice correspondante ;
- `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` et la clé de chiffrement des
  sauvegardes D1 sont des secrets d'Environment ;
- le workflow commun découvre tous les Workers activés dans le manifest, vérifie
  leurs noms de secrets, sauvegarde les D1, applique les migrations et les
  déploie dans l'ordre de dépendance.

Ajouter une application ne requiert pas de copier le workflow. Il faut ajouter
un manifest cible, une entrée de matrice, un Custom Worker seulement si
nécessaire, puis un GitHub Environment qui fournit le compte et le nom de cible.

## Rotation sans interruption des tokens internes

Les cinq contrats `module-internal-token`, `email-internal-token`,
`files-internal-token`, `observability-internal-token` et
`custom-worker-internal-token` utilisent un chevauchement borné :

- le producteur reçoit uniquement la nouvelle valeur dans son binding courant ;
- chaque consommateur reçoit la nouvelle valeur dans le binding courant et
  l'ancienne dans un binding optionnel `*_PREVIOUS` ;
- le runtime compare en temps constant les deux candidats et, pour un contexte
  signé ou un ticket temps réel, vérifie la signature avec la valeur qui a
  réellement authentifié le token ;
- la promotion impose tous les consommateurs avant le premier producteur ;
- après observation, le retrait supprime uniquement `*_PREVIOUS`.

Ce protocole suppose que la version de code qui accepte le binding précédent a
déjà été déployée et vérifiée avec le binding courant inchangé. La première
installation d'une cible n'a pas encore d'ancienne valeur : elle utilise le
mode sans chevauchement uniquement tant que les Workers sont privés et sans
trafic, avec l'acceptation explicite du bootstrap. Toutes les rotations
ultérieures de ces cinq contrats utilisent `--overlap`.

Les bindings `*_PREVIOUS` appartiennent à l'allowlist et aux types générés, mais
ne sont jamais obligatoires dans l'état stable. Ils ne constituent donc ni une
variable permanente à remplir ni un second secret partagé entre applications.

## Procédure de bootstrap ou de rotation production

1. Générer le plan sans valeur et le conserver comme preuve de la release.
2. Créer ou renouveler les valeurs dans le gestionnaire approuvé, avec une
   valeur indépendante pour chaque cible et environnement.
3. Pour un contrat partagé, distribuer la même nouvelle valeur à tous ses
   membres. Lors d'une rotation des cinq tokens internes ci-dessus, récupérer
   aussi l'ancienne valeur et utiliser obligatoirement le mode `--overlap`. Ne
   jamais faire une rotation partielle. Lors du tout premier bootstrap sans
   trafic, omettre `--overlap` et réserver `--accept-shared-cutover` à la phase
   de promotion.
4. Sélectionner les contrats exacts et récupérer la confirmation sans mutation :

   ```bash
   npm run cloudflare:secrets:upload -- \
     --target <target> --environment <environment> \
     --contracts email-internal-token,files-internal-token \
     --overlap
   ```

5. Le gestionnaire de secrets doit envoyer sur stdin un objet JSON contenant
   exactement les contrats planifiés, sans champ supplémentaire :

   ```json
   {
     "contracts": {
       "email-internal-token": {
         "value": "<nouvelle-valeur>",
         "previousValue": "<ancienne-valeur>"
       },
       "files-internal-token": {
         "value": "<nouvelle-valeur>",
         "previousValue": "<ancienne-valeur>"
       }
     }
   }
   ```

   Cet exemple décrit la forme ; il ne doit pas être enregistré avec de vraies
   valeurs. En opération, la sortie du gestionnaire est pipée directement :

   ```bash
   <approved-secret-manager-export> | npm run cloudflare:secrets:upload -- \
     --target <target> --environment <environment> \
     --contracts email-internal-token,files-internal-token \
     --overlap \
     --apply --confirm CLOUDFLARE:SECRET-BUNDLE:<target>:<environment>:<digest> \
     > /secure/superboard/secret-upload-receipt.json
   ```

   L'outil vérifie l'ensemble exact, distribue une valeur partagée à chaque
   membre et charge une version inactive par Worker. Il n'affiche que les noms
   et reçus. Pour le keyring Billing, l'entrée contient aussi `name` avec
   `STORE_CREDENTIALS_ENCRYPTION_KEYS`. Le secret OAuth Dashboard est refusé et
   passe obligatoirement par `cloudflare:rotate-oauth`.

6. Le reçu ne contient aucune valeur. La promotion le relit, vérifie que chaque
   tag inactif existe, capture l'unique version active à 100 % comme rollback et
   produit une nouvelle confirmation liée au compte Cloudflare :

   ```bash
   npm run cloudflare:secrets:promote -- \
     --target <target> --environment <environment> \
     --receipt /secure/superboard/secret-upload-receipt.json

   npm run cloudflare:secrets:promote -- \
     --target <target> --environment <environment> \
     --receipt /secure/superboard/secret-upload-receipt.json \
     --apply --confirm CLOUDFLARE:SECRET-PROMOTE:<target>:<environment>:<digest> \
     > /secure/superboard/secret-promotion-receipt.json
   ```

   Pour un token en mode chevauché, l'outil refuse un ordre qui placerait un
   producteur avant un consommateur ; `--accept-shared-cutover` n'est pas requis
   et ne remplace pas cette sécurité. Pour un ancien contrat partagé qui ne sait
   pas accepter deux valeurs, le plan reste bloqué tant que
   `--accept-shared-cutover` n'est pas explicitement ajouté. Ce drapeau reste
   réservé au bootstrap sans trafic ou à une vraie fenêtre de maintenance.
   Si une promotion échoue, l'outil redéploie en ordre inverse les versions
   actives exactes capturées dans le plan.

7. Après succès, exécuter le contrôle des noms actifs et observer au minimum
   trente minutes les endpoints de santé, les erreurs d'authentification, les
   Queues, les jobs et le Dashboard :

   ```bash
   npm run cloudflare:secrets:check -- \
     --target <target> --environment <environment>
   ```

8. Produire puis appliquer le plan de retrait depuis le reçu de promotion. Une
   durée plus longue peut être exigée avec `--minimum-overlap-minutes`, mais
   l'outil refuse toute valeur inférieure à trente minutes :

   ```bash
   npm run cloudflare:secrets:retire -- \
     --target <target> --environment <environment> \
     --receipt /secure/superboard/secret-promotion-receipt.json

   npm run cloudflare:secrets:retire -- \
     --target <target> --environment <environment> \
     --receipt /secure/superboard/secret-promotion-receipt.json \
     --apply --confirm CLOUDFLARE:SECRET-RETIRE:<target>:<environment>:<digest> \
     > /secure/superboard/secret-retirement-receipt.json
   ```

   Le retrait s'arrête si un Worker n'exécute plus exactement la version du
   reçu ou si le compte Cloudflare diffère. Il crée une version inactive
   taguée, retire uniquement le binding précédent, l'active explicitement et
   restaure toutes les versions initiales si une étape échoue.

9. Pour un keyring, ajouter la nouvelle clé, déployer, re-chiffrer les données,
   vérifier la lecture, changer la version active, puis seulement retirer
   l'ancienne clé.
10. Pour OAuth Dashboard, utiliser `cloudflare:rotate-oauth` après la migration
    `0056`. L'outil charge une version inactive, conserve l'ancien vérificateur
    pendant une fenêtre bornée, active la version taguée et restaure la base si
    l'activation échoue.
11. Pour la production, exporter et chiffrer toutes les D1 concernées avant la
    première migration. Conserver le reçu de batch et les artefacts chiffrés.
12. Vérifier les endpoints de santé, les jobs, l'envoi transactionnel, les
    notifications et le Dashboard avant de retirer une ancienne version ou un
    credential fournisseur.

`cloudflare:set-secret` est conservé uniquement comme garde de compatibilité.
Il ne lit jamais stdin, ne modifie jamais Cloudflare et retourne le contrat ou
la rotation spécialisée qui remplace l'ancienne commande unitaire. Cela retire
du dépôt tout chemin normal vers `wrangler secret put`, qui créerait et
activerait immédiatement une version partielle.

## État VocoStar au 9 août 2026

Le compte possède désormais toutes les ressources et tous les noms de Workers
déclarés. Les six nouveaux Workers sont des shells privés, sans route ni trafic.
Le plan VocoStar contient 55 bindings obligatoires regroupés dans 37 contrats,
dont 11 contrats à valeur partagée et huit contrats propres à l'application.

Le contrôle distant par nom indique encore les valeurs manquantes suivantes :

| Service         | Noms manquants                                                                                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API             | `EMAIL_INTERNAL_TOKEN`, `PUSH_PROCESS_KEY`, `IAP_PROCESS_KEY`, `ADMIN_API_KEY`, `MAINTENANCE_PROCESS_KEY`, `DIAGNOSTICS_API_KEY`, `OBSERVABILITY_INTERNAL_TOKEN`, `CUSTOM_WORKER_TOKEN` |
| Billing         | `STORE_CREDENTIALS_ACTIVE_KEY_VERSION`, `OPENGROW_ENTITLEMENT_WEBHOOK_SECRET`                                                                                                           |
| Email           | `EMAIL_INTERNAL_TOKEN`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USERNAME`, `SMTP_PASSWORD`                                                                                     |
| Identity        | `IDENTITY_KEYSET`, `EMAIL_INTERNAL_TOKEN`, `FILES_INTERNAL_TOKEN`                                                                                                                       |
| Files           | `FILES_INTERNAL_TOKEN`, `FILES_DOWNLOAD_SIGNING_KEY`                                                                                                                                    |
| Observability   | `OBSERVABILITY_INTERNAL_TOKEN`, `CLOUDFLARE_ANALYTICS_ACCOUNT_ID`, `CLOUDFLARE_ANALYTICS_TOKEN`                                                                                         |
| Custom VocoStar | `CUSTOM_WORKER_TOKEN`                                                                                                                                                                   |

Ces valeurs ne sont pas générées arbitrairement par le dépôt. Les tokens
internes et keysets peuvent être créés dans le gestionnaire de secrets ; SMTP,
Analytics et le destinataire du webhook d'entitlement nécessitent leurs sources
durables réelles. Le plan distant compte désormais 17 migrations, dont cinq
pour l'API avec la rotation OAuth à chevauchement. Leur application et
l'activation des versions restent bloquées jusqu'à ce que le graphe soit
complet et que la sauvegarde D1 chiffrée soit disponible.
