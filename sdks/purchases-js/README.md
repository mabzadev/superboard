# @opengrow/purchases-js

Private Web SDK for OpenGrow Purchases 2.0.

```ts
import { OpenGrowPurchases } from "@opengrow/purchases-js";

const purchases = new OpenGrowPurchases({ projectKey: "YOUR_ACCESS_KEY" });
const configuration = await purchases.getConfiguration("onboarding_end");
await purchases.track("impression", configuration);
```

The SDK never receives payment-card data. When Stripe is configured, `createCheckoutSession` returns a hosted Stripe Checkout URL.
