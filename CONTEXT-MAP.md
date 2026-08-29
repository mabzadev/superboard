# Carte des contextes

## Contextes

- [Plateforme SuperBoard](./CONTEXT.md) — vocabulaire transversal de la plateforme et de sa migration vers EmDash.
- [Applications](./apps/CONTEXT.md) — surfaces interactives rendues aux opérateurs et aux utilisateurs SuperBoard.
- [Workers](./workers/CONTEXT.md) — runtimes métier et données opérationnelles des modules SuperBoard.

## Relations

- **Applications → Plateforme SuperBoard** : le Front SuperBoard consomme une Release Front publiée par le Site EmDash.
- **Applications → Workers** : les actions et sources de données déclarées par les plugins modules appellent leurs Workers métier.
- **Plateforme SuperBoard → Workers** : le Site EmDash configure les plugins modules et contrôle leur disponibilité avant publication d’une Release Front.
