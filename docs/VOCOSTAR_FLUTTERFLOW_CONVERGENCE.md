# Convergence FlutterFlow VocoStar vers la base SuperBoard

Ce document est l'inventaire de migration exhaustif du dernier projet
FlutterFlow VocoStar disponible localement. Il complète l'architecture
Cloudflare historique et transforme chaque élément du client en décision
explicite : **commun SuperBoard**, **configurable par application**, **métier
custom VocoStar** ou **à supprimer**. Le manifeste strict
`config/flutterflow-inventories/vocostar.json` porte la liste machine complète;
ce document en est la lecture opérationnelle.

## Trois états à ne pas confondre

| État                    | Autorité                                                     | Signification                                                                                          |
| ----------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| **AS-IS revu**          | dernier SDK typé et export runtime du 9 août                 | inventaire réellement présent : 23 pages, 17 composants, 34 champs App State et 30 custom actions      |
| **Historique supprimé** | commits FlutterFlow antérieurs et gates d'absence            | éléments déjà absents du dernier export, notamment `userLoginRevenueCat` et `userSubscriptionActivate` |
| **TO-BE DSL**           | `tools/flutterflow-applications/vocostar/dsl/migration.dart` | transformations versionnées et testées, mais **pas encore appliquées** à l'export revu                 |

Une transformation présente dans le DSL n'est jamais décrite ci-dessous comme
déployée. Son état reste `versioned-not-applied-to-reviewed-export` jusqu'à une
exécution GitHub autorisée, suivie d'un nouvel export authentifié.

## Source analysée et fraîcheur

| Élément                   | Valeur constatée                               |
| ------------------------- | ---------------------------------------------- |
| Projet FlutterFlow        | `VocoStar`                                     |
| Identifiant FlutterFlow   | `vocal-transform-z2j7dp`                       |
| Export local              | `/Users/appmonster/Workspace/app-vocostar-ff`  |
| Dernière exécution        | 9 août 2026 à 22:47:59 UTC                     |
| Commit FlutterFlow        | `RllpTDAzXqy5vRMb1dk4`                         |
| Message                   | `Configure media realtime from API target`     |
| Résultat de l'export revu | succès, poussé, export non simulé              |
| Reçu local courant        | remplacé le 10 août par un dry-run réussi      |
| Vérification actuelle     | bloquée : `reviewed-export-receipt-replaced`   |
| Diagnostics               | 20 avertissements, aucune erreur de validation |

Ce dépôt n'importe pas le code VocoStar dans la base commune. Il en conserve le
contrat de migration; les capacités réutilisables sont implémentées dans
le monorepo `mabzadev/superboard` et exercées par `apps/reference`.

La fraîcheur de cette analyse et son contrat de convergence sont matérialisés
dans `config/flutterflow-sources/vocostar.json`, tandis que l'inventaire nommé,
sa classification et ses liens phase/gate sont dans
`config/flutterflow-inventories/vocostar.json`, validé par
`schemas/flutterflow-client-inventory.schema.json`. Le vérificateur générique
compare le projet, le commit, les dates, les empreintes des trois métadonnées
FlutterFlow, les 48 fichiers SDK générés référencés, les inventaires et les
diagnostics. Il inspecte ensuite l'export runtime ignoré par Git pour prouver
l'absence des anciens domaines/actions/états et la présence des autorités
communes réellement câblées. Il ne lit jamais `.flutterflow/.env` :

```bash
npm run flutterflow:source:verify:vocostar -- \
  --source /chemin/vers/le/dernier/export-vocostar

SUPERBOARD_CLIENT_SOURCE_VOCOSTAR=/chemin/vers/le/dernier/export-vocostar \
  npm run flutterflow:source:verify:vocostar

npm run flutterflow:inventory:vocostar
```

La forme par variable est dérivée de `application: vocostar` dans le manifeste;
aucun chemin de poste n'est enregistré dans les scripts ou la configuration.
`OPENGROW_CLIENT_SOURCE_VOCOSTAR` reste accepté temporairement comme alias de
migration; lorsque les deux variables existent, la variable SuperBoard gagne.

Le contrôle distingue `snapshotVerified` de `convergence.ready`. Il échoue dès
qu'un export ou un fichier généré diffère du snapshot revu, mais aussi quand le
snapshot est authentique et que la migration reste incomplète. La vérification
complète actuelle s'arrête avant l'évaluation de convergence : un dry-run local
du 10 août a remplacé `.flutterflow/last_run.json`, donc le dépôt ne prétend plus
`snapshotVerified=true`. Le contrat contient **35 gates**; leur résultat ne sera
republié qu'après un nouvel export revu. Une documentation ancienne, un dry-run
réussi ou un export simplement frais ne peuvent pas être présentés comme une
migration appliquée.

### Plan de migration exécutable

Le contrat distinct
`config/flutterflow-migrations/vocostar.json`, validé par
`schemas/flutterflow-migration-plan.schema.json`, transforme ces trente-cinq
gates en sept phases dépendantes et dix lots de travail. Chaque gate du snapshot
doit être affectée exactement une fois. Les trente-six symboles de remplacement
distincts doivent tous exister dans `config/flutterflow-custom-code.json`; un
nom inventé, une gate dupliquée/non couverte, une phase inconnue ou une
dépendance vers une phase ultérieure fait échouer le plan.

Valider uniquement le contrat versionné, sans lire un projet externe :

```bash
npm run flutterflow:migration:plan:vocostar
```

Joindre ensuite ce contrat au dernier export authentifié :

```bash
SUPERBOARD_CLIENT_SOURCE_VOCOSTAR=/chemin/vers/le/dernier/export-vocostar \
  npm run flutterflow:migration:plan:vocostar
```

Le résultat expose `contractReady`, `snapshotVerified`, les diagnostics, les
phases, les lots bloqués, les contrôles précis, les symboles communs cibles et
les critères d'acceptation. Il ne lit aucun fichier d'environnement. Le rapport
global `platform:readiness` incorpore la même structure; le plan et le readiness
ne peuvent donc plus diverger silencieusement.

| Phase                   | Lots du TO-BE non encore certifiés   |
| ----------------------- | ------------------------------------ |
| `identity-runtime`      | `identity-session`, `runtime-policy` |
| `files-notifications`   | `files`                              |
| `billing`               | —                                    |
| `onboardings-marketing` | `onboardings`, `marketing`           |
| `custom-jobs`           | `custom-jobs`                        |
| `support`               | `support`                            |
| `quality`               | `flutterflow-quality`                |

La base commune fournit le remplacement du principal verrou de la première phase :
le SDK FlutterFlow `2.2.4` possède une session Identity chiffrée, isolée par
cible/projet/environnement, restaurée et renouvelée automatiquement. La
référence MBZA a supprimé son ancien stockage de tokens et teste cette seule
implémentation. Le DSL versionné
`tools/flutterflow-applications/vocostar/dsl/migration.dart` effectue désormais
le retrait idempotent des champs persistés `authAccessToken`,
`authRefreshToken` et `authExpiresIn`, conserve seulement un pont access-token
en mémoire et laisse le refresh token au stockage chiffré du SDK. Le 10 août
2026, ses trois tests et sa compilation à blanc contre le projet réel
`vocal-transform-z2j7dp` réussissent sans erreur de validation. Cela prouve que
le TO-BE compile, pas qu'il est appliqué. VocoStar reste non certifié jusqu'à la
synchronisation de la bibliothèque, l'exécution GitHub autorisée du DSL et un
nouvel export source authentifié.

### TO-BE : migration FlutterFlow versionnée et testée, non appliquée

Le workflow d'application exécute désormais, dans cet ordre : validation des
manifeste, vérification des tags immuables, initialisation du projet existant,
`flutterflow ai test`, puis seulement `flutterflow ai run`. Le DSL ne contient
ni identifiant de projet, ni clé API, ni identifiant de bibliothèque : ces trois
valeurs viennent exclusivement du GitHub Environment protégé.

Le DSL cible code les transformations suivantes; le dernier export AS-IS ne les
contient pas encore :

- bootstrap de la session chiffrée et pont Custom Auth non persistant;
- restauration/rotation de session, anonyme, Google, Apple et liaison de
  fournisseur via Identity;
- runtime policy maintenance/version;
- upload d'un chemin mobile vers Files et propagation du seul `fileId` opaque;
- création `vocostar.media.convert` et `vocostar.voice.clone` via le gateway
  custom, avec identité dérivée côté serveur;
- remplacement des trois actions Support, du widget Chatwoot direct et des
  cinq champs Support par le SDK commun;
- suppression de `userMediaRemove` et des origines historiques
  `sup.vocostar.com`, `file.vocostar.com` et `.workers.dev`;
- réparation de la représentation des trois listes de DataStructs sans casser
  `mediaPlayerSwap` ni les paramètres du lecteur;
- normalisation des placeholders de headers et conservation des variables de
  query réellement utilisées par les action graphs.

Le DSL ne couvre pas encore l'intégralité de la convergence : retrait complet
de l'ancien état Billing/paywall, consentement Marketing, liste/détail des jobs
et ticket temps réel, Files download/delete, audit des gardes de routes, assets,
signature release et dérives de noms de structs restent des lots explicites.
La validation distante reste strictement non mutante tant que le workflow de
synchronisation puis d'application n'est pas autorisé.

## Inventaire complet

| Type FlutterFlow | Nombre |
| ---------------- | -----: |
| Pages            |     23 |
| Composants       |     17 |
| Action blocks    |      6 |
| App events       |      4 |
| Appels API       |      9 |
| Custom actions   |     30 |
| Custom functions |      7 |
| Custom widgets   |      7 |
| Data structs     |      9 |
| Champs App State |     34 |

### Les 23 pages

| Zone           | Pages exactes                                                                | Décision de convergence                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bootstrap      | `index`                                                                      | Remplacer l'initialisation réseau propre à VocoStar par `SuperBoardBootstrap`, l'Identity commune et la politique runtime App.                            |
| Onboarding     | `onboard00`, `onboard01`, `onboard02`, `onboard03`, `onboard04`, `onboard05` | Conserver le design VocoStar; charger, versionner et mesurer le contenu via Onboardings. La fin du parcours ouvre désormais le paywall SuperBoard unique. |
| Application    | `user_clone`, `user_vocals`, `user_library`                                  | Reste propre à VocoStar. Les listes et jobs voix/média passent par le Worker custom.                                                                    |
| Création média | `user_record_audio`, `user_record_text`, `user_record_video`, `user_upload`  | L'upload et la suppression sont communs via Files; l'enregistrement local et la conversion restent VocoStar.                                            |
| Lecture        | `user_player_media`                                                          | Lecteur visuel réutilisable possible; résolution des sorties et progression des conversions dans le custom VocoStar.                                    |
| Compte         | `user_link_account`, `user_sign_account`                                     | Remplacer par Identity pour email, anonyme, Google, Apple, liaison, refresh, logout et suppression.                                                     |
| Réglages       | `settings_user`, `settings_language`, `settings_support`, `settings_ticket`  | Profil via Identity, préférences via App, support via Support. Aucun accès Chatwoot direct.                                                             |
| Documents      | `privacy_policy`, `terms_of_use`                                             | Contenu et URL configurés par application; présentation FlutterFlow locale.                                                                             |

Il n'est pas souhaitable de copier ces pages dans `apps/reference`. La référence
teste les quinze parcours fonctionnels communs et un seizième parcours
`reference.echo` pour certifier le protocole custom et `reference.acceptance`
pour figer la preuve MBZA liée aux deux révisions Git; VocoStar garde sa
navigation et son identité visuelle, puis remplace progressivement ses actions
par celles de la bibliothèque.

### Les 17 composants

| Famille             | Composants exacts                                                                                                    | Portée                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Navigation/réglages | `ButtonLanguage`, `ButtonSettings`, `ButtonSettingsLarge`, `Header`, `HeaderMedia`, `HeaderOnBoarding`, `MenuBottom` | Présentation VocoStar; aucun protocole réseau ne doit y rester.                                                                        |
| Cartes métier       | `CardCloneList`, `CardHotReplay`, `CardMediaList`, `CardVocalList`, `CardVocalMedia`, `InfoLibrary`                  | Custom VocoStar.                                                                                                                       |
| Monétisation        | `CardPaywall`, `CardToken`, `FeatureItem`, `Paycreditv1`                                                             | Les anciennes cartes restent visuelles; toutes les ouvertures d'achat pointent maintenant vers `SuperBoardPaywall`, Billing et Products. |

`Paywallv1` et la page `onboardWall` ont été supprimés dans le commit FlutterFlow
`FjoaBuXpywlA7rEFYJGP`. Les migrations suivantes, jusqu'au snapshot
`RllpTDAzXqy5vRMb1dk4`, ont conservé cette suppression. `paywallR1`, Settings
Premium et la fin de l'onboarding
naviguent vers la page de bibliothèque SuperBoard. L'ancien état `appPaywall`
reste à retirer avec les appels Settings historiques; il n'est plus l'autorité
de l'offre affichée. Billing est l'unique autorité des achats et droits vérifiés.

### Action blocks, App events et appels API

Action blocks exacts :

- `getAppOnBording`, `getAppPaywall`, `getAppVocals`, `getUserMedia`, `initUp`,
  `paywallR1`.

App events exacts :

- `getAppDatabase`, `getAppOnBoarding`, `getAppPaywall`, `getUserMedia`.

Appels API du groupe historique `Vocostar API Gateway` :

- `Get App Board`, `auth Logout`, `get App Categories`, `get App Questions`,
  `get App Vocals`, `get User Medias`, `get User Vocals`, `post User Media`,
  `post User Vocals`.

Décision : aucun nouvel appel ne doit contenir `https://api.vocostar.com` dans
le custom code. L'URL API vient de la cible/de l'environnement de build. Les
appels communs passent par la bibliothèque SuperBoard; seuls les catalogues de
voix et jobs de conversion traversent les routes versionnées du custom VocoStar
derrière l'API SuperBoard.

### AS-IS : les 30 custom actions présentes

| Action existante            | Destination cible          | Décision                                                                                                                |
| --------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `appCheckInternet`          | utilitaire client          | Garder comme adaptateur léger sans URL métier; ne doit pas décider de l'état serveur.                                   |
| `appCheckMaintenance`       | App/runtime policy         | Remplacée par `superboardApplicationRuntimePolicyJson`.                                                                 |
| `appCheckUpdate`            | App/runtime policy         | Remplacée par la même politique versionnée avec versions minimale/recommandée et URL Store.                             |
| `appGetPaywall`             | Paywalls                   | Remplacer par le placement Paywalls distant.                                                                            |
| `initApp`                   | Bootstrap + Identity + App | Remplacer par une séquence explicite et testable, pas une action monolithique.                                          |
| `openGrowPaywall`           | Paywalls/Billing           | Adaptateur ajouté pour produire un import de Library Page compilable dans les action blocks FlutterFlow.                |
| `requestTrackingPermission` | adaptateur natif optionnel | Conserver comme mince adaptateur iOS/Android; la décision de consentement et l'événement appartiennent à App/Marketing. |
| `signlinkWithApple`         | Identity                   | Remplacer par les actions fournisseur Apple communes.                                                                   |
| `signlinkWithGoogle`        | Identity                   | Remplacer par les actions fournisseur Google communes.                                                                  |
| `supportFetchMessages`      | Support                    | Remplacer par `superboardSupportMessagesJson`.                                                                          |
| `supportInit`               | Support                    | Remplacer par `superboardSupportInitializeAuthenticated`.                                                               |
| `supportSendMessage`        | Support                    | Remplacer par `superboardSupportSend` ou `superboardSupportSendAdvanced`.                                               |
| `userAuthenticate`          | Identity                   | Remplacer par les actions anonyme/email/fournisseur communes.                                                           |
| `userCleanManager`          | Identity + Files + custom  | Suppression de compte orchestrée : compte, fichiers, puis données métier custom.                                        |
| `userCreditsCheck`          | Billing                    | Lire les monnaies virtuelles/droits depuis Billing.                                                                     |
| `userCreditsUpdate`         | Billing + custom           | La consommation doit être atomique côté serveur lors de la création du job; jamais une écriture libre du client.        |
| `userCustomVocals`          | custom VocoStar            | Reste custom : sélection/gestion des voix propres à VocoStar.                                                           |
| `userFCMToken`              | Identity/App notifications | Remplacer par `superboardSetPushToken`.                                                                                 |
| `userGetMe`                 | Identity                   | Remplacer par l'action profil commune.                                                                                  |
| `userHasMedias`             | custom VocoStar            | Devient une propriété dérivée de la liste de jobs/médias custom.                                                        |
| `userHasVocals`             | custom VocoStar            | Devient une propriété dérivée de la liste de voix custom.                                                               |
| `userMediaCleanLocal`       | adaptateur client          | Conserver uniquement pour les fichiers temporaires locaux.                                                              |
| `userMediaConverter`        | custom VocoStar            | Création de job via le contrat custom versionné.                                                                        |
| `userMediaIndex`            | custom VocoStar            | Liste/état via le contrat custom.                                                                                       |
| `userMediaRemove`           | Files + custom VocoStar    | Suppression orchestrée des métadonnées custom et objets Files.                                                          |
| `userMediaUpload`           | Files                      | Remplacer par l'upload commun avec progression et limites configurées.                                                  |
| `userRefreshAuth`           | Identity                   | Remplacer par le refresh commun et rotation de session.                                                                 |
| `userUpdateMe`              | Identity                   | Remplacer par la mise à jour de profil commune.                                                                         |
| `wsSubscribe`               | custom VocoStar/temps réel | Le client s'abonne à une URL/ticket émis par l'API; aucun hostname codé en dur.                                         |
| `wsUnsubscribe`             | custom VocoStar/temps réel | Fermeture du canal custom communément instrumentée.                                                                     |

### Historique supprimé : deux actions absentes de l'AS-IS

`userLoginRevenueCat` et `userSubscriptionActivate` ne font plus partie des 30
custom actions du dernier export. Elles restent dans les gates comme preuve de
retrait historique et ne doivent pas être comptées dans l'inventaire courant.

Le remplacement concret des deux créations de jobs est désormais fixé :

| Parcours VocoStar                                             | Action commune cible                       | Contrat                                                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| ancien `post User Vocals` / création dans `user_record_audio` | `superboardApplicationCreateCustomJobJson` | `capability=vocostar.voice.clone`; le `payload` ne contient que les paramètres métier et références de fichiers autorisées |
| ancien `post User Media` / `userMediaConverter`               | `superboardApplicationCreateCustomJobJson` | `capability=vocostar.media.convert`; le type texte/audio/vidéo et l'entrée sont dans le `payload`                          |
| ancien `get User Medias` / `userMediaIndex`                   | `superboardApplicationListCustomJobsJson`  | filtres allowlistés `status`, `capability`, `limit`, `cursor`                                                              |
| détail/progression d'un média                                 | `superboardApplicationGetCustomJobJson`    | identifiant de job opaque; réponse limitée au propriétaire authentifié                                                     |
| annulation avant démarrage                                    | `superboardApplicationCancelCustomJobJson` | annulation limitée au projet et au propriétaire; les crédits débités sont remboursés exactement une fois                   |

FlutterFlow fournit une clé d'idempotence stable par intention utilisateur. Le
SDK envoie les en-têtes de projet configurés et échange la session Application
contre un jeton Identity court. L'API dérive `projectRef` et `userId`, écrase
toute identité fournie dans le payload, puis transmet au Worker custom par
Service Binding. Ni le jeton privé `CUSTOM_WORKER_TOKEN`, ni un hostname
`workers.dev`, ni une URL VocoStar ne se trouvent dans le client.

Pour les entrées audio et vidéo, le payload métier contient uniquement le
`fileId` opaque retourné par SuperBoard Files. L'API retire explicitement toute
identité (`userId`, `subject`, `projectRef`) éventuellement injectée par un
client. Le Worker custom lie le job au sujet authentifié, persiste le `fileId`
et, au moment exact du dispatch, demande à Files par Service Binding un ticket
HTTPS signé, propriétaire-scopé et à durée de vie bornée. Seul ce ticket
temporaire est remis aux orchestrateurs VocoStar historiques; aucune URL
d'upload publique ni origine legacy n'est persistée comme entrée de job.

### Les 7 custom functions

| Fonction          | Cible                                                              |
| ----------------- | ------------------------------------------------------------------ |
| `appBoard`        | Remplacée par la définition Onboardings ou un mapper visuel local. |
| `appCategories`   | Mapper local du catalogue custom VocoStar.                         |
| `appQuestions`    | Remplacée par le modèle Onboardings.                               |
| `appVocalsMix`    | Mapper métier custom VocoStar.                                     |
| `parseDate`       | Utilitaire local pur, réutilisable si nécessaire.                  |
| `parseJson`       | À retirer au profit des clients typés de la bibliothèque.          |
| `parseListString` | À retirer au profit des modèles typés.                             |

### Les 7 custom widgets

| Widget               | Cible                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `AppBarProgress`     | Adaptateur UI VocoStar; peut consommer l'état de job custom.                                                   |
| `AppMediaPlayer`     | Candidat à un package UI optionnel si une deuxième application en a besoin.                                    |
| `AudioRecord`        | Adaptateur natif VocoStar, réintégré à la compilation; analyse statique ciblée réussie, test appareil restant. |
| `CameraRecord`       | Adaptateur natif VocoStar, réintégré à la compilation; analyse statique ciblée réussie, test appareil restant. |
| `CenteredScrollMenu` | UI locale sans dépendance réseau.                                                                              |
| `SupportChatWidget`  | À supprimer après bascule Support; remplacé par le parcours Support commun.                                    |
| `TextArea`           | UI locale; promouvoir seulement si réutilisé ailleurs.                                                         |

### Les 9 DataStructs

| Struct actuelle      | Autorité cible                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `appBoard`           | Onboardings                                                                               |
| `appCategory`        | Onboardings ou catalogue custom selon le champ                                            |
| `appPaywall`         | Paywalls/Products; la struct legacy disparaît                                             |
| `appQuestion`        | Onboardings                                                                               |
| `appSupportMessages` | Support; remplacer par le modèle SDK typé                                                 |
| `appVocals`          | custom VocoStar                                                                           |
| `user`               | Identity + entitlements Billing; ne pas dupliquer un profil complet dans plusieurs stores |
| `userMedias`         | custom VocoStar                                                                           |
| `userVocals`         | custom VocoStar                                                                           |

### Les 34 champs App State

| Groupe                      | Champs exacts                                                                                              | Migration                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Contenu                     | `appBoard`, `appMenu`, `appPaywall`, `appQuestions`, `appReponse`, `appVocals`                             | Cache dérivé et invalidable; autorités Onboardings, Paywalls et custom.                                          |
| Rafraîchissement/navigation | `appRefresh`, `appWall`, `lightMode`, `userBoardingProgress`, `userBoardingView`, `userPaywallView`        | État UI local, sans secret.                                                                                      |
| Résultats métier            | `appUserMedias`, `appUserVocals`, `userCategories`, `userHasMedia`, `userHasVocals`, `userVocals`          | Cache custom VocoStar; rechargé depuis l'API.                                                                    |
| Auth                        | `authAccessToken`, `authExpiresIn`, `authRefreshToken`, `authUserData`, `authUserId`, `userDeviceID`       | Géré par Identity. Les jetons doivent utiliser le stockage sécurisé natif, pas un App State persistant en clair. |
| Achats                      | `opengrowPurchasesReady`, `userCredits`, `userPremium`                                                     | État dérivé de Billing, jamais une autorité locale.                                                              |
| Support                     | `supportContactId`, `supportConversationId`, `supportMessages`, `supportPubsubToken`, `supportUnreadCount` | Remplacé par le client Support; aucun token Chatwoot persistant.                                                 |
| Fichiers/push               | `uploadProgress`, `userFcmToken`                                                                           | Progression UI locale; token push transmis à Identity/App.                                                       |

L'ancien état `authExpiresIn` reçoit désormais par défaut l'époque Unix : une
session sans expiration explicite est donc immédiatement considérée expirée au
lieu de produire une valeur nullable ambiguë. La migration Identity doit encore
retirer cet état persistant et calculer l'expiration depuis la session sécurisée.

## Doublons et couplages à retirer

| Couplage actuel                                                                                      | Remplacement                                                                     | Condition de suppression                                                                                 |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Chatwoot direct via `sup.vocostar.com` dans le code généré et runtime OpenChat à `chat.vocostar.com` | Worker Support + SDK FlutterFlow Support                                         | Migration des deux sources, contacts, conversations, messages et pièces jointes validée, rollback testé. |
| WebSocket média autrefois codé sur `api.vocostar.com`                                                | origine dérivée de `gatewayUrl`; à terme ticket custom obtenu par l'API SuperBoard | Host direct retiré; remplacer encore le bearer en query string et prouver progression/reconnexion.       |
| RevenueCat appelé directement par `userLoginRevenueCat`                                              | Supprimé; Billing/Products est l'autorité                                        | Gate verte; la certification Store sandbox reste à exécuter.                                             |
| `Paywallv1`, `appPaywall`, `paywallR1` et paywall SuperBoard coexistants                               | `Paywallv1`/`onboardWall` supprimés; Paywalls unique                             | Gate Billing verte; retirer encore l'état `appPaywall` et certifier le placement sur MBZA.               |
| Auth VocoStar et Identity en parallèle                                                               | Identity commune                                                                 | Migration des comptes/sessions et scénarios Google/Apple/anonymous testés.                               |
| Upload/proxy historique et Files commun                                                              | Files                                                                            | Upload, reprise, téléchargement, suppression et purge de compte testés.                                  |
| Maintenance/version dans `/settings/active`                                                          | politique runtime App                                                            | `superboardApplicationRuntimePolicyJson` branché avant navigation.                                       |

`sup.vocostar.com` est déjà absent du DNS, alors que le code généré le référence
encore et que la source Cloudflare active est `chat.vocostar.com`. La migration
doit donc supprimer les références clientes mortes, importer la source OpenChat
active et réconcilier l'ancienne source Dokploy. `chat.vocostar.com` et ses
ressources ne sont retirés qu'après le point de non-retour approuvé. Le dépôt
fournit les outils et contrôles, mais n'effectue aucune suppression destructive.

Le contrôle local du 9 août 2026 confirme que la dernière métadonnée FlutterFlow
déclare encore `supportInit`, `supportFetchMessages`, `supportSendMessage`,
`SupportChatWidget` et les cinq champs d'état Support ci-dessus. L'export Flutter
généré conserve en plus l'origine Chatwoot, l'URL WebSocket ActionCable et un
Inbox ID dans le code. Ces constantes ne doivent pas être simplement renommées :
les trois actions, le widget et leur état doivent être remplacés ensemble par le
client SuperBoard Support authentifié, puis supprimés seulement après la reprise
des conversations et pièces jointes.

## Diagnostics du dernier export

| Code  | Nombre | Action requise                                                                                                                                                                                                       |
| ----- | -----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `R18` |     17 | Auditer les variables API une par une. Le contrôle FlutterFlow ignore actuellement les références dans les headers, donc les occurrences `BearerAuth` peuvent être des faux positifs à ne pas supprimer aveuglément. |
| `R15` |      3 | Conserver le runtime fonctionnel jusqu'à une migration de schéma contrôlée : le message recommande `isList=true`, mais le SDK typé exposé utilise encore la représentation `listType<DataStruct>`.                   |

Ces vingt diagnostics proviennent de deux règles du SDK FlutterFlow AI qui ne
représentent pas correctement le protobuf actuel : R18 ne tient compte ni des
headers ni de `endpoint.parameters`, et `FFParameter.isList=true` est lui-même
sérialisé sous la forme que R15 signale. Le contrôle de convergence applique
donc une dérogation **bornée** à exactement 3 R15 et 17 R18. Toute occurrence
supplémentaire, tout autre code de diagnostic ou toute erreur de validation
reste bloquant. Ce mécanisme ne masque pas les diagnostics futurs et pourra
être retiré dès que le SDK FlutterFlow corrige ces deux règles.

Les 20 anciennes erreurs de configuration ont été corrigées : actions
désactivées supprimées, listes contraintes, clés dynamiques stables, rayons
concentriques corrigés, valeur d'expiration sûre et widgets audio/caméra inclus
dans la compilation. `UserLibrary` utilise désormais `Update Auth User` après
refresh : aucun login factice, aucune navigation interrompant l'abonnement et
aucune erreur de validation ne subsistent.

## Ordre de migration du client

1. Créer/enregistrer l'application VocoStar dans SuperBoard avec ses identifiants
   iOS/Android et ses fonctionnalités activées.
2. Remplacer le bootstrap, la politique maintenance/version et l'auth par les
   actions communes; tester anonyme, email, Google et Apple.
3. Remplacer upload, profil, push et suppression de compte par Identity/Files.
4. Remplacer le paywall, les crédits et RevenueCat direct par
   Products/Paywalls/Billing.
5. Brancher Onboardings pour le contenu et les événements des écrans 00 à 05.
6. Remplacer les appels `post User Vocals`, `post User Media` et `get User
Medias` par les quatre actions custom-job communes, puis valider voix,
   médias, consommation atomique, annulation/remboursement idempotents et
   progression temps réel. La relance d'un échec reste réservée au back-office
   SuperBoard.
7. Migrer Chatwoot vers Support, passer le client sur Support, comparer les
   volumes et tester le rollback.
8. Qualifier les vingt avertissements R15/R18, puis exécuter les tests
   audio/caméra et les parcours complets sur appareils/simulateurs iOS et
   Android.
9. Valider toute la matrice sur MBZA avec `dev`, puis appliquer exactement les
   mêmes versions immuables à la cible VocoStar via `main` et son Environment
   GitHub protégé.

Le TO-BE de la migration Git ajoute une autorité unique pour la
déconnexion et la suppression de compte. Tous les graphes qui appelaient
directement l’endpoint FlutterFlow `auth Logout` sont réécrits vers
`superboardLogoutSession`; le nettoyage `type=user` appelle
`superboardApplicationDeleteAccountJson`, déconnecte Purchases et vide seulement
les ponts App State transitoires. L’endpoint legacy et l’appel direct
`/clean/user` sont supprimés uniquement après vérification de toutes les
références. Les nettoyages temporaires de média/voix restent spécifiques à
VocoStar. Le contrat serveur durable est détaillé dans
[ACCOUNT_LIFECYCLE.md](./ACCOUNT_LIFECYCLE.md).

Le contrat de convergence contient 35 contrôles de source et le manifeste
d'inventaire prouve séparément les dix comptes AS-IS. La convergence complète
n'est actuellement pas certifiée, car le reçu de l'export revu a été remplacé
par un dry-run. Toute mutation du projet FlutterFlow distant reste bloquée
jusqu’à la création et la revue du tag immuable `sdk-flutterflow-v2.2.5` (ainsi
que du tag Support requis), puis doit suivre `flutterflow ai test`,
`flutterflow ai run`, un nouvel export et la revue de ce nouveau reçu.

## Critères de parité avant VocoStar production

- aucune URL VocoStar, MBZA ou Chatwoot dans la bibliothèque commune;
- aucune clé, secret fournisseur ou jeton long terme dans FlutterFlow/App State;
- toutes les fonctions communes utilisent les versions publiées dans le
  catalogue `/app/libraries`;
- tous les Workers activés sont verts dans `/infrastructure` et leur contrôle de
  santé vérifie réellement leur stockage;
- parcours Identity, Files, Billing, Paywalls, Support, Marketing et
  Onboardings validés sur la référence MBZA;
- création, progression, retry, annulation et idempotence des jobs VocoStar
  validés via le Worker custom;
- migration Chatwoot vérifiée par comptage et échantillonnage, avec sauvegarde
  et rollback;
- compilation FlutterFlow sans avertissement critique et tests mobiles réels;
- déploiement issu de GitHub, révision Git affichée dans le Dashboard, aucun
  déploiement manuel non traçable.
