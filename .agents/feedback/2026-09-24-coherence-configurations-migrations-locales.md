---
date: 2026-09-24
type: amelioration
cible: AGENTS.md — Workflow ; scripts/local/start.mjs ; scripts/cloudflare/target-orchestrator.mjs
statut: ouvert
---

## Observation

Après l’annonce de la centralisation de la collecte SDK, l’utilisateur a signalé : « okay pourquoi les views ne fonctionne plus ? ». La vue Produits affichait « Dependency unavailable » et renvoyait HTTP 503.

La génération des configurations avait modifié les migrations attendues par des services locaux en cours d’exécution, sans mettre leurs bases à niveau. L’API attendait `0071_core_collection.sql` alors que sa base était à `0070`. Le contrôle de santé renvoyait `DATABASE_SCHEMA_NOT_CURRENT`. Dire « pas déployé » ne décrivait donc pas les effets déjà produits sur l’environnement local.

## Contexte

SuperBoard, après des générations de configurations, de manifestes et des builds pendant une session locale active. Les tests isolés de la fonctionnalité réussissaient, mais ils ne validaient pas la cohérence de l’environnement partagé après les dernières générations.

La remise en état a nécessité une sauvegarde, l’application des migrations et un redémarrage via le lanceur local. Le Site utilise la configuration et l’identifiant de persistance sélectionnés par `scripts/local/start.mjs` ; utiliser son seul fichier `infra/generated` avec Wrangler peut cibler une autre base locale.

Ce retour concerne la prévention des effets des outils de génération sur un serveur actif. Il complète le retour du 21 septembre sur les parcours après publication, sans reprendre sa demande d’automatisation des vues.

## Action proposée

Compléter le workflow agent : avant une génération ou un build, identifier les configurations surveillées par la session locale et les bases concernées. Arrêter les services concernés ou travailler dans un environnement isolé. Pour la session partagée, appliquer les migrations au bon stockage puis redémarrer par le lanceur canonique avant de conclure.

Effectuer la vérification finale après la dernière commande susceptible de modifier le runtime. Distinguer dans le compte rendu les changements du dépôt, ceux déjà effectifs localement et un déploiement distant. La réparation ponctuelle est faite ; cette règle préventive reste à intégrer.

## Critère de vérification

Lors d’un prochain ajout de migration, l’agent ne laisse pas un service local attendre un schéma absent. Après génération et redémarrage, les versions attendues et appliquées concordent, les vues précédemment utilisables répondent en HTTP 200 et leur contenu métier apparaît après hydratation. Le contrôle cible la base réellement utilisée par le serveur, et non une base locale nouvellement créée par erreur.
