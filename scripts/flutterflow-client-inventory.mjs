#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const expectedCounts = Object.freeze({
  pages: 23,
  components: 17,
  appState: 34,
  structs: 9,
  apiCalls: 9,
  actionBlocks: 6,
  appEvents: 4,
  customActions: 30,
  customFunctions: 7,
  customWidgets: 7,
});
const snapshotCountKeys = Object.freeze({
  pages: "pages",
  components: "components",
  appState: "appStateFields",
  structs: "dataStructs",
  apiCalls: "apiCallsReported",
  actionBlocks: "actionBlocks",
  appEvents: "appEventsReported",
  customActions: "customActions",
  customFunctions: "customFunctions",
  customWidgets: "customWidgets",
});
const expectedNames = Object.freeze({
  pages: [
    "index",
    "onboard00",
    "onboard01",
    "onboard02",
    "onboard03",
    "onboard04",
    "onboard05",
    "privacy_policy",
    "settings_language",
    "settings_support",
    "settings_ticket",
    "settings_user",
    "terms_of_use",
    "user_clone",
    "user_library",
    "user_link_account",
    "user_player_media",
    "user_record_audio",
    "user_record_text",
    "user_record_video",
    "user_sign_account",
    "user_upload",
    "user_vocals",
  ],
  components: [
    "ButtonLanguage",
    "ButtonSettings",
    "ButtonSettingsLarge",
    "CardCloneList",
    "CardHotReplay",
    "CardMediaList",
    "CardPaywall",
    "CardToken",
    "CardVocalList",
    "CardVocalMedia",
    "FeatureItem",
    "Header",
    "HeaderMedia",
    "HeaderOnBoarding",
    "InfoLibrary",
    "MenuBottom",
    "Paycreditv1",
  ],
  appState: [
    "appBoard",
    "appMenu",
    "appPaywall",
    "appQuestions",
    "appRefresh",
    "appReponse",
    "appUserMedias",
    "appUserVocals",
    "appVocals",
    "appWall",
    "authAccessToken",
    "authExpiresIn",
    "authRefreshToken",
    "authUserData",
    "authUserId",
    "lightMode",
    "opengrowPurchasesReady",
    "supportContactId",
    "supportConversationId",
    "supportMessages",
    "supportPubsubToken",
    "supportUnreadCount",
    "uploadProgress",
    "userBoardingProgress",
    "userBoardingView",
    "userCategories",
    "userCredits",
    "userDeviceID",
    "userFcmToken",
    "userHasMedia",
    "userHasVocals",
    "userPaywallView",
    "userPremium",
    "userVocals",
  ],
  structs: [
    "appBoard",
    "appCategory",
    "appPaywall",
    "appQuestion",
    "appSupportMessages",
    "appVocals",
    "user",
    "userMedias",
    "userVocals",
  ],
  apiCalls: [
    "Get App Board",
    "auth Logout",
    "get App Categories",
    "get App Questions",
    "get App Vocals",
    "get User Medias",
    "get User Vocals",
    "post User Media",
    "post User Vocals",
  ],
  actionBlocks: [
    "getAppOnBording",
    "getAppPaywall",
    "getAppVocals",
    "getUserMedia",
    "initUp",
    "paywallR1",
  ],
  appEvents: [
    "getAppDatabase",
    "getAppOnBoarding",
    "getAppPaywall",
    "getUserMedia",
  ],
  customActions: [
    "appCheckInternet",
    "appCheckMaintenance",
    "appCheckUpdate",
    "appGetPaywall",
    "initApp",
    "openGrowPaywall",
    "requestTrackingPermission",
    "signlinkWithApple",
    "signlinkWithGoogle",
    "supportFetchMessages",
    "supportInit",
    "supportSendMessage",
    "userAuthenticate",
    "userCleanManager",
    "userCreditsCheck",
    "userCreditsUpdate",
    "userCustomVocals",
    "userFCMToken",
    "userGetMe",
    "userHasMedias",
    "userHasVocals",
    "userMediaCleanLocal",
    "userMediaConverter",
    "userMediaIndex",
    "userMediaRemove",
    "userMediaUpload",
    "userRefreshAuth",
    "userUpdateMe",
    "wsSubscribe",
    "wsUnsubscribe",
  ],
  customFunctions: [
    "appBoard",
    "appCategories",
    "appQuestions",
    "appVocalsMix",
    "parseDate",
    "parseJson",
    "parseListString",
  ],
  customWidgets: [
    "AppBarProgress",
    "AppMediaPlayer",
    "AudioRecord",
    "CameraRecord",
    "CenteredScrollMenu",
    "SupportChatWidget",
    "TextArea",
  ],
});

export function validateFlutterFlowClientInventory({
  manifest,
  snapshot,
  migrationPlan,
  surface,
}) {
  validateDocument(manifest);
  if (manifest.application !== snapshot.application) {
    throw new Error(
      "Client inventory application does not match source snapshot",
    );
  }
  if (
    manifest.project.id !== snapshot.project?.id ||
    manifest.project.name !== snapshot.project?.name
  ) {
    throw new Error("Client inventory project does not match source snapshot");
  }

  const phases = new Set(migrationPlan.phases.map(({ id }) => id));
  const checks = new Set(snapshot.convergence.checks.map(({ id }) => id));
  const checkPhases = new Map();
  for (const item of migrationPlan.workItems) {
    for (const check of item.convergenceChecks)
      checkPhases.set(check, item.phase);
  }
  const symbols = publicSymbols(surface);
  const counts = {};
  const classifications = new Set();

  for (const [kind, groups] of Object.entries(manifest.inventory)) {
    const names = new Set();
    for (const group of groups) {
      classifications.add(group.classification);
      for (const name of group.names) {
        if (names.has(name))
          throw new Error(`Duplicate ${kind} inventory name: ${name}`);
        names.add(name);
      }
      if ((group.phase === null) !== (group.gate === null)) {
        throw new Error(
          `${kind}/${group.names[0]} must declare phase and gate together`,
        );
      }
      if (group.phase !== null && !phases.has(group.phase)) {
        throw new Error(
          `${kind}/${group.names[0]} uses unknown phase ${group.phase}`,
        );
      }
      if (group.gate !== null && !checks.has(group.gate)) {
        throw new Error(
          `${kind}/${group.names[0]} uses unknown gate ${group.gate}`,
        );
      }
      if (group.gate !== null && checkPhases.get(group.gate) !== group.phase) {
        throw new Error(
          `${kind}/${group.names[0]} maps gate ${group.gate} outside phase ${group.phase}`,
        );
      }
      for (const symbol of group.replacementSymbols) {
        if (!symbols.has(symbol)) {
          throw new Error(
            `${kind}/${group.names[0]} uses unknown replacement ${symbol}`,
          );
        }
      }
    }
    counts[kind] = names.size;
    if (names.size !== expectedCounts[kind]) {
      throw new Error(
        `Expected ${expectedCounts[kind]} ${kind}, found ${names.size}`,
      );
    }
    const snapshotCount = snapshot.inventory[snapshotCountKeys[kind]];
    if (snapshotCount !== names.size) {
      throw new Error(
        `Source snapshot declares ${snapshotCount} ${kind}, inventory has ${names.size}`,
      );
    }
    const missing = expectedNames[kind].filter((name) => !names.has(name));
    const unknown = [...names].filter(
      (name) => !expectedNames[kind].includes(name),
    );
    if (missing.length > 0 || unknown.length > 0) {
      throw new Error(
        `${kind} names differ from reviewed AS-IS (missing: ${missing.join(", ") || "none"}; unknown: ${unknown.join(", ") || "none"})`,
      );
    }
  }
  for (const required of ["common", "configurable", "vocostar", "remove"]) {
    if (!classifications.has(required)) {
      throw new Error(`Client inventory has no ${required} classification`);
    }
  }
  const persistedState = manifest.inventory.appState.reduce(
    (total, group) => total + (group.persisted ? group.names.length : 0),
    0,
  );
  if (persistedState !== 27) {
    throw new Error(
      `Expected 27 persisted App State fields, found ${persistedState}`,
    );
  }

  const historical = flattenNames(manifest.historicalRemoved.customActions);
  if (
    historical.size !== 2 ||
    !historical.has("userLoginRevenueCat") ||
    !historical.has("userSubscriptionActivate")
  ) {
    throw new Error(
      "Historical removed actions must be the two retired billing actions",
    );
  }
  const currentActions = new Set(
    flattenNames(manifest.inventory.customActions),
  );
  for (const name of historical) {
    if (currentActions.has(name))
      throw new Error(`Historical action is still AS-IS: ${name}`);
  }
  return {
    application: manifest.application,
    project: manifest.project,
    counts,
    classifications: [...classifications].sort(),
    gates: checks.size,
    currentCustomActions: currentActions.size,
    historicalRemovedActions: historical.size,
    appStatePersistence: {
      persisted: persistedState,
      transient: 34 - persistedState,
    },
    receiptStatus: manifest.receipt.currentStatus,
    dslStatus: manifest.dslTarget.status,
  };
}

export function loadAndValidateFlutterFlowClientInventory(manifestPath) {
  const manifest = json(resolve(manifestPath));
  return validateFlutterFlowClientInventory({
    manifest,
    snapshot: json(repositoryPath(manifest.sourceSnapshot)),
    migrationPlan: json(repositoryPath(manifest.migrationPlan)),
    surface: json(repositoryPath(manifest.surfaceManifest)),
  });
}

function validateDocument(manifest) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(
    json(repositoryPath("schemas/flutterflow-client-inventory.schema.json")),
  );
  if (validate(manifest)) return;
  throw new Error(
    `Invalid FlutterFlow client inventory: ${(validate.errors || [])
      .map(({ instancePath, message }) => `${instancePath || "/"} ${message}`)
      .join("; ")}`,
  );
}

function publicSymbols(surface) {
  return new Set([
    ...(surface.widgets || []),
    ...Object.values(surface.actions || {}).flat(),
    ...Object.values(surface.streams || {}).flat(),
  ]);
}

function flattenNames(groups) {
  return new Set(groups.flatMap(({ names }) => names));
}

function repositoryPath(relativePath) {
  const path = resolve(root, relativePath);
  if (!path.startsWith(`${root}${sep}`))
    throw new Error(`Path escapes repository: ${relativePath}`);
  return path;
}

function json(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main() {
  const index = process.argv.indexOf("--manifest");
  const manifestPath = index >= 0 ? process.argv[index + 1] : "";
  if (!manifestPath) throw new Error("--manifest is required");
  process.stdout.write(
    `${JSON.stringify(loadAndValidateFlutterFlowClientInventory(manifestPath), null, 2)}\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
