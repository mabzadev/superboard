const { createRunOncePlugin } = require('expo/config-plugins');
const withOpenGrowIOS = require('./withOpenGrowIOS');
const withOpenGrowAndroid = require('./withOpenGrowAndroid');

const pkg = require('../package.json');

/**
 * Expo Config Plugin for the OpenGrow React Native SDK.
 *
 * Configures native iOS and Android projects for the OpenGrow SDK.
 *
 * @param {import('expo/config-plugins').ExpoConfig} config
 * @param {Object} props
 * @param {string} props.apiKey - OpenGrow API key
 * @param {string} props.scheme - Custom URL scheme (e.g., "opengrowt5abed1b0fdf8")
 * @param {boolean} [props.useTestEnvironment=false] - Use test environment
 * @param {string|null} [props.baseURL=null] - Optional custom base URL for the OpenGrow SDK
 * @param {string[]} [props.associatedDomains] - Universal link domains (e.g., ["grovdc41.sqd.link"])
 */
function withOpenGrow(config, props) {
  if (!props?.apiKey) {
    throw new Error(`${pkg.name} plugin requires an "apiKey" property.`);
  }
  if (!props?.scheme) {
    throw new Error(`${pkg.name} plugin requires a "scheme" property.`);
  }

  const pluginProps = {
    apiKey: props.apiKey,
    scheme: props.scheme,
    useTestEnvironment: props.useTestEnvironment ?? false,
    baseURL: props.baseURL ?? null,
    associatedDomains: props.associatedDomains ?? [],
  };

  config = withOpenGrowIOS(config, pluginProps);
  config = withOpenGrowAndroid(config, pluginProps);

  return config;
}

module.exports = createRunOncePlugin(withOpenGrow, pkg.name, pkg.version);
