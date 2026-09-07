# Applications SuperBoard

Ce contexte nomme les surfaces interactives du Site EmDash et du produit SuperBoard.

## Langage

**SuperBoard Login** :
Parcours du socle qui établit ou récupère la session EmDash de l’Opérateur avant son retour à la vue demandée.
_À éviter_ : authentification indépendante du Dashboard, login d’utilisateur d’application

**SuperBoard Admin** :
Partie authentifiée du Front SuperBoard, réservée à l’Opérateur SuperBoard, qui expose les vues et manipulations d’administration produit.
_À éviter_ : EmDash Admin, interface d’utilisateur d’application

**View SuperBoard** :
Interface d’administration possédée par un plugin, identifiée par une route et ses paramètres. Ses personnalisations restent conservées lorsque la désactivation du plugin retire son accès.
_À éviter_ : page générique de remplacement, contenu supprimé à la désactivation

**Dashboard historique** :
Application SuperBoard remplacée par le Site EmDash. Son code est conservé dans l’historique Git ; l’inventaire de retrait est `config/superboard-dashboard-retirement.json`. Les vues actives appartiennent aux plugins et utilisent la session opérateur EmDash.
_À éviter_ : Front SuperBoard cible
