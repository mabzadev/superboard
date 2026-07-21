<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://s3.eu-north-1.amazonaws.com/opengrow.io/full-white.svg">
    <img src="https://s3.eu-north-1.amazonaws.com/opengrow.io/full-black.svg" width="120" alt="OpenGrow">
  </picture>
</p>
<p align="center">
  <a href="#"><img src="https://img.shields.io/badge/types-included-4F46E5?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/mbzadev/opengrow-js?style=flat-square&color=4F46E5" alt="MIT License"/></a>
  <a href="https://github.com/mbzadev/opengrow-js/stargazers"><img src="https://img.shields.io/github/stars/mbzadev/opengrow-js?style=flat-square&color=4F46E5" alt="GitHub stars"/></a>
</p>

## Overview

The OpenGrow SDK is a JavaScript module designed to integrate with the OpenGrow API, providing functionality for creating and managing links, handling user information, and managing authentication. This documentation covers the main methods and usage of the SDK.

## Installation

To install the OpenGrow SDK, use the following command to add it as a dependency to your project:

```bash
npm install opengrow --save
```

This will add the OpenGrow SDK to your dependencies in package.json.

After installation, you can include the SDK in your project:

```javascript
import OpenGrow from "OpenGrow";
```

## Documentation

### Constructor

```javascript
constructor(APIKey, linkHandlingCallback);
```

Creates a new instance of the opengrow SDK.

- **APIKey** (string): Your API key provided by opengrow for authentication.
- **linkHandlingCallback** (Function): A callback function that handles the data received from opengrow.

#### Example

```javascript
const APIKey = "your-api-key-here";
const handleLinkData = (data) => {
  console.log("Link data received:", data);
};

const opengrow = new OpenGrow(APIKey, handleLinkData);
```

## Methods

### start()

Initializes and starts the OpenGrow SDK by authenticating with the provided API key.

- **succesfullAuthenticatedCallback** (Function, optional): Callback to invoke on successful authentication.

#### Example

```javascript
opengrow.start();
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
  }
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

### showMessagesList()

Displays the messages list using the manager.

#### Example

```javascript
opengrow.showMessagesList();
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
  }
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
  }
);
```

## Usage Example

```javascript
import opengrow from "opengrow";

const APIKey = "your-api-key";
const opengrow = new opengrow(APIKey, (data) => {
  console.log("Link data:", data);
});

opengrow.start();

if (opengrow.authenticated()) {
  opengrow.createLink(
    "Sample Link",
    "Subtitle",
    "https://example.com/image.jpg",
    { foo: "bar" },
    (response) => console.log("Link created:", response),
    (error) => console.error("Error:", error)
  );
}

opengrow.setUserIdentifier("user-123");
opengrow.setUserAttributes({ name: "John Doe", age: 30 });

console.log("User ID:", opengrow.userIdentifier());
console.log("User Attributes:", opengrow.userAttributes());
```
