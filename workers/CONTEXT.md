# Workers SuperBoard

Ce contexte définit la place des runtimes métier dans le Site EmDash cible.

## Langage

**Worker métier** :
Runtime Cloudflare qui conserve les traitements et données opérationnels d’un plugin module SuperBoard.
_À éviter_ : plugin full EmDash, page EmDash

**Donnée opérationnelle** :
Donnée produite ou consommée par l’exécution métier d’un module et qui reste sous la responsabilité de son Worker.
_À éviter_ : contenu éditorial, Release Front
