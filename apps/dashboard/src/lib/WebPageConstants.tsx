export const integrateWebSdkValue = `import SuperBoard from 'opengrow';
const APIKey = "_OPENGROW_API_KEY_"
const opengrow = new SuperBoard(APIKey, (data) => {
})

// Start the SDK
opengrow.start();

// Set the user attributes
opengrow.setUserIdentifier('YOUR_USER_ID');
opengrow.setUserAttributes({ KEY: VALUE });`;
