/* eslint-disable no-shadow */
const {
	withInfoPlist,
	withEntitlementsPlist,
	withAppDelegate,
	withDangerousMod,
} = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");
const pkg = require("../package.json");
const nativeContract = require("./native-contract.json");

const SUPERBOARD_POD_BLOCK_BEGIN = `# ${pkg.name}:native-ios:begin`;
const SUPERBOARD_POD_BLOCK_END = `# ${pkg.name}:native-ios:end`;

function superBoardPodDeclaration(indentation = "") {
	return (
		`${indentation}pod '${nativeContract.ios.packageName}', ` +
		`:podspec => '${nativeContract.ios.podspecUrl}'`
	);
}

function addSuperBoardPodDependency(contents) {
	const escapedBegin = SUPERBOARD_POD_BLOCK_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const escapedEnd = SUPERBOARD_POD_BLOCK_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const managedBlock = new RegExp(
		`^[ \\t]*${escapedBegin}\\n[\\s\\S]*?^[ \\t]*${escapedEnd}\\n?`,
		"gm",
	);
	const existingPodDeclaration = new RegExp(
		`^[ \\t]*pod\\s+['"]${nativeContract.ios.packageName}['"][^\\n]*\\n?`,
		"gm",
	);
	const withoutOldDependency = contents
		.replace(managedBlock, "")
		.replace(existingPodDeclaration, "");
	const useNativeModules = /^(\s*)((?:[A-Za-z_]\w*\s*=\s*)?use_native_modules!\s*)$/m;
	const match = withoutOldDependency.match(useNativeModules);
	if (!match) return contents;

	const indentation = match[1];
	const block = [
		`${indentation}${SUPERBOARD_POD_BLOCK_BEGIN}`,
		superBoardPodDeclaration(indentation),
		`${indentation}${SUPERBOARD_POD_BLOCK_END}`,
	].join("\n");
	return withoutOldDependency.replace(useNativeModules, `${block}\n${indentation}${match[2]}`);
}

function withSuperBoardPodDependency(config) {
	return withDangerousMod(config, [
		"ios",
		(config) => {
			const podfilePath = path.join(config.modRequest.platformProjectRoot, "Podfile");
			const contents = fs.readFileSync(podfilePath, "utf8");
			const updated = addSuperBoardPodDependency(contents);
			if (updated !== contents) fs.writeFileSync(podfilePath, updated);
			return config;
		},
	]);
}

function withSuperBoardURLScheme(config, { scheme }) {
	return withInfoPlist(config, (config) => {
		if (!config.modResults.CFBundleURLTypes) {
			config.modResults.CFBundleURLTypes = [];
		}

		// Remove existing SuperBoard scheme entry to ensure idempotency
		config.modResults.CFBundleURLTypes = config.modResults.CFBundleURLTypes.filter(
			(entry) =>
				!(entry.CFBundleURLName === "SuperBoard" || entry.CFBundleURLSchemes?.includes(scheme)),
		);

		config.modResults.CFBundleURLTypes.push({
			CFBundleURLName: "SuperBoard",
			CFBundleTypeRole: "Editor",
			CFBundleURLSchemes: [scheme],
		});

		return config;
	});
}

function withSuperBoardAssociatedDomains(config, { associatedDomains }) {
	if (!associatedDomains || associatedDomains.length === 0) {
		return config;
	}

	return withEntitlementsPlist(config, (config) => {
		const existing = config.modResults["com.apple.developer.associated-domains"] || [];

		const superboardDomains = associatedDomains.map((d) =>
			d.startsWith("applinks:") ? d : `applinks:${d}`,
		);

		// Merge without duplicates
		const merged = [...new Set([...existing, ...superboardDomains])];
		config.modResults["com.apple.developer.associated-domains"] = merged;

		return config;
	});
}

function addSuperBoardImport(contents) {
	if (contents.includes("import SuperBoard")) {
		return contents;
	}
	// Add after the last import statement
	const lastImportIndex = contents.lastIndexOf("\nimport ");
	if (lastImportIndex === -1) {
		return `import SuperBoard\n${contents}`;
	}
	const endOfLine = contents.indexOf("\n", lastImportIndex + 1);
	return contents.slice(0, endOfLine) + "\nimport SuperBoard" + contents.slice(endOfLine);
}

function addSuperBoardConfiguration(contents, { apiKey, useTestEnvironment, baseURL }) {
	if (contents.includes("SuperBoard.configure")) {
		return contents;
	}

	const configLine = baseURL
		? `SuperBoard.configure(APIKey: "${apiKey}", useTestEnvironment: ${useTestEnvironment}, baseURL: "${baseURL}", delegate: nil)`
		: `SuperBoard.configure(APIKey: "${apiKey}", useTestEnvironment: ${useTestEnvironment}, delegate: nil)`;

	// Run SuperBoard.configure synchronously AFTER super.application(_:didFinishLaunchingWithOptions:)
	// returns. Two constraints to satisfy at once:
	//   - The plugin's original behavior (inject `SuperBoard.configure(...)` BEFORE
	//     super.application) breaks the Expo dev launcher on Expo SDK 54: the
	//     launcher's window / rootViewController setup is interrupted, leaving
	//     the dev build at a black screen.
	//   - Deferring with `DispatchQueue.main.async` (so it runs on the next
	//     runloop tick) breaks the SuperBoard SDK's background NSURLSession: it must
	//     be initialised inside the original launch window, otherwise
	//     `generateLink` calls hang indefinitely (the completion handler is
	//     never invoked).
	// The resolution is to call configure SYNCHRONOUSLY but AFTER super has
	// returned — capture super's Bool result, run configure, then return.
	const target =
		"return super.application(application, didFinishLaunchingWithOptions: launchOptions)";
	if (contents.includes(target)) {
		const replacement =
			`let didFinishLaunchingResult = super.application(application, didFinishLaunchingWithOptions: launchOptions)\n` +
			`    ${configLine}\n` +
			`    return didFinishLaunchingResult`;
		return contents.replace(target, replacement);
	}

	return contents;
}

function addSuperBoardUniversalLinkHandler(contents) {
	if (contents.includes("SuperBoard.handleAppDelegate(continue:")) {
		return contents;
	}

	// If the AppDelegate already declares an `application(_:continue:restorationHandler:)`
	// method (Expo SDK 54+ template does — it chains RCTLinkingManager), modifying
	// that body in place is mandatory. Adding a sibling method causes "Invalid
	// redeclaration" because Swift treats the signatures as identical.
	const existingMethodRegex =
		/(public\s+override\s+func\s+application\([^)]*continue\s+userActivity:[^{]*\{)/;
	const m = contents.match(existingMethodRegex);
	if (m) {
		const insertPoint = m.index + m[0].length;
		const superboardCall =
			"\n    if SuperBoard.handleAppDelegate(continue: userActivity, restorationHandler: restorationHandler) { return true }";
		return contents.slice(0, insertPoint) + superboardCall + contents.slice(insertPoint);
	}

	const method = `
  override func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
    return SuperBoard.handleAppDelegate(continue: userActivity, restorationHandler: restorationHandler)
  }`;

	return insertBeforeClosingBrace(contents, method);
}

function addSuperBoardURLHandler(contents) {
	if (contents.includes("SuperBoard.handleAppDelegate(open:")) {
		return contents;
	}

	// Same rationale as above for the `open: url` method.
	const existingMethodRegex = /(public\s+override\s+func\s+application\([^)]*open\s+url:[^{]*\{)/;
	const m = contents.match(existingMethodRegex);
	if (m) {
		const insertPoint = m.index + m[0].length;
		const superboardCall =
			"\n    if SuperBoard.handleAppDelegate(open: url, options: options) { return true }";
		return contents.slice(0, insertPoint) + superboardCall + contents.slice(insertPoint);
	}

	const method = `
  override func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey : Any] = [:]) -> Bool {
    return SuperBoard.handleAppDelegate(open: url, options: options)
  }`;

	return insertBeforeClosingBrace(contents, method);
}

function insertBeforeClosingBrace(contents, code) {
	// Find the closing brace of the `AppDelegate` class specifically.
	// Newer Expo (SDK 54+) AppDelegate.swift templates declare a sibling
	// `ReactNativeDelegate` class after `AppDelegate`, so `lastIndexOf('}')`
	// would inject into the wrong class — and `ExpoReactNativeFactoryDelegate`
	// does not declare these methods, causing `override` to fail to compile.
	const classMatch = contents.match(/class\s+AppDelegate\b[^{]*\{/);
	if (!classMatch) {
		// Fall back to the original behavior if the class isn't found by name.
		const lastBrace = contents.lastIndexOf("}");
		if (lastBrace === -1) return contents;
		return contents.slice(0, lastBrace) + code + "\n" + contents.slice(lastBrace);
	}
	const openIdx = classMatch.index + classMatch[0].length - 1;
	let depth = 1;
	let i = openIdx + 1;
	while (i < contents.length && depth > 0) {
		const ch = contents[i];
		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) break;
		}
		i++;
	}
	if (depth !== 0) return contents;
	return contents.slice(0, i) + code + "\n" + contents.slice(i);
}

function withSuperBoardAppDelegate(config, props) {
	return withAppDelegate(config, (config) => {
		if (config.modResults.language !== "swift") {
			throw new Error(
				`${pkg.name} config plugin requires a Swift AppDelegate. ` +
					"Objective-C AppDelegate is not supported.",
			);
		}

		let contents = config.modResults.contents;
		contents = addSuperBoardImport(contents);
		contents = addSuperBoardConfiguration(contents, props);
		contents = addSuperBoardUniversalLinkHandler(contents);
		contents = addSuperBoardURLHandler(contents);
		config.modResults.contents = contents;

		return config;
	});
}

function withSuperBoardIOS(config, props) {
	config = withSuperBoardPodDependency(config);
	config = withSuperBoardURLScheme(config, props);
	config = withSuperBoardAssociatedDomains(config, props);
	config = withSuperBoardAppDelegate(config, props);
	return config;
}

module.exports = withSuperBoardIOS;

// Export helpers for testing
module.exports.addSuperBoardImport = addSuperBoardImport;
module.exports.addSuperBoardConfiguration = addSuperBoardConfiguration;
module.exports.addSuperBoardUniversalLinkHandler = addSuperBoardUniversalLinkHandler;
module.exports.addSuperBoardURLHandler = addSuperBoardURLHandler;
module.exports.addSuperBoardPodDependency = addSuperBoardPodDependency;
