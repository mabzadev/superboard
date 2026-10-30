---
date: 2026-09-19
type: amelioration
cible: AGENTS.md
statut: integre
---

## Observation

« Les menus sont hardcodés. La majorité des textes que tu as mis sont hardcodés, ils doivent pouvoir être en plusieurs langues. On contrôle tes modifications et mets à jour. »
L'agent a injecté du texte brut en anglais directement dans les composants React (`OfferingsPage`, `EntitlementsPage`) et dans les graines de menus (`superboard-front-menu-seed.json`, `legacy-product-menus.json`), sans prévoir le support bilingue (anglais/français) ni utiliser le système d'internationalisation existant.

## Contexte

Dépôt SuperBoard (`mabzadev/superboard`), intégration des vues d'offres et de droits d'accès (`OfferingsPage`, `EntitlementsPage`) et configuration des éléments de navigation sous le groupe Monétisation.

## Action proposée

1. Ne jamais injecter de chaînes d'interface en dur dans les composants : utiliser systématiquement le hook d'i18n du module (ex. `useMonetizationI18n()` / `t(...)`) avec les catalogues de traduction (`en`, `fr`).
2. Pour les menus et données de navigation, renseigner systématiquement les libellés distincts par locale (`en` vs `fr`) dans les fichiers de seed et en base de données (`_emdash_menu_items`).
3. Vérifier systématiquement le rendu de l'interface en français (`?lang=fr`) et en anglais avant de déclarer la tâche terminée.

## Critère de vérification

Toute nouvelle vue ou modification de menu comporte des traductions complètes en français et en anglais, testées et validées sur les deux locales sans texte hardcodé résiduel.

## Trace

- statut : integre
- décision : Invariant d'internationalisation systématique (UI et menus) inscrit dans AGENTS.md.
- changements : AGENTS.md

