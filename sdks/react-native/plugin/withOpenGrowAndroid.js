/* eslint-disable no-shadow */
const {
  withAndroidManifest,
  withMainApplication,
  withMainActivity,
  withAppBuildGradle,
} = require('expo/config-plugins');
const pkg = require('../package.json');
const nativeContract = require('./native-contract.json');

// The wrapper uses `implementation`, so the app module also needs the native
// dependency because the plugin injects `io.opengrow.OpenGrow` imports there.
const OPENGROW_ANDROID_DEP = `implementation '${nativeContract.android.packageName}:${nativeContract.android.version}'`;
const LEGACY_OPENGROW_ANDROID_DEP_MARKER =
  '// @mbzadev/opengrow-react-native:dep';
const OPENGROW_ANDROID_DEP_MARKER = `// ${pkg.name}:dep`;
const RETIRED_OPENGROW_ANDROID_PACKAGES = [
  'io.opengrow:OpenGrow',
  'io.opengrow:opengrow-android',
];
const OPENGROW_ANDROID_DEP_LINE = new RegExp(
  `^([ \\t]*)implementation[ \\t]*(?:\\([ \\t]*)?['"]([^'"\\r\\n]+)['"][ \\t]*\\)?[^\\r\\n]*$`,
  'gm'
);

function addOpenGrowAppDependency(contents) {
  let foundManagedDependency = false;
  const migratedContents = contents.replace(
    OPENGROW_ANDROID_DEP_LINE,
    (line, indentation, coordinate) => {
      const isManaged =
        line.includes(OPENGROW_ANDROID_DEP_MARKER) ||
        line.includes(LEGACY_OPENGROW_ANDROID_DEP_MARKER) ||
        coordinate.startsWith(`${nativeContract.android.packageName}:`) ||
        RETIRED_OPENGROW_ANDROID_PACKAGES.some((packageName) =>
          coordinate.startsWith(`${packageName}:`)
        );
      if (!isManaged) return line;
      if (foundManagedDependency) return '';
      foundManagedDependency = true;
      return `${indentation}${OPENGROW_ANDROID_DEP} ${OPENGROW_ANDROID_DEP_MARKER}`;
    }
  );
  if (foundManagedDependency) return migratedContents;

  const depsBlockRegex = /(dependencies\s*\{[\s\S]*?)(\n\s*\})/;
  if (!depsBlockRegex.test(migratedContents)) return migratedContents;
  return migratedContents.replace(
    depsBlockRegex,
    `$1\n    ${OPENGROW_ANDROID_DEP} ${OPENGROW_ANDROID_DEP_MARKER}$2`
  );
}

function withOpenGrowAppDependency(config) {
  return withAppBuildGradle(config, (config) => {
    config.modResults.contents = addOpenGrowAppDependency(
      config.modResults.contents
    );
    return config;
  });
}

function withOpenGrowManifest(config, { scheme, associatedDomains }) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    const application = manifest.manifest.application?.[0];
    if (!application) return config;

    const mainActivity = application.activity?.find(
      (a) =>
        a.$?.['android:name'] === '.MainActivity' ||
        a.$?.['android:name']?.endsWith('.MainActivity')
    );
    if (!mainActivity) return config;

    if (!mainActivity['intent-filter']) {
      mainActivity['intent-filter'] = [];
    }

    // Remove existing OpenGrow intent filters for idempotency
    mainActivity['intent-filter'] = mainActivity['intent-filter'].filter(
      (f) => {
        const data = f.data?.[0]?.$;
        if (!data) return true;
        // Remove scheme-based OpenGrow filter
        if (
          data['android:scheme'] === scheme &&
          data['android:host'] === 'open'
        ) {
          return false;
        }
        // Remove associated domain filters
        if (
          associatedDomains?.some(
            (d) =>
              data['android:host'] === d && data['android:scheme'] === 'https'
          )
        ) {
          return false;
        }
        return true;
      }
    );

    // Add custom scheme intent filter
    mainActivity['intent-filter'].push({
      action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
      category: [
        { $: { 'android:name': 'android.intent.category.DEFAULT' } },
        { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
      ],
      data: [{ $: { 'android:scheme': scheme, 'android:host': 'open' } }],
    });

    // Add associated domain intent filters (universal links)
    if (associatedDomains) {
      for (const domain of associatedDomains) {
        mainActivity['intent-filter'].push({
          $: { 'android:autoVerify': 'true' },
          action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
          category: [
            { $: { 'android:name': 'android.intent.category.DEFAULT' } },
            { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
          ],
          data: [{ $: { 'android:scheme': 'https', 'android:host': domain } }],
        });
      }
    }

    return config;
  });
}

function addOpenGrowImportToMainApplication(contents) {
  if (contents.includes('import io.opengrow.OpenGrow')) {
    return contents;
  }
  // Add after the last import statement
  const lastImportIndex = contents.lastIndexOf('\nimport ');
  if (lastImportIndex === -1) {
    return `import io.opengrow.OpenGrow\n${contents}`;
  }
  const endOfLine = contents.indexOf('\n', lastImportIndex + 1);
  return (
    contents.slice(0, endOfLine) +
    '\nimport io.opengrow.OpenGrow' +
    contents.slice(endOfLine)
  );
}

function addOpenGrowConfigure(
  contents,
  { apiKey, useTestEnvironment, baseURL }
) {
  if (contents.includes('OpenGrow.configure')) {
    return contents;
  }

  const configCode = baseURL
    ? `    OpenGrow.configure(this, "${apiKey}", useTestEnvironment = ${useTestEnvironment}, baseURL = "${baseURL}")\n`
    : `    OpenGrow.configure(this, "${apiKey}", useTestEnvironment = ${useTestEnvironment})\n`;

  // Insert after super.onCreate()
  const superOnCreate = contents.indexOf('super.onCreate()');
  if (superOnCreate === -1) {
    return contents;
  }
  const endOfLine = contents.indexOf('\n', superOnCreate);
  return (
    contents.slice(0, endOfLine + 1) +
    '\n' +
    configCode +
    contents.slice(endOfLine + 1)
  );
}

function withOpenGrowMainApplication(config, props) {
  return withMainApplication(config, (config) => {
    if (config.modResults.language !== 'kt') {
      throw new Error(
        `${pkg.name} config plugin requires a Kotlin MainApplication. ` +
          'Java MainApplication is not supported.'
      );
    }

    let contents = config.modResults.contents;
    contents = addOpenGrowImportToMainApplication(contents);
    contents = addOpenGrowConfigure(contents, props);
    config.modResults.contents = contents;

    return config;
  });
}

function addOpenGrowImportToMainActivity(contents) {
  if (contents.includes('import io.opengrow.OpenGrow')) {
    return contents;
  }
  const lastImportIndex = contents.lastIndexOf('\nimport ');
  if (lastImportIndex === -1) {
    return `import io.opengrow.OpenGrow\n${contents}`;
  }
  const endOfLine = contents.indexOf('\n', lastImportIndex + 1);
  return (
    contents.slice(0, endOfLine) +
    '\nimport io.opengrow.OpenGrow' +
    contents.slice(endOfLine)
  );
}

function addOpenGrowIntentImport(contents) {
  if (contents.includes('import android.content.Intent')) {
    return contents;
  }
  const lastImportIndex = contents.lastIndexOf('\nimport ');
  if (lastImportIndex === -1) {
    return `import android.content.Intent\n${contents}`;
  }
  const endOfLine = contents.indexOf('\n', lastImportIndex + 1);
  return (
    contents.slice(0, endOfLine) +
    '\nimport android.content.Intent' +
    contents.slice(endOfLine)
  );
}

function addOpenGrowOnStart(contents) {
  if (contents.includes('OpenGrow.onStart')) {
    return contents;
  }

  const method = `
  override fun onStart() {
    super.onStart()
    OpenGrow.onStart(launcherActivity = this)
  }`;

  return insertBeforeClosingBrace(contents, method);
}

function addOpenGrowOnNewIntent(contents) {
  if (contents.includes('OpenGrow.onNewIntent')) {
    return contents;
  }

  const method = `
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    OpenGrow.onNewIntent(intent, launcherActivity = this)
  }`;

  return insertBeforeClosingBrace(contents, method);
}

function insertBeforeClosingBrace(contents, code) {
  const lastBrace = contents.lastIndexOf('}');
  if (lastBrace === -1) {
    return contents;
  }
  return contents.slice(0, lastBrace) + code + '\n' + contents.slice(lastBrace);
}

function withOpenGrowMainActivity(config) {
  return withMainActivity(config, (config) => {
    if (config.modResults.language !== 'kt') {
      throw new Error(
        `${pkg.name} config plugin requires a Kotlin MainActivity. ` +
          'Java MainActivity is not supported.'
      );
    }

    let contents = config.modResults.contents;
    contents = addOpenGrowImportToMainActivity(contents);
    contents = addOpenGrowIntentImport(contents);
    contents = addOpenGrowOnStart(contents);
    contents = addOpenGrowOnNewIntent(contents);
    config.modResults.contents = contents;

    return config;
  });
}

function withOpenGrowAndroid(config, props) {
  config = withOpenGrowManifest(config, props);
  config = withOpenGrowMainApplication(config, props);
  config = withOpenGrowMainActivity(config);
  config = withOpenGrowAppDependency(config);
  return config;
}

module.exports = withOpenGrowAndroid;

// Export helpers for testing
module.exports.addOpenGrowImportToMainApplication =
  addOpenGrowImportToMainApplication;
module.exports.addOpenGrowConfigure = addOpenGrowConfigure;
module.exports.addOpenGrowImportToMainActivity =
  addOpenGrowImportToMainActivity;
module.exports.addOpenGrowIntentImport = addOpenGrowIntentImport;
module.exports.addOpenGrowOnStart = addOpenGrowOnStart;
module.exports.addOpenGrowOnNewIntent = addOpenGrowOnNewIntent;
module.exports.addOpenGrowAppDependency = addOpenGrowAppDependency;
