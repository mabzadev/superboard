# Plateforme SuperBoard

Ce contexte définit le vocabulaire transversal de SuperBoard en tant que site EmDash, sans décrire son implémentation.

## Langage

**Site EmDash** :
Site déployable qui réunit le CMS EmDash, son administration interne et le Front SuperBoard qu’il publie.
_À éviter_ : Dashboard EmDash, SuperBoard monolithique

**EmDash Admin** :
Surface interne du Site EmDash utilisée par les opérateurs de plateforme pour construire, configurer et publier SuperBoard.
_À éviter_ : SuperBoard Admin, front utilisateur

**Front SuperBoard** :
Ensemble des surfaces destinées aux utilisateurs SuperBoard, qu’elles soient anonymes, authentifiées ou dans un état système.
_À éviter_ : EmDash Admin, Dashboard EmDash

**Release Front** :
Représentation complète, immuable et validée du Front SuperBoard publiée atomiquement par le Site EmDash.
_À éviter_ : draft, page partielle

**Plugin full EmDash** :
Plugin `supbrd-plug-*` dont l’exécution et les données appartiennent entièrement au Site EmDash.
_À éviter_ : plugin module, Worker métier

**Plugin module** :
Plugin `supbrd-plugmod-*` configuré dans EmDash et associé à un Worker pour son runtime métier ou asynchrone.
_À éviter_ : plugin full EmDash, Worker autonome

**Core SuperBoard** :
Plugin fondateur `supbrd-core` qui fournit les primitives et le runtime générique du Front SuperBoard sans posséder de page concrète.
_À éviter_ : application SuperBoard, collection de pages
