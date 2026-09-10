# Documentation du domaine

## Organisation multi-contexte

`CONTEXT-MAP.md` est l’index des contextes :

- `CONTEXT.md` : vocabulaire transversal de la plateforme SuperBoard.
- `apps/CONTEXT.md` : surfaces interactives et Front SuperBoard.
- `packages/plugins/CONTEXT.md` : Workers métier et données opérationnelles.
- `tests/README.md` : suites de validation, fixtures et correspondance avec les propriétaires du code.
- `scripts/README.md` : outils d'exploitation et génération des configurations.

Les décisions communes résident dans `docs/adr/`.
Les décisions locales peuvent résider dans `<module>/docs/adr/`.

## Avant d’explorer le code

1. Lisez `CONTEXT-MAP.md`.
2. Lisez le contexte racine et les contextes pertinents pour la tâche.
3. Consultez les ADR communs concernés, puis ceux des modules touchés.

Pour une tâche transverse, lisez chaque contexte impliqué.
Si un fichier manque, poursuivez sans demander sa création préalable.
Les contextes supplémentaires seront créés lorsqu’un besoin de
modélisation apparaît, puis ajoutés à la carte.

## Vocabulaire

Employez les termes définis dans les contextes pour les tickets,
propositions, tests et symboles publics.

Si un concept manque, cherchez-le dans les autres contextes avant
de proposer son ajout avec le skill de modélisation du domaine.

## Décisions architecturales

Signalez explicitement toute contradiction avec un ADR existant.
Une révision doit préserver l’historique de la décision et expliquer
ce qui change.
