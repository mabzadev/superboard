<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/mabzadev/superboard/dev/.github/logo.svg">
    <img src="https://raw.githubusercontent.com/mabzadev/superboard/dev/.github/logo.svg" width="120" alt="SuperBoard">
  </picture>
</p>
<p align="center">
  <a href="#"><img src="https://img.shields.io/badge/types-included-4F46E5?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript"/></a>
  <a href="https://github.com/mabzadev/superboard/blob/dev/LICENSE"><img src="https://img.shields.io/github/license/mabzadev/superboard?style=flat-square&color=4F46E5" alt="MIT License"/></a>
  <a href="https://github.com/mabzadev/superboard/stargazers"><img src="https://img.shields.io/github/stars/mabzadev/superboard?style=flat-square&color=4F46E5" alt="GitHub stars"/></a>
</p>

## Overview

The package includes the native SuperBoard Support client and embedded widget,
alongside its existing default API.

## SuperBoard Support

Import the canonical Support surface from the dedicated package export:

```javascript
import {
  SuperBoardSupportClient,
  SuperBoardSupportException,
  SuperBoardSupportWidget,
} from "@mbzadev/opengrow-js-sdk/support";
```

Create the client with the public API origin. The client applies
`/api/v1/support-widget` exactly once, refreshes expiring identity tokens,
reuses one `Idempotency-Key` across safe retries, and caps cursor pages at 100.

```javascript
const support = new SuperBoardSupportClient({
  baseUrl: "https://api.example.com",
  projectId: window.superboard.projectId,
  identityToken: window.superboard.identityToken,
  identityTokenProvider: async () => {
    const response = await fetch("/support/identity", { method: "POST" });
    const { token } = await response.json();
    return token;
  },
  widgetKey: window.superboard.widgetKey,
  widgetSignatureProvider: async (request) => {
    const response = await fetch("/support/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    return response.json();
  },
  allowedDomains: ["app.example.com"],
});
```

The signature provider obtains a short-lived server-issued signature. A
signing secret must never be embedded in browser code. Domain authorization is
also enforced by the SuperBoard project configuration; `allowedDomains` adds
an immediate local check. In widget-key mode, an opaque random `visitorId` is
kept per API origin, project, and widget key. It can also be supplied explicitly
when the application already owns a stable visitor identity.

The signing endpoint must reproduce this UTF-8 canonical input exactly (the
path is the full public pathname without a query string, the method is upper
case, an absent idempotency key is an empty line, and the digest is lower-case
hex):

```text
timestamp
METHOD
/api/v1/support-widget/path
projectId
visitorId
idempotencyKey
sha256(body)
```

The client sends the same identity as `X-SuperBoard-Widget-Visitor` and exposes
`bodySha256` plus `canonicalInput` to `widgetSignatureProvider`. Empty GET bodies
use the SHA-256 digest of zero bytes. The canonical provider response is the
lower-case hexadecimal HMAC-SHA256 digest of `canonicalInput`, computed by the
application server with the configured widget signing secret.

Conversations, messages, attachments, events, proactive support, CSAT, Help
Center content, and configured meetings are available directly from the
client:

```javascript
const conversation = await support.createConversation({
  clientConversationId: crypto.randomUUID(),
  subject: "Account question",
});

await support.sendMessage(conversation.id, {
  body: "Could you help me?",
  clientMessageId: crypto.randomUUID(),
});

const articles = await support.searchHelpCenter({
  portalSlug: "docs",
  query: "account",
});
```

Realtime uses one-use tickets and reconnects with a fresh ticket. Only native
SuperBoard Support event names are delivered to subscribers:

```javascript
const realtime = support.realtime();
const unsubscribe = realtime.subscribe((event) => {
  if (event.type === "message.created") renderMessage(event.message);
});
await realtime.connect(conversation.id);

// Later:
unsubscribe();
await realtime.dispose();
```

Mount the dependency-free accessible widget into any element. Its interface is
isolated in a closed Shadow DOM and writes user content with `textContent`:

```javascript
const widget = new SuperBoardSupportWidget({
  client: support,
  title: "Customer Support",
});

widget.mount(document.querySelector("#support"));
```

Network failures are surfaced as `SuperBoardSupportException` with `code`,
`message`, `retryable`, `requestId`, `statusCode`, and optional `details`.

<!-- opengrow-sdk-documentation:javascript:start -->

> **Lifecycle: archived.** This package is frozen for existing clients.
> Its historical release remains available, but no new version may be
> published.

## Historical installation

### GitHub Packages registry

Registry: `https://npm.pkg.github.com`.

The GitHub npm package record is public metadata. This does not make the
registry anonymously installable: unauthenticated downloads are unsupported
and return `401 Unauthorized`.

Provide a GitHub token with `read:packages` only through
`OPENGROW_GITHUB_PACKAGES_TOKEN`. Keep its value in the
developer shell or CI secret store; never commit the token to Git or write its
value into a package-manager configuration file.

Add this environment-variable placeholder to the project `.npmrc`. The
placeholder is safe to version; its resolved secret value is not:

```ini
@mbzadev:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${OPENGROW_GITHUB_PACKAGES_TOKEN}
```

Install only after the secret environment variable is present:

```bash
test -n "${OPENGROW_GITHUB_PACKAGES_TOKEN:-}" \
  && npm install @mbzadev/opengrow-js-sdk@1.0.2
```

Then import the package by its catalogue-owned name:

```javascript
import OpenGrow from "@mbzadev/opengrow-js-sdk";
```

<!-- opengrow-sdk-documentation:javascript:end -->

## Documentation

### Constructor

```javascript
constructor(APIKey, testEnvironment, linkHandlingCallback, baseURL);
```

Creates a new instance of the opengrow SDK.

- **APIKey** (string): Your API key provided by opengrow for authentication.
- **testEnvironment** (boolean): Enables the application's test data namespace.
- **linkHandlingCallback** (Function): A callback function that handles the data received from opengrow.
- **baseURL** (string): The SDK origin configured for the application, without a hard-coded global fallback.

#### Example

```javascript
const runtimeConfig = window.__OPENGROW_CONFIG__;
const handleLinkData = (data) => {
  console.log("Link data received:", data);
};

const opengrow = new OpenGrow(
  runtimeConfig.projectKey,
  runtimeConfig.testEnvironment,
  handleLinkData,
  runtimeConfig.sdkOrigin,
);
```

## Methods

### start(success, error)

Initializes and starts the OpenGrow SDK by authenticating with the provided API key.

- **success** (Function, optional): Called only after authentication succeeds.
- **error** (Function, optional): Called when authentication fails. Network-backed SDK methods remain disabled until a later `start()` succeeds.

#### Example

```javascript
opengrow.start(
  () => {
    console.log("OpenGrow authenticated");
  },
  (error) => {
    console.error("OpenGrow authentication failed:", error);
  },
);
```

### createLink(title, subtitle, imageURL, data, success, error)

Creates a new link using the OpenGrow API.

- **title** (string): The title of the link.
- **subtitle** (Function): The subtitle of the link.
- **imageURL** (string): The URL of the image associated with the link.
- **data** (Object): Additional data to be included with the link.
- **success** (Function): A callback function to be invoked upon successful creation of the link.
- **error** (Function): A callback function to be invoked if there is an error in creating the link.

#### Example

```javascript
const linkData = {
  description: "This is a sample link",
  category: "Demo",
};

opengrow.createLink(
  "Sample Link",
  "This is a subtitle",
  "https://example.com/image.jpg",
  linkData,
  (response) => {
    console.log("Link created successfully:", response);
  },
  (err) => {
    console.error("Error creating link:", err);
  },
);
```

### userIdentifier()

Retrieves the current user identifier.

- **Returns** (string|null): The user identifier if set, otherwise null.

#### Example

```javascript
const userId = opengrow.userIdentifier();
console.log("Current user ID:", userId);
```

### userAttributes()

Retrieves the current user attributes.

- **Returns** (Object|null): A dictionary of user attributes if set, otherwise null.

#### Example

```javascript
const userAttributes = opengrow.userAttributes();
console.log("User attributes:", userAttributes);
```

### setUserIdentifier(identifier)

Sets the user identifier.

- **identifier** (string): The user identifier to set.

#### Example

```javascript
opengrow.setUserIdentifier("user-12345");
```

### setUserAttributes(attributes)

Sets the user attributes.

- **attributes** (Object): A dictionary of user attributes to set.

#### Example

```javascript
const attributes = {
  name: "John Doe",
  email: "john.doe@example.com",
};

opengrow.setUserAttributes(attributes);
```

### authenticated()

Checks if the SDK is currently authenticated.

- **Returns** (boolean): true if authenticated, false otherwise.

#### Example

```javascript
const isAuthenticated = opengrow.authenticated();
console.log("Is authenticated:", isAuthenticated);
```

### showMessagesList(error)

Displays the messages list using the manager.

- **error** (Function, optional): Called instead of opening the list when authentication has not succeeded.

#### Example

```javascript
opengrow.showMessagesList((error) => console.error(error));
```

### getMessages(page, response, error)

Retrieves messages for a specific page using the manager.

- **page** (number): The page number to retrieve messages from.
- **response** (Function): Callback to handle the retrieved messages.
- **error** (Function): Callback to handle any errors during retrieval.

#### Example

```javascript
opengrow.getMessages(
  1,
  (messages) => {
    console.log("Retrieved messages:", messages);
  },
  (err) => {
    console.error("Error retrieving messages:", err);
  },
);
```

### getNumberOfUnreadMessages(response, error)

Retrieves the number of unread messages using the manager.

- **response** (Function): Callback to handle the count of unread messages.
- **error** (Function): Callback to handle any errors during retrieval.

#### Example

```javascript
opengrow.getNumberOfUnreadMessages(
  (count) => {
    console.log("Number of unread messages:", count);
  },
  (err) => {
    console.error("Error retrieving unread messages count:", err);
  },
);
```

## Usage Example

```javascript
import OpenGrow from "@mbzadev/opengrow-js-sdk";

const runtimeConfig = window.__OPENGROW_CONFIG__;
const opengrow = new OpenGrow(
  runtimeConfig.projectKey,
  runtimeConfig.testEnvironment,
  (data) => {
    console.log("Link data:", data);
  },
  runtimeConfig.sdkOrigin,
);

opengrow.setUserIdentifier("user-123");
opengrow.setUserAttributes({ name: "John Doe", age: 30 });

opengrow.start(
  () => {
    opengrow.createLink(
      "Sample Link",
      "Subtitle",
      "https://example.com/image.jpg",
      { foo: "bar" },
      (response) => console.log("Link created:", response),
      (error) => console.error("Error:", error),
    );
  },
  (error) => console.error("Authentication failed:", error),
);

console.log("User ID:", opengrow.userIdentifier());
console.log("User Attributes:", opengrow.userAttributes());
```

## Development checks

The JavaScript SDK has no runtime npm dependencies. Its complete first-party
check audits the production package graph and the development toolchain
separately before running unit tests, producing both bundles, loading the built
package through ESM and CommonJS, and verifying the publishable archive:

```bash
npm ci
npm run check
```

The development server and current Webpack toolchain require the Node.js 22 LTS
line used by the repository CI. Do not bypass audit findings with
`npm audit fix --force`; upgrade the declared toolchain, regenerate the lockfile,
and re-run the complete check instead.
