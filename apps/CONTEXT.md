# Applications SuperBoard

Ce contexte nomme les surfaces interactives du Site EmDash et du produit SuperBoard.

## Langage

**SuperBoard Login** :
Partie anonyme du Front SuperBoard qui permet à l’Opérateur SuperBoard d’établir ou de récupérer sa session d’administration produit.
_À éviter_ : login EmDash Admin, login d’utilisateur d’application

**SuperBoard Admin** :
Partie authentifiée du Front SuperBoard, réservée à l’Opérateur SuperBoard, qui expose les vues et manipulations d’administration produit.
_À éviter_ : EmDash Admin, interface d’utilisateur d’application

**View SuperBoard** :
Partie nommée du Front SuperBoard identifiée par un chemin stable et rendue par un Renderer de plugin. Une View SuperBoard décrit une interface d’administration produit, pas une page web ni une donnée métier du plugin.
_À éviter_ : page, post, page de plugin, surface, écran

**Dashboard historique** :
Application SuperBoard antérieure au Site EmDash, conservée uniquement tant que la parité et le retour arrière de la migration l’exigent.
_À éviter_ : Front SuperBoard cible
