export const integrateWebSdkValue = `import Grovs from 'grovs';
const APIKey = "_GROVS_API_KEY_"
const grovs = new Grovs(APIKey, (data) => {
})

// Start the SDK
grovs.start();

// Set the user attributes
grovs.setUserIdentifier('YOUR_USER_ID');
grovs.setUserAttributes({ KEY: VALUE });`;
