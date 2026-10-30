---
date: 2026-09-21
type: fonctionnalite
cible: tests/e2e/site/, scripts/config/emdash-root.overlay.json, apps/site/src/pages/_superboard/api/releases/compile.ts
statut: ouvert
---

## Observation

Après une modification de l’activation des plugins, les tests annoncés comme réussis n’avaient pas détecté des vues inutilisables. L’utilisateur a signalé : « les views ne functionnes donc tes tes sont reels ou c'est des mensonges ? », puis demandé comment empêcher une récidive.

Un test d’activation ou d’import des composants ne prouve pas que les liens du menu ouvrent des pages utilisables après publication. Annoncer une validation suffisante sur cette seule base a fait perdre confiance dans les résultats.

## Contexte

Dans SuperBoard, la vue `/communication/statistics` affichait `View is not registered by supbrd-plugmod-marketing: superboard.communication_statistics`. Les routes publiées et les registres clients utilisaient des identifiants différents. Le parcours navigateur a aussi révélé cinq liens Acquisition introuvables et des statistiques de paywalls ouvrant l’éditeur.

La correction des correspondances est réalisée. Un contrôle des modules des 162 vues déclarées, complété par deux cas de régression, est intégré à `plugins:test`. Un parcours de 64 pages et l’actualisation des statistiques ont été effectués dans le navigateur. L’automatisation de ce parcours après publication et le blocage de publication restent à construire. L’entrée intégrée `2026-09-19-rigueur-verification-avant-annonce.md` exige déjà une vérification avant annonce ; ce retour précise la couverture manquante pour les vues publiées.

## Action proposée

Ajouter dans `tests/e2e/site/` un scénario utilisant le serveur réel : activer les plugins, publier une Release Front, puis parcourir les liens du menu publié avec une session opérateur. Attendre l’hydratation et le contenu propre à chaque vue ; détecter les pages introuvables, erreurs de rendu et échecs des requêtes API nécessaires à la page. Ne pas se limiter au statut HTTP du document ou à la présence de la navigation commune.

Inclure des actions observables : rechercher un utilisateur, actualiser les statistiques, enregistrer puis relire un réglage sur une instance de test isolée. Raccorder ce scénario aux contrôles habituels et à la vérification après publication. Bloquer une publication si une route du candidate ne possède pas de composant chargeable chez son plugin propriétaire.

Les comptes rendus doivent distinguer contrôle des imports, rendu navigateur et actions métier vérifiées, et nommer les échecs restants sans conclure que tout fonctionne.

## Critère de vérification

Retirer volontairement l’enregistrement client d’une route utilisée par le menu, ou publier un lien sans route correspondante, fait échouer automatiquement le contrôle avec l’URL et l’erreur observée. Le candidate invalide ne peut pas être publié. Après correction, le scénario complet activation → publication → navigation → actions réussit sur une instance de test, sans mocks des vues ni de leurs API métier. Le rapport indique les pages et actions réellement vérifiées.

## Trace

- date : 2026-09-21
- statut : ouvert
- décision : Report approuvé par l’utilisateur vers le développement de SuperBoard. Préparer une spécification avec `/to-spec`, puis les tickets avec `/to-tickets`, pour automatiser le parcours navigateur après publication et bloquer les candidates dont les vues ne sont pas chargeables.
- motif : Cette fonctionnalité concerne le code de SuperBoard ; elle ne constitue pas une modification de skill à intégrer directement depuis le journal.
- changements : `.agents/feedback/2026-09-21-validation-des-vues-apres-publication.md` — ajout de cette trace uniquement. Aucun skill modifié, aucune spécification ni aucun ticket créé à ce stade.
