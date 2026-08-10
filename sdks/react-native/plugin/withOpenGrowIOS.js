/* eslint-disable no-shadow */
const {
  withInfoPlist,
  withEntitlementsPlist,
  withAppDelegate,
} = require('expo/config-plugins');
const pkg = require('../package.json');

function withOpenGrowURLScheme(config, { scheme }) {
  return withInfoPlist(config, (config) => {
    if (!config.modResults.CFBundleURLTypes) {
      config.modResults.CFBundleURLTypes = [];
    }

    // Remove existing OpenGrow scheme entry to ensure idempotency
    config.modResults.CFBundleURLTypes =
      config.modResults.CFBundleURLTypes.filter(
        (entry) =>
          !(
            entry.CFBundleURLName === 'OpenGrow' ||
            entry.CFBundleURLSchemes?.includes(scheme)
          )
      );

    config.modResults.CFBundleURLTypes.push({
      CFBundleURLName: 'OpenGrow',
      CFBundleTypeRole: 'Editor',
      CFBundleURLSchemes: [scheme],
    });

    return config;
  });
}

function withOpenGrowAssociatedDomains(config, { associatedDomains }) {
  if (!associatedDomains || associatedDomains.length === 0) {
    return config;
  }

  return withEntitlementsPlist(config, (config) => {
    const existing =
      config.modResults['com.apple.developer.associated-domains'] || [];

    const opengrowDomains = associatedDomains.map((d) =>
      d.startsWith('applinks:') ? d : `applinks:${d}`
    );

    // Merge without duplicates
    const merged = [...new Set([...existing, ...opengrowDomains])];
    config.modResults['com.apple.developer.associated-domains'] = merged;

    return config;
  });
}

function addOpenGrowImport(contents) {
  if (contents.includes('import OpenGrow')) {
    return contents;
  }
  // Add after the last import statement
  const lastImportIndex = contents.lastIndexOf('\nimport ');
  if (lastImportIndex === -1) {
    return `import OpenGrow\n${contents}`;
  }
  const endOfLine = contents.indexOf('\n', lastImportIndex + 1);
  return (
    contents.slice(0, endOfLine) + '\nimport OpenGrow' + contents.slice(endOfLine)
  );
}

function addOpenGrowConfiguration(
  contents,
  { apiKey, useTestEnvironment, baseURL }
) {
  if (contents.includes('OpenGrow.configure')) {
    return contents;
  }

  const configLine = baseURL
    ? `OpenGrow.configure(APIKey: "${apiKey}", useTestEnvironment: ${useTestEnvironment}, baseURL: "${baseURL}", delegate: nil)`
    : `OpenGrow.configure(APIKey: "${apiKey}", useTestEnvironment: ${useTestEnvironment}, delegate: nil)`;

  // Run OpenGrow.configure synchronously AFTER super.application(_:didFinishLaunchingWithOptions:)
  // returns. Two constraints to satisfy at once:
  //   - The plugin's original behavior (inject `OpenGrow.configure(...)` BEFORE
  //     super.application) breaks the Expo dev launcher on Expo SDK 54: the
  //     launcher's window / rootViewController setup is interrupted, leaving
  //     the dev build at a black screen.
  //   - Deferring with `DispatchQueue.main.async` (so it runs on the next
  //     runloop tick) breaks the OpenGrow SDK's background NSURLSession: it must
  //     be initialised inside the original launch window, otherwise
  //     `generateLink` calls hang indefinitely (the completion handler is
  //     never invoked).
  // The resolution is to call configure SYNCHRONOUSLY but AFTER super has
  // returned — capture super's Bool result, run configure, then return.
  const target =
    'return super.application(application, didFinishLaunchingWithOptions: launchOptions)';
  if (contents.includes(target)) {
    const replacement =
      `let didFinishLaunchingResult = super.application(application, didFinishLaunchingWithOptions: launchOptions)\n` +
      `    ${configLine}\n` +
      `    return didFinishLaunchingResult`;
    return contents.replace(target, replacement);
  }

  return contents;
}

function addOpenGrowUniversalLinkHandler(contents) {
  if (contents.includes('OpenGrow.handleAppDelegate(continue:')) {
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
    const opengrowCall =
      '\n    if OpenGrow.handleAppDelegate(continue: userActivity, restorationHandler: restorationHandler) { return true }';
    return (
      contents.slice(0, insertPoint) + opengrowCall + contents.slice(insertPoint)
    );
  }

  const method = `
  override func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
    return OpenGrow.handleAppDelegate(continue: userActivity, restorationHandler: restorationHandler)
  }`;

  return insertBeforeClosingBrace(contents, method);
}

function addOpenGrowURLHandler(contents) {
  if (contents.includes('OpenGrow.handleAppDelegate(open:')) {
    return contents;
  }

  // Same rationale as above for the `open: url` method.
  const existingMethodRegex =
    /(public\s+override\s+func\s+application\([^)]*open\s+url:[^{]*\{)/;
  const m = contents.match(existingMethodRegex);
  if (m) {
    const insertPoint = m.index + m[0].length;
    const opengrowCall =
      '\n    if OpenGrow.handleAppDelegate(open: url, options: options) { return true }';
    return (
      contents.slice(0, insertPoint) + opengrowCall + contents.slice(insertPoint)
    );
  }

  const method = `
  override func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey : Any] = [:]) -> Bool {
    return OpenGrow.handleAppDelegate(open: url, options: options)
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
    const lastBrace = contents.lastIndexOf('}');
    if (lastBrace === -1) return contents;
    return (
      contents.slice(0, lastBrace) + code + '\n' + contents.slice(lastBrace)
    );
  }
  const openIdx = classMatch.index + classMatch[0].length - 1;
  let depth = 1;
  let i = openIdx + 1;
  while (i < contents.length && depth > 0) {
    const ch = contents[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) break;
    }
    i++;
  }
  if (depth !== 0) return contents;
  return contents.slice(0, i) + code + '\n' + contents.slice(i);
}

function withOpenGrowAppDelegate(config, props) {
  return withAppDelegate(config, (config) => {
    if (config.modResults.language !== 'swift') {
      throw new Error(
        `${pkg.name} config plugin requires a Swift AppDelegate. ` +
          'Objective-C AppDelegate is not supported.'
      );
    }

    let contents = config.modResults.contents;
    contents = addOpenGrowImport(contents);
    contents = addOpenGrowConfiguration(contents, props);
    contents = addOpenGrowUniversalLinkHandler(contents);
    contents = addOpenGrowURLHandler(contents);
    config.modResults.contents = contents;

    return config;
  });
}

function withOpenGrowIOS(config, props) {
  config = withOpenGrowURLScheme(config, props);
  config = withOpenGrowAssociatedDomains(config, props);
  config = withOpenGrowAppDelegate(config, props);
  return config;
}

module.exports = withOpenGrowIOS;

// Export helpers for testing
module.exports.addOpenGrowImport = addOpenGrowImport;
module.exports.addOpenGrowConfiguration = addOpenGrowConfiguration;
module.exports.addOpenGrowUniversalLinkHandler = addOpenGrowUniversalLinkHandler;
module.exports.addOpenGrowURLHandler = addOpenGrowURLHandler;
