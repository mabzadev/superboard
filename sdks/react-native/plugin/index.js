const { createRunOncePlugin } = require("expo/config-plugins");
const withSuperBoardIOS = require("./withSuperBoardIOS");
const withSuperBoardAndroid = require("./withSuperBoardAndroid");

const pkg = require("../package.json");

/**
 * Expo Config Plugin for the SuperBoard React Native SDK.
 *
 * Configures native iOS and Android projects for the SuperBoard SDK.
 *
 * @param {import('expo/config-plugins').ExpoConfig} config
 * @param {Object} props
 * @param {string} props.apiKey - SuperBoard API key
 * @param {string} props.scheme - Custom URL scheme (e.g., "superboardt5abed1b0fdf8")
 * @param {boolean} [props.useTestEnvironment=false] - Use test environment
 * @param {string|null} [props.baseURL=null] - Optional custom base URL for the SuperBoard SDK
 * @param {string[]} [props.associatedDomains] - Universal link domains (e.g., ["grovdc41.sqd.link"])
 */
function withSuperBoard(config, props) {
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

	config = withSuperBoardIOS(config, pluginProps);
	config = withSuperBoardAndroid(config, pluginProps);

	return config;
}

module.exports = createRunOncePlugin(withSuperBoard, pkg.name, pkg.version);
