# @opengrow/purchases-js

SDK Web privé pour OpenGrow Purchases 2.0.

```ts
import { OpenGrowPurchases } from "@opengrow/purchases-js";

const purchases = new OpenGrowPurchases({ projectKey: "YOUR_ACCESS_KEY" });
const configuration = await purchases.getConfiguration("onboarding_end");
await purchases.track("impression", configuration);
```

Le SDK ne reçoit jamais de données bancaires. `createCheckoutSession` retourne
une URL Stripe Checkout hébergée lorsque Stripe est configuré.
