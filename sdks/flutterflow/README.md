# OpenGrow FlutterFlow

Bibliothèque prête à importer pour remplacer les actions RevenueCat dans FlutterFlow.

1. Ajoutez `opengrow_flutter` et cette bibliothèque comme dépendances.
2. Exécutez `opengrowInitialize` au démarrage avec la clé projet et le bundle/package ID.
3. Utilisez `OpenGrowPaywall`, ou appelez `opengrowGetOfferings` puis `opengrowPurchase`.
4. Protégez une page avec `opengrowHasEntitlement('premium')` et redirigez vers le paywall si la valeur est fausse.
5. Ajoutez `OpenGrowRestorePurchasesButton` dans les réglages et sur le paywall.

Le JWT d’identité doit être émis par l’issuer OIDC configuré dans OpenGrow. Aucun secret Apple ou Google n’est embarqué dans l’application.
