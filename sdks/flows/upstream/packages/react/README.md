<p align="center">
  <a href="https://flows.sh">
    <img src="https://raw.githubusercontent.com/RBND-studio/flows-sdk/refs/heads/main/docs/avatar.png" height="96">
    <h3 align="center">Flows React SDK</h3>
  </a>
</p>

<p align="center">
  The better way to build product adoption.
</p>

<p align="center">
  <a href="https://flows.sh/docs"><strong>Documentation</strong></a> ·
  <a href="https://flows.sh/changelog"><strong>Changelog</strong></a> ·
  <a href="https://flows.sh/examples"><strong>Examples</strong></a> ·
  <a href="https://flows.sh/docs/sdk-overview"><strong>SDKs</strong></a>
</p>

## Installation

For full setup instructions, see our [Quickstart guide](https://flows.sh/docs/quickstart).

```
npm install @superboard/flows-react @superboard/flows-react-components
```

`@superboard/flows-react` SDK handles the lightweight embedding of Flows, while `@superboard/flows-react-components` provides a set of built-in components to get you started quickly. Alternatively, you can [bring your own components](https://flows.sh/docs/create-custom-components).

Wrap your app with `FlowsProvider` component to wrap your application and pass in your [Project ID](/flows/r/org/settings) and [Environment](/flows/r/org/environments).

```tsx
import { FlowsProvider } from "@superboard/flows-react";
import * as components from "@superboard/flows-react-components";
import * as tourComponents from "@superboard/flows-react-components/tour";
import "@superboard/flows-react-components/index.css";

const App = () => {
  return (
    <FlowsProvider
      projectId="YOUR_PROJECT_ID" // Find this in Settings > General
      userId="YOUR_USER_ID" // Identify the user
      environment="production" // Default environment
      components={{ ...components }}
      tourComponents={{ ...tourComponents }}
    >
      {/* Your app code here */}
    </FlowsProvider>
  );
};
```

## Features

Meet Flows, the flexible platform for building in-app experiences. Focus on your product, not creating one-off logic.

- Build powerful in-app experiences to drive product growth
- Create surveys and collect feedback
- Embed components directly into your app
- Create onboarding, product adoption, in-app messaging, growth experiments, and more
- Bring your own UI components or use Flows' built-in components

Visit our [website](https://flows.sh) to learn more about Flows

## Get started for free


## Contributing

We ❤️ contributions big and small. If you have any ideas for improvements, either submit an issue or create a pull request.

---

Created by [rbnd.studio](https://rbnd.studio/).
