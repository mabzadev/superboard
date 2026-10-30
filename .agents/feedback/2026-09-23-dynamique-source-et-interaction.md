---
date: 2026-09-23
type: amelioration
cible: "/Users/appmonster/.agents/skills/diagnosing-bugs/SKILL.md — phases 1, 2 et 6"
statut: ouvert
---

## Observation

L’utilisateur a dû préciser successivement que les noms des plugins, leurs connexions aux Views, les détails de configuration et le choix du plugin devaient être dynamiques. Il a corrigé une première réponse : « ces information doivement remonter de manier dynamique automatique et pas manuel », puis demandé que « le choix des plugins soit une liste dyanamique et pas une configuation manuel ».

L’agent a d’abord remplacé des libellés, puis rendu les champs techniques non modifiables. Les tests validaient ces changements, mais le champ Plugin restait un champ en lecture seule au lieu du sélecteur demandé. Les annonces « toutes les Views » masquaient cette différence entre le périmètre technique modifié et le comportement attendu à l’écran.

## Contexte

SuperBoard, configuration des Views dans EmDash, le 23 septembre 2026. Les points concernés étaient `apps/site/src/lib/view-plugin-labels.ts`, `view-connections.ts`, `plugin-diagnostic.ts` et le champ Plugin de `packages/admin/src/components/ContentEditor.tsx`.

Les corrections produit ont été réalisées pendant la discussion. Ce retour concerne l’étape de cadrage et le critère d’achèvement du skill de diagnostic ; il ne demande pas de réimplémenter ces fonctionnalités. Il complète le contrôle après publication déjà consigné dans le journal : ici, le défaut était de valider un comportement différent de celui demandé.

## Action proposée

Dans la boucle de reproduction, traduire « dynamique » en trois éléments observables : la source autoritative des informations, l’interaction attendue dans l’interface et l’effet de la sauvegarde. Inspecter le contrôle sur la page concernée avant de choisir une correction.

Pour un choix de plugin, vérifier une liste réellement sélectionnable, alimentée par les plugins disponibles, avec une seule entrée par plugin. Contrôler la sauvegarde et la relecture du choix, et rendre explicites les incompatibilités de route. Une restriction en lecture seule doit découler du besoin établi, pas remplacer implicitement le choix demandé.

Avant l’annonce de fin, rejouer le geste utilisateur et distinguer les modifications visibles, les changements internes et l’environnement vérifié. Définir ce que couvre « toutes les Views » et vérifier chaque surface nommée dans la demande, y compris les détails de configuration.

## Critère de vérification

Lors d’une prochaine demande de liste dynamique, un test échoue si le contrôle est un champ texte ou non modifiable, si ses options restent figées après un changement de disponibilité, ou si la sauvegarde remplace silencieusement le choix. Le parcours navigateur montre les options et le résultat de la sauvegarde avant que l’agent annonce la fonctionnalité terminée.
