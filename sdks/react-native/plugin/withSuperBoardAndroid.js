/* eslint-disable no-shadow */
const {
	withAndroidManifest,
	withMainApplication,
	withMainActivity,
	withAppBuildGradle,
} = require("expo/config-plugins");
const pkg = require("../package.json");
const nativeContract = require("./native-contract.json");

// The wrapper uses `implementation`, so the app module also needs the native
// dependency because the plugin injects `io.superboard.SuperBoard` imports there.
const SUPERBOARD_ANDROID_DEP = `implementation '${nativeContract.android.packageName}:${nativeContract.android.version}'`;
const LEGACY_SUPERBOARD_ANDROID_DEP_MARKER = "// @mbzadev/superboard-react-native:dep";
const SUPERBOARD_ANDROID_DEP_MARKER = `// ${pkg.name}:dep`;
const RETIRED_SUPERBOARD_ANDROID_PACKAGES = [
	"io.superboard:SuperBoard",
	"io.superboard:superboard-android",
];
const SUPERBOARD_ANDROID_DEP_LINE = new RegExp(
	`^([ \\t]*)implementation[ \\t]*(?:\\([ \\t]*)?['"]([^'"\\r\\n]+)['"][ \\t]*\\)?[^\\r\\n]*$`,
	"gm",
);

function addSuperBoardAppDependency(contents) {
	let foundManagedDependency = false;
	const migratedContents = contents.replace(
		SUPERBOARD_ANDROID_DEP_LINE,
		(line, indentation, coordinate) => {
			const isManaged =
				line.includes(SUPERBOARD_ANDROID_DEP_MARKER) ||
				line.includes(LEGACY_SUPERBOARD_ANDROID_DEP_MARKER) ||
				coordinate.startsWith(`${nativeContract.android.packageName}:`) ||
				RETIRED_SUPERBOARD_ANDROID_PACKAGES.some((packageName) =>
					coordinate.startsWith(`${packageName}:`),
				);
			if (!isManaged) return line;
			if (foundManagedDependency) return "";
			foundManagedDependency = true;
			return `${indentation}${SUPERBOARD_ANDROID_DEP} ${SUPERBOARD_ANDROID_DEP_MARKER}`;
		},
	);
	if (foundManagedDependency) return migratedContents;

	const depsBlockRegex = /(dependencies\s*\{[\s\S]*?)(\n\s*\})/;
	if (!depsBlockRegex.test(migratedContents)) return migratedContents;
	return migratedContents.replace(
		depsBlockRegex,
		`$1\n    ${SUPERBOARD_ANDROID_DEP} ${SUPERBOARD_ANDROID_DEP_MARKER}$2`,
	);
}

function withSuperBoardAppDependency(config) {
	return withAppBuildGradle(config, (config) => {
		config.modResults.contents = addSuperBoardAppDependency(config.modResults.contents);
		return config;
	});
}

function withSuperBoardManifest(config, { scheme, associatedDomains }) {
	return withAndroidManifest(config, (config) => {
		const manifest = config.modResults;
		const application = manifest.manifest.application?.[0];
		if (!application) return config;

		const mainActivity = application.activity?.find(
			(a) =>
				a.$?.["android:name"] === ".MainActivity" ||
				a.$?.["android:name"]?.endsWith(".MainActivity"),
		);
		if (!mainActivity) return config;

		if (!mainActivity["intent-filter"]) {
			mainActivity["intent-filter"] = [];
		}

		// Remove existing SuperBoard intent filters for idempotency
		mainActivity["intent-filter"] = mainActivity["intent-filter"].filter((f) => {
			const data = f.data?.[0]?.$;
			if (!data) return true;
			// Remove scheme-based SuperBoard filter
			if (data["android:scheme"] === scheme && data["android:host"] === "open") {
				return false;
			}
			// Remove associated domain filters
			if (
				associatedDomains?.some(
					(d) => data["android:host"] === d && data["android:scheme"] === "https",
				)
			) {
				return false;
			}
			return true;
		});

		// Add custom scheme intent filter
		mainActivity["intent-filter"].push({
			action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
			category: [
				{ $: { "android:name": "android.intent.category.DEFAULT" } },
				{ $: { "android:name": "android.intent.category.BROWSABLE" } },
			],
			data: [{ $: { "android:scheme": scheme, "android:host": "open" } }],
		});

		// Add associated domain intent filters (universal links)
		if (associatedDomains) {
			for (const domain of associatedDomains) {
				mainActivity["intent-filter"].push({
					$: { "android:autoVerify": "true" },
					action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
					category: [
						{ $: { "android:name": "android.intent.category.DEFAULT" } },
						{ $: { "android:name": "android.intent.category.BROWSABLE" } },
					],
					data: [{ $: { "android:scheme": "https", "android:host": domain } }],
				});
			}
		}

		return config;
	});
}

function addSuperBoardImportToMainApplication(contents) {
	if (contents.includes("import io.superboard.SuperBoard")) {
		return contents;
	}
	// Add after the last import statement
	const lastImportIndex = contents.lastIndexOf("\nimport ");
	if (lastImportIndex === -1) {
		return `import io.superboard.SuperBoard\n${contents}`;
	}
	const endOfLine = contents.indexOf("\n", lastImportIndex + 1);
	return (
		contents.slice(0, endOfLine) + "\nimport io.superboard.SuperBoard" + contents.slice(endOfLine)
	);
}

function addSuperBoardConfigure(contents, { apiKey, useTestEnvironment, baseURL }) {
	if (contents.includes("SuperBoard.configure")) {
		return contents;
	}

	const configCode = baseURL
		? `    SuperBoard.configure(this, "${apiKey}", useTestEnvironment = ${useTestEnvironment}, baseURL = "${baseURL}")\n`
		: `    SuperBoard.configure(this, "${apiKey}", useTestEnvironment = ${useTestEnvironment})\n`;

	// Insert after super.onCreate()
	const superOnCreate = contents.indexOf("super.onCreate()");
	if (superOnCreate === -1) {
		return contents;
	}
	const endOfLine = contents.indexOf("\n", superOnCreate);
	return contents.slice(0, endOfLine + 1) + "\n" + configCode + contents.slice(endOfLine + 1);
}

function withSuperBoardMainApplication(config, props) {
	return withMainApplication(config, (config) => {
		if (config.modResults.language !== "kt") {
			throw new Error(
				`${pkg.name} config plugin requires a Kotlin MainApplication. ` +
					"Java MainApplication is not supported.",
			);
		}

		let contents = config.modResults.contents;
		contents = addSuperBoardImportToMainApplication(contents);
		contents = addSuperBoardConfigure(contents, props);
		config.modResults.contents = contents;

		return config;
	});
}

function addSuperBoardImportToMainActivity(contents) {
	if (contents.includes("import io.superboard.SuperBoard")) {
		return contents;
	}
	const lastImportIndex = contents.lastIndexOf("\nimport ");
	if (lastImportIndex === -1) {
		return `import io.superboard.SuperBoard\n${contents}`;
	}
	const endOfLine = contents.indexOf("\n", lastImportIndex + 1);
	return (
		contents.slice(0, endOfLine) + "\nimport io.superboard.SuperBoard" + contents.slice(endOfLine)
	);
}

function addSuperBoardIntentImport(contents) {
	if (contents.includes("import android.content.Intent")) {
		return contents;
	}
	const lastImportIndex = contents.lastIndexOf("\nimport ");
	if (lastImportIndex === -1) {
		return `import android.content.Intent\n${contents}`;
	}
	const endOfLine = contents.indexOf("\n", lastImportIndex + 1);
	return (
		contents.slice(0, endOfLine) + "\nimport android.content.Intent" + contents.slice(endOfLine)
	);
}

function addSuperBoardOnStart(contents) {
	if (contents.includes("SuperBoard.onStart")) {
		return contents;
	}

	const method = `
  override fun onStart() {
    super.onStart()
    SuperBoard.onStart(launcherActivity = this)
  }`;

	return insertBeforeClosingBrace(contents, method);
}

function addSuperBoardOnNewIntent(contents) {
	if (contents.includes("SuperBoard.onNewIntent")) {
		return contents;
	}

	const method = `
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    SuperBoard.onNewIntent(intent, launcherActivity = this)
  }`;

	return insertBeforeClosingBrace(contents, method);
}

function insertBeforeClosingBrace(contents, code) {
	const lastBrace = contents.lastIndexOf("}");
	if (lastBrace === -1) {
		return contents;
	}
	return contents.slice(0, lastBrace) + code + "\n" + contents.slice(lastBrace);
}

function withSuperBoardMainActivity(config) {
	return withMainActivity(config, (config) => {
		if (config.modResults.language !== "kt") {
			throw new Error(
				`${pkg.name} config plugin requires a Kotlin MainActivity. ` +
					"Java MainActivity is not supported.",
			);
		}

		let contents = config.modResults.contents;
		contents = addSuperBoardImportToMainActivity(contents);
		contents = addSuperBoardIntentImport(contents);
		contents = addSuperBoardOnStart(contents);
		contents = addSuperBoardOnNewIntent(contents);
		config.modResults.contents = contents;

		return config;
	});
}

function withSuperBoardAndroid(config, props) {
	config = withSuperBoardManifest(config, props);
	config = withSuperBoardMainApplication(config, props);
	config = withSuperBoardMainActivity(config);
	config = withSuperBoardAppDependency(config);
	return config;
}

module.exports = withSuperBoardAndroid;

// Export helpers for testing
module.exports.addSuperBoardImportToMainApplication = addSuperBoardImportToMainApplication;
module.exports.addSuperBoardConfigure = addSuperBoardConfigure;
module.exports.addSuperBoardImportToMainActivity = addSuperBoardImportToMainActivity;
module.exports.addSuperBoardIntentImport = addSuperBoardIntentImport;
module.exports.addSuperBoardOnStart = addSuperBoardOnStart;
module.exports.addSuperBoardOnNewIntent = addSuperBoardOnNewIntent;
module.exports.addSuperBoardAppDependency = addSuperBoardAppDependency;
