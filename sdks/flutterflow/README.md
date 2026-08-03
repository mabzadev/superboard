# OpenGrow FlutterFlow

Bibliothèque prête à importer pour remplacer les actions RevenueCat dans FlutterFlow.

1. Ajoutez la dépendance Git privée avec un ref immuable :

   ```yaml
   opengrow_flutterflow:
     git:
       url: git@github.com:mbzadev/opengrow.git
       ref: sdk-flutterflow-v2.1.1
       path: sdks/flutterflow
   ```

   Configurez dans FlutterFlow un jeton GitHub fin, en lecture seule et limité à
   ce dépôt. Ne placez jamais ce jeton dans le code exporté.
2. Ajoutez `OpenGrowBootstrap` une seule fois sur la page initiale. Pour
   Il n’initialise jamais Purchases anonymement. Appelez ensuite
   `opengrowInitializeAuthenticated` juste après `userAuthenticate`, avec le
   jeton d’accès existant émis par `api.vocostar.com`.
3. Utilisez `OpenGrowPaywall` avec un `placement`. Son contenu, son offering et
   son expérience sont récupérés à distance avec fallback hors ligne.
4. Protégez une page avec `opengrowHasEntitlement('premium')` et redirigez vers le paywall si la valeur est fausse.
5. Ajoutez `OpenGrowCustomerCenter` dans les réglages. Il inclut historique,
   abonnements, soldes et restauration.

Actions prêtes pour FlutterFlow :

- `opengrowInitializeAuto`
- `opengrowInitializeAuthenticated`
- `opengrowIdentify`
- `opengrowSetUserAttributesJson`
- `opengrowSetPushToken`
- `opengrowGenerateLinkJson`
- `opengrowGetUnreadMessageCount`
- `opengrowDisplayMessages`
- `opengrowGetLastDeepLinkJson`
- `opengrowPurchaseLogin`, `opengrowPurchaseLogout`, achat, restauration,
  synchronisation, offres et entitlements
- `opengrowGetPurchaseConfigurationJson`
- `opengrowGetCustomerInfoJson`
- `opengrowGetVirtualCurrenciesJson`
- `opengrowGetCustomerCenterJson`
- `opengrowOpenSubscriptionManagement`

`api-auth-gateway` est l’unique autorité d’authentification VocoStar. La Library
n’émet aucun jeton : elle échange le jeton VocoStar existant contre un JWT ES256
court via `POST /auth/opengrow-token`. Un achat ne démarre pas si cet échange
échoue. Aucun secret Apple ou Google n’est embarqué dans l’application.
