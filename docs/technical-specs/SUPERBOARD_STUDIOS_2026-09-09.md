# Studios emails, paywalls et parcours — livraison locale du 9 septembre 2026

Cette livraison ajoute des éditeurs visuels aux plugins SuperBoard existants. Elle conserve la navigation gérée par EmDash, les projets existants et leurs données. Le front reste disponible en français et en anglais ; les langues du contenu sont indépendantes de la langue de la console.

Les références de conception sont Klaviyo pour les emails, RevenueCat et Adapty pour les paywalls et les parcours d’accueil. Cette livraison ne constitue pas une certification de parité avec l’ensemble de leurs produits.

## Accéder aux interfaces

| Interface locale | Contenu |
| --- | --- |
| [Emails](http://127.0.0.1:4321/marketing/email?lang=fr) | Vue d’ensemble, campagnes, automatisations, contacts, modèles, envois, paramètres |
| [Paywalls](http://127.0.0.1:4321/paywalls?lang=fr) | Bibliothèque, éditeur, langues, simulation, diffusion, versions, résultats |
| [Parcours d’accueil](http://127.0.0.1:4321/onboardings?lang=fr) | Écrans, questions, embranchements, langues, simulation, versions, résultats |
| [Emails système](http://127.0.0.1:4321/system/email?lang=fr) | Messages transactionnels et paramètres du service Email |

Ces pages nécessitent la session opérateur locale. Aucun commit, push, déploiement public, changement DNS ou envoi réel d’email n’a été effectué pendant cette livraison. Les décisions de domaines restent celles de [Domaines et configuration](SUPERBOARD_DOMAINES_CONFIGURATION_2026-09-08.md).

## Emails

L’espace regroupe les modèles par type, les campagnes et leurs audiences, les préférences des contacts, les automatisations et les résultats. La galerie contient des points de départ pour les campagnes, l’accompagnement, la facturation, les notifications, l’authentification et le support. Les modèles HTML antérieurs restent éditables.

L’éditeur propose des blocs, colonnes, images, boutons, styles, conditions d’affichage, variables et blocs réutilisables. L’aperçu utilise le même rendu HTML que le service d’envoi. Les exemples de données servent uniquement à la prévisualisation. Les liens, variables et textes sont échappés et les URL sont contrôlées.

Les brouillons ont un historique et un numéro de révision. Une sauvegarde avec une révision périmée est rejetée. La publication est explicite : une modification du brouillon ne remplace pas la version utilisée par les messages transactionnels et les parcours actifs. La langue de repli doit être validée avant publication.

Les campagnes proposent les étapes Audience, Contenu et Vérification, puis la planification, la pause et la reprise. La date saisie correspond au fuseau affiché dans le navigateur et est transmise en UTC. Le contrôle préalable indique les destinataires admissibles, les langues retenues, les replis et les variables manquantes. Une campagne planifiée conserve son contenu enregistré. Lors d’une nouvelle tentative d’envoi, le service réutilise le corps du message et ses liens enregistrés.

Les listes d’envois chargent les métadonnées ; le contenu du message se charge à l’ouverture du détail. Les messages anciens dont le corps n’est pas conservé sont signalés. Les statistiques utilisent les événements disponibles, par période, langue et type. Les ouvertures sont présentées comme des observations.

### Langue selon le type de message

| Type | Ordre de préférence |
| --- | --- |
| Authentification | Langue de la demande, puis langue du profil |
| Facturation | Langue de facturation, langue du profil, langue de la demande |
| Notification | Langue des notifications, langue du profil, langue de la demande |
| Accompagnement | Langue de communication, langue marketing, langue du profil |
| Campagne | Langue marketing, langue de communication, langue du profil |
| Support | Langue de la conversation, langue du support, langue du profil |
| Équipe | Langue de l’opérateur, puis langue du profil |

La résolution cherche une variante validée exacte, puis sa langue principale, puis la langue de repli configurée. Par exemple, `fr-CH` peut utiliser la variante `fr`. Les messages marketing peuvent être ignorés si la traduction manque ; les messages essentiels exigent un repli validé. Modifier le texte source marque les traductions concernées comme à réviser. La console FR/EN n’impose pas les langues autorisées des messages ; leur liste se configure par projet.

Les plafonds de fréquence marketing sont réservés atomiquement par destinataire. Les messages essentiels ont une politique distincte. Créer un destinataire pour un email transactionnel ne lui accorde pas un consentement marketing. Les refus marketing, les blocages et les résultats du fournisseur restent pris en compte selon le type d’envoi.

### Traduction assistée

Les paramètres acceptent un fournisseur HTTPS compatible avec l’API Responses, un modèle et une clé chiffrée. Le service demande des sorties structurées et conserve les variables du texte. Le résultat reste à relire et à valider. Aucun fournisseur ni clé n’a été configuré pendant cette livraison ; les tests utilisent un fournisseur simulé. Aucun appel réel de traduction n’a été réalisé.

## Paywalls et parcours

Les deux interfaces utilisent un éditeur partagé : structure des blocs, aperçu téléphone ou tablette, annulation et rétablissement, styles, langues et simulation. Les brouillons valides sont enregistrés après cinq secondes sans modification. Une édition invalide reste signalée comme non enregistrée. Les versions sont consultables et comparables côte à côte ; la publication reste une action séparée.

La création d’un paywall enregistre désormais aussi son premier brouillon, afin de conserver le contenu préparé avant la création. Les aperçus d’offres lisent le catalogue Produits pour le magasin et l’environnement sélectionnés. Sans tarif synchronisé, l’interface indique cette absence.

Les parcours ajoutent des questions obligatoires ou facultatives, des réponses enregistrées dans les attributs, des destinations par réponse, des conditions d’écran et une vue graphique. La simulation suit les embranchements. Les réponses et les destinations sont validées côté service. Le consentement email reste facultatif et décoché par défaut.

La résolution localise les définitions dans les services Paywalls et Onboardings, ainsi que dans l’adaptateur historique Flows. Les textes traduits ne remplacent pas les identifiants d’offres, les valeurs des réponses ou les actions d’achat.

Le widget Flutter `SuperBoardOnboarding` comprend les questions, les embranchements, l’historique de retour, les réponses interpolées et le rendu RTL. La reprise est activée par `metadata.resume_progress` ou par l’option explicite `resumeProgress`. Elle exige un identifiant client ou anonyme stable. L’état est conservé dans le stockage sécurisé, isolé par serveur, projet, environnement, emplacement, utilisateur et version ; il expire après trente jours et est supprimé à la fin du parcours. Les intégrations existantes sans cette option conservent leur comportement.

## Implémentation et migration locale

Les contrats partagés se trouvent dans `packages/contracts/src/email-studio.ts`, `experience-localization.ts` et `journey-simulation.ts`. L’éditeur partagé est `packages/supbrd-front-ui/src/experience-studio.tsx`. L’espace email est dans le dossier `studio` du plugin `supbrd-plugmod-marketing`.

Le service Marketing expose les nouvelles opérations sous `/internal/v1/studio` : publication, historique, blocs partagés, aperçu, test, vérification de campagne, envois, statistiques, paramètres et traduction. Les routes privées du service Email fournissent les métadonnées des expéditeurs et l’historique des messages sans exposer les secrets SMTP. L’aperçu Produits utilise `/internal/v1/catalog/preview`.

| Migration Marketing | Objet |
| --- | --- |
| `0013_email_studio.sql` | Documents, versions, contextes et rendus |
| `0014_email_delivery_frequency.sql` | Réservation atomique de la fréquence |
| `0015_email_studio_transport.sql` | Corps final et tentatives de transport |
| `0016_email_studio_publication.sql` | Version publiée indépendante du brouillon |

Ces quatre migrations ont été appliquées uniquement à la base locale existante, avec la persistance `deploy/generated/.wrangler/state`. Le fichier ignoré `.wrangler/local-services/marketing/wrangler.jsonc` attend désormais `0016_email_studio_publication.sql`. Le catalogue du Site conserve son API locale ; les projections des domaines publics n’ont pas été injectées dans ses URL de service.

Avant toute publication ultérieure, reprendre [les contraintes de migration](SUPERBOARD_DOMAINES_CONTRAINTES_2026-09-08.md), examiner les différences de l’arbre de travail et appliquer les migrations au bon environnement. Les vérifications locales ne prouvent pas l’état déployé de Cloudflare.

## Vérification

Les contrôles lourds ont été exécutés successivement avec `NODE_OPTIONS=--max-old-space-size=4096` et `GOMAXPROCS=1`. Les commandes shell passent par `rtk`.

| Contrôle | Résultat |
| --- | --- |
| `pnpm typecheck` à la racine | Réussi, y compris le Site Astro |
| `pnpm lint:quick` | Réussi |
| `pnpm lint:json` | Les trois diagnostics antérieurs sont inchangés ; aucun nouveau diagnostic |
| Autorité du menu front | Réussie ; test d’intégration du menu réussi |
| Langues et navigation du Site | 13 tests réussis |
| Contrats de langues et simulation | 7 tests réussis |
| Interface partagée | 229 tests réussis |
| Plugins front | 352 tests réussis |
| Construction des plugins | Réussie |
| Marketing | 17 tests unitaires et 18 tests avec D1 réussis |
| Autonomie Email dans le Site | 8 tests avec les services réussis |
| Produits | 7 tests unitaires et 4 tests avec D1 réussis |
| Paywalls | 6 tests unitaires et 6 tests avec D1 réussis |
| Onboardings | 9 tests unitaires et 2 tests avec D1 réussis |
| Flows | 42 tests unitaires et 33 tests avec le runtime réussis |
| Onboarding Flutter | 4 tests réussis ; analyse statique des fichiers concernés sans diagnostic |

Les trois diagnostics du lint complet se trouvent dans `apps/site/tests/plugin-front-menu-integration.test.tsx`, `packages/core/src/astro/integration/vite-config.ts` et `packages/supbrd-runtime-plugins/scripts/bundle.test.mjs`. Ils ont été comparés au relevé pris avant modification. Le dépôt n’est donc pas présenté comme entièrement vert.

Le navigateur local a vérifié l’ouverture des quatre interfaces, la création et la publication d’un modèle FR/EN, sa récupération après rechargement, la création d’un parcours, la conservation du premier brouillon d’un paywall, sa comparaison de versions et l’assistant de campagne. Le rendu arabe a été inspecté avec `lang=ar` et `dir=rtl`. Aucun envoi n’a été déclenché pendant ces parcours.

Les essais Gmail, Outlook et Apple Mail, les achats réels dans les magasins, les appareils physiques et l’appel réel du fournisseur de traduction restent à effectuer dans leurs environnements respectifs. Cette livraison ne revendique pas leur validation. Les historiques sont bornés et les vues graphiques proposées ne couvrent pas toutes les fonctions commerciales de Klaviyo ou d’Adapty.

### Captures locales

Les objets `Studio QA` créés pour les essais ont été supprimés ou archivés. Les traces de version restent conservées selon le comportement normal des services.

Le [relevé des vérifications](../evidence/studios-2026-09-09/verification.json) contient les résultats par suite.

Les captures contiennent des données de test et montrent un état local, sans email envoyé : [galerie des emails](../evidence/studios-2026-09-09/email-gallery.png), [langues des emails](../evidence/studios-2026-09-09/email-languages.png), [email arabe](../evidence/studios-2026-09-09/email-arabic.png), [paywall](../evidence/studios-2026-09-09/paywall.png), [comparaison des versions](../evidence/studios-2026-09-09/paywall-versions.png), [assistant de campagne](../evidence/studios-2026-09-09/campaign.png).
