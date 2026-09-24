# Réalisation et validation des tickets ouverts

Objectif : terminer les tickets #74–85, vérifier leurs critères, créer le commit sur `dev` et fermer les tickets avec leurs preuves. Aucun ticket n’est encore considéré comme terminé.

Les spécifications récupérées sur GitHub sont conservées dans [le relevé des tickets](github-open-issues-2026-09-21.json). Les preuves du premier diagnostic local sont dans [le rapport local](local-dev-validation-2026-09-21.json) ; elles couvrent les parcours indiqués, pas tous les critères des tickets.

## Travail restant

| Ticket   | Preuves disponibles                                                                      | Compléments nécessaires avant clôture                                                                                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #75      | Tests de correspondance des vues et validation de candidate                              | Refus via les API réelles, conservation de la release active, preuves liées au candidate exact ; supprimer le faux DB du test de validation.                                                                   |
| #76      | 180 chargements de pages sur la release locale                                           | Fixture isolée reproductible, activation/publication complète, assertions propres à chaque vue, défauts provoqués et absence d’exclusions silencieuses.                                                        |
| #77      | Six actions navigateur EN/FR, recherche filtrée et persistance                           | Données connues isolées, nettoyage garanti, erreurs de service provoquées, raccordement des commandes plugins et du contrôle après publication.                                                                |
| #79      | Paramètres Authentification, conflit, diagnostic, 14 tests runtime du diagnostic         | Catalogue autoritatif complet, services et Workers réels, inventaire API incluant routes directes et SDK, permissions réelles, données partielles, traduction des états, pagination et liens vers les onglets. |
| #80      | Settings Data et diagnostic sans réglages fictifs                                        | Inventaire des paramètres existants, permissions et pannes, contrôles navigateur complets.                                                                                                                     |
| #81      | Sauvegarde/relecture des paramètres d’achat et restauration, statuts réels des boutiques | Inventaire complet des paramètres facturation/produits, liens directs, permissions, scénarios isolés sans paiement.                                                                                            |
| #82      | Page Settings Communication et diagnostic                                                | Regroupement SMTP/livraison/webhooks, retrait des opérations ordinaires de Settings, anciens liens et tests de persistance/refus.                                                                              |
| #83      | Route centrale et formulaires Environnements/SDK/Localisation                            | Liens et redirections vers onglets, navigation clavier, persistence/localisation et refus.                                                                                                                     |
| #84      | Page Settings et traduction des paramètres généraux                                      | Préserver et regrouper tous les formulaires de l’ancienne configuration métier, séparer opérations/diagnostic, liens et tests de persistance/refus.                                                            |
| #85      | Settings Analytics et diagnostic                                                         | Vérifier chaque groupe de paramètres, navigation, persistance sans purge, droits et erreurs.                                                                                                                   |
| #74, #78 | Spécifications parentes                                                                  | Audit complet des enfants et de tous les critères transversaux avant clôture.                                                                                                                                  |

## Contrôles du dépôt

- La vérification des types complète a réussi lors du diagnostic initial.
- Le lint complet du début de la poursuite signalait 189 diagnostics. Le contrôle suivant a relevé 64 diagnostics ; la majorité restante concerne les SDK d’identité. Ne pas étendre la baseline ni désactiver les règles.
- La suite de cycle de vie passe ses 20 tests : les anciennes pages de fonctions redirigent vers le gestionnaire, leur API refuse les actions retirées, y compris lorsqu’elles prétendent viser la configuration. La redirection et le gestionnaire ont aussi été vérifiés dans Chromium en anglais et en français après redémarrage du serveur.
- Les 14 tests de bootstrap des vues passent : les routes historiques et les personnalisations Flows sont conservées, et les assertions vérifient les routes déclarées.
- Le hook de commit a reformaté des déplacements identiques et des fichiers générés. Le sélecteur de formatage préserve désormais les renommages à contenu identique et les sorties des générateurs. Vérifier son exécution réelle, la cohérence de l’overlay et les artefacts avant une nouvelle tentative de commit.
- Les dépendances inutilisées et les dépendances de test mal classées ont été corrigées. L’installation figée et la préparation des tests ont réussi après synchronisation du lockfile.

## Progression de la poursuite

Le diagnostic commun expose désormais les opérations du registre des adaptateurs et les URL complètes des contributions. Une preuve indisponible n’est plus écrasée par une autre preuve saine ; les dates d’expiration invalides ne valent plus succès. Le consommateur push n’est plus présenté comme un Worker séparé. Les régressions correspondantes sont passées du rouge au vert : 14 tests runtime réussissent. Les preuves par service, les routes directes/SDK et les sources partielles restent à compléter.

### Réponses de diagnostic et vues conservées

- Le parseur partagé rejette les réponses mal formées et les statuts sains sans date vérifiable : 6 tests de contrat réussis.
- L’interface refuse les réponses appartenant à un autre plugin, traduit les statuts EN/FR et affiche un nom physique inconnu sans lui substituer un nom inventé : 10 tests d’interface réussis.
- Les 14 passages Settings/Configuration dans Chromium ont réussi avec les contrôles de santé réels, après ces changements (`/tmp/superboard-goal-settings-02.json`).
- Le bootstrap ne supprime plus les vues et liens personnalisés Flows. Le test ciblé utilise une vraie base avec une vue personnalisée préexistante et réussit. Les assertions historiques de la suite complète restent à remettre en cohérence avec les routes conservées et les ajouts.
- Le composant Achats existe toujours ; son enregistrement client et ses routes `/products/purchases` et `/monetization/purchases` ont été restaurés. Le catalogue client passe 173 tests. La nouvelle route ne figure pas encore dans la release locale active.
- Une tentative de désactivation de Commerce a répondu `PLUGIN_OPERATIONS_IN_PROGRESS`. Ne pas supprimer ses opérations ou forcer ses états. Générer les catalogues à jour, ajouter la prochaine migration de manifests (les migrations déjà appliquées sont immuables), puis publier par le workflow normal. Le générateur pointe encore sur `0043_authentication_navigation.sql` et doit avancer vers une nouvelle migration avant de régénérer des manifests modifiés.
- Le serveur Astro a renvoyé une administration vide pendant les rechargements de code. Un redémarrage avec les mêmes données a rétabli le rendu ; la redirection EN/FR a été vérifiée ensuite. Éviter de modifier les sources pendant une publication ou un parcours navigateur.

Le contrôle complet `/tmp/superboard-current-baseline.log` a terminé avec 64 diagnostics, sans modification de la baseline. Les corrections suivantes nécessitent encore un contrôle complet.

### Santé par service et stabilité de l’interface

Les contrôles de santé distinguent chaque service. Une panne d’Identity conserve la preuve saine d’App ; un binding absent n’efface pas les observations des autres Workers. Les réponses d’erreur des Workers ne sont pas exposées. Les 13 tests du panneau partagé passent, y compris la réponse réseau impossible à obtenir et la pagination après réduction de l’inventaire.

Le navigateur a révélé une course dans Authentification : l’arrivée des paramètres métier recréait le diagnostic et remplaçait le contrôle récent par une ancienne preuve. Un test reproduit cette perte, puis passe après stabilisation du panneau. Les cinq tests Authentification et le contrôle de types du site passent.

Après correction, les 14 parcours Settings/Configuration EN/FR réussissent (`/tmp/superboard-settings-race-fixed.json`). Ils comparent les statuts et dates de chaque Worker avec la réponse de revérification et parcourent toutes les pages de routes API. Les services répondent `ready` dans ce parcours. Ces contrôles ne prouvent pas encore l’exhaustivité des routes directes et SDK, ni tous les formulaires métier.

Les tests runtime reproduisent aussi deux erreurs de source : la topologie par défaut masquait un Worker dédié, et le diagnostic du package affichait la version et le schéma de son premier composant. Les corrections lisent les groupes de la configuration disponible et la déclaration du package complet. La suite correspondante passe 17 tests. Les endpoints des plugins inexistants répondent 404 ; les 19 tests runtime du diagnostic passent.

### Release locale et achats

Les migrations `0044_local_settings_routes.sql` et `0045_client_adapter_catalog.sql` conservent les manifests précédents et ajoutent les catalogues reconstruits. La release locale `0033476C67AD845E4BF5388518` a été confirmée par l’API. Les deux routes Achats répondent 200. Leur traduction française manquante a été corrigée et une assertion a été ajoutée au parcours navigateur. Les vérifications complètes de types et le lint rapide ont réussi après reconstruction.

Le parcours Achats révèle encore des réponses 500 intermittentes lors des lectures parallèles du registre Billing. La configuration locale partage la même D1 entre API et Billing. Un test avec une base SQLite temporaire reproduit la même erreur dans Miniflare lors de la récupération du marqueur de session, après l’exécution SQL. Ce point correspond au défaut décrit dans [la proposition de correction Miniflare](https://github.com/cloudflare/workers-sdk/pull/14921).

Le patch conservé dans `patches/miniflare@5.20260815.0-alpha.patch` réessaie uniquement cette récupération du marqueur, cinq fois au maximum, et conserve le résultat de la requête déjà exécutée. Il ne rejoue aucune écriture SQL. Les deux tests `local:test:storage` vérifient un verrou bref et un verrou persistant sur une vraie base temporaire. La validation navigateur après redémarrage reste nécessaire ; ne pas déclarer les erreurs 500 résolues sur la seule base de ces tests.

### Vérification navigateur après correction du stockage local

Le parcours des deux adresses Achats en français et en anglais réussit après redémarrage avec le patch Miniflare, sans réponse HTTP en erreur ni alerte. Le parcours complet suivant réussit sur la release `0C1DC6B4E031A48A29CF313517` : 180 chargements et six actions métier, dont recherche avec inclusion/exclusion de fixtures, actualisation des statistiques et sauvegarde/relecture d’un paramètre avec restauration de sa valeur. Le [rapport conservé](local-post-publication-2026-09-21.json) distingue ces preuves de la fixture isolée encore requise.

La suite complète du dépôt a révélé six échecs côté Site après génération. Le générateur de seed utilisait encore d’anciens identifiants de routes ; il lit désormais ceux de la release compilée. Les entrées Settings Data et Monetization figurent dans la source du menu pour rendre le bootstrap stable dès son premier passage. Une mise à niveau ne crée plus de vue par défaut sur le chemin d’une vue personnalisée dans la même langue. Cette vérification supplémentaire est limitée au bootstrap et préserve les données de l’opérateur. Les 143 tests du Site passent après ces corrections. Les trois assertions restantes visant la navigation ou les pages Admin retirées ont été actualisées en fonction des routes et responsabilités actuelles.

Le démarrage local convertit aussi l’ancien encodage base64 de la clé EmDash vers le format préfixé attendu, sans changer ses octets. Un test chiffre avec la clé antérieure puis déchiffre avec la clé convertie. Les huit tests locaux de démarrage et de verrouillage passent. L’installation figée et le contrôle de l’overlay passent également.
