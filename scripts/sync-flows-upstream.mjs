#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const OUTPUT_ROOT = resolve(REPOSITORY_ROOT, "sdks/flows/upstream");
const MANIFEST_PATH = resolve(OUTPUT_ROOT, "manifest.json");

export const PINNED_SOURCES = Object.freeze({
  "flows-sh": Object.freeze({
    repository: "https://github.com/RBND-studio/flows.sh",
    commit: "fae014730865809c1406726b9d65417ec7155f00",
  }),
  "flows-sdk": Object.freeze({
    repository: "https://github.com/RBND-studio/flows-sdk",
    commit: "0b3a125bac9654cef003f93bbb79ae9ab6a952e8",
  }),
});

const TEXT_EXTENSIONS = new Set([
  "",
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mdx",
  ".mjs",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".yml",
  ".yaml",
]);

const SDK_PACKAGE_NAMES = Object.freeze({
  "@flows/js-components": "@superboard/flows-js-components",
  "@flows/react-components": "@superboard/flows-react-components",
  "@flows/shared": "@superboard/flows-shared",
  "@flows/styles": "@superboard/flows-styles",
  "@flows/react": "@superboard/flows-react",
  "@flows/js": "@superboard/flows-js",
});

const PRODUCT_PACKAGE_NAMES = Object.freeze({
  "@flows/styled-system": "@superboard/flows-styled-system",
  "@flows/types": "@superboard/flows-product-types",
});

const IGNORED_NAMES = new Set([
  ".DS_Store",
  ".git",
  ".gitignore",
  ".npmignore",
  "coverage",
  "dist",
  "node_modules",
  "package-lock.json",
  "pnpm-lock.yaml",
  "test-results",
]);

const REFERENCE_EXTENSIONS = new Set([
  ".css",
  ".gif",
  ".html",
  ".ico",
  ".jpeg",
  ".jpg",
  ".js",
  ".json",
  ".md",
  ".mdx",
  ".mjs",
  ".png",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".webp",
]);

const RETIRED_PRODUCT_PATHS = Object.freeze([
  "packages/icons/src/organization16.tsx",
  "packages/shared/src/billing.ts",
  "packages/types/src/billing.ts",
  "packages/types/src/organization.ts",
  "apps/docs/src/content/billing.mdx",
]);

function isRetiredProductPath(path) {
  return (
    RETIRED_PRODUCT_PATHS.includes(path) ||
    path.startsWith("apps/docs/src/content/organization-setup/") ||
    path.startsWith("apps/docs/public/organization-setup/")
  );
}

function parseArguments(argv) {
  const options = { check: false, verifySources: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      options.check = true;
      continue;
    }
    if (argument === "--verify-sources") {
      options.verifySources = true;
      continue;
    }
    if (argument === "--flows-sh-source" || argument === "--flows-sdk-source") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a path`);
      options[argument === "--flows-sh-source" ? "flowsShSource" : "flowsSdkSource"] = resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function posixPath(value) {
  return value.split(sep).join("/");
}

function listFiles(root, predicate = () => true) {
  const output = [];
  const visit = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      if (IGNORED_NAMES.has(name)) continue;
      const absolutePath = join(directory, name);
      const metadata = statSync(absolutePath);
      if (metadata.isDirectory()) {
        visit(absolutePath);
      } else {
        const path = posixPath(relative(root, absolutePath));
        if (predicate(path, name)) output.push(path);
      }
    }
  };
  if (existsSync(root)) visit(root);
  return output;
}

function assertPinnedCheckout(sourceKey, sourceDirectory) {
  if (!sourceDirectory || !existsSync(sourceDirectory)) {
    throw new Error(`Missing local checkout for ${sourceKey}`);
  }
  const expected = PINNED_SOURCES[sourceKey].commit;
  const actual = execFileSync("git", ["-C", sourceDirectory, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (actual !== expected) {
    throw new Error(`${sourceKey} must be checked out at ${expected}; found ${actual}`);
  }
  const status = execFileSync(
    "git",
    ["-C", sourceDirectory, "status", "--porcelain", "--untracked-files=all"],
    { encoding: "utf8" },
  ).trim();
  if (status) {
    throw new Error(`${sourceKey} checkout is not clean; refusing a non-reproducible import`);
  }
}

function isTextFile(path) {
  return TEXT_EXTENSIONS.has(extname(path).toLowerCase());
}

function replacePackageNames(value, names) {
  let output = value;
  for (const [upstream, local] of Object.entries(names)) {
    output = output.replaceAll(upstream, local);
  }
  return output;
}

function transformPackageJson(sourceKey, destinationPath, text) {
  const value = JSON.parse(text);
  const replaceDependencies = (dependencies) => {
    if (!dependencies) return;
    for (const [name, version] of Object.entries(dependencies)) {
      const mappedName =
        sourceKey === "flows-sdk"
          ? (SDK_PACKAGE_NAMES[name] ?? name)
          : (PRODUCT_PACKAGE_NAMES[name] ?? (name === "icons" ? "@superboard/flows-icons" : name));
      if (mappedName !== name) {
        delete dependencies[name];
        dependencies[mappedName] = version === "workspace:*" ? "*" : version;
      } else if (version === "workspace:*") {
        dependencies[name] = "*";
      }
    }
  };

  if (sourceKey === "flows-sdk") {
    value.name = SDK_PACKAGE_NAMES[value.name] ?? value.name;
  } else if (destinationPath.startsWith("product/types/")) {
    value.name = "@superboard/flows-product-types";
  } else if (destinationPath.startsWith("product/shared/")) {
    value.name = "@superboard/flows-product-shared";
  } else if (destinationPath.startsWith("product/icons/")) {
    value.name = "@superboard/flows-icons";
  } else if (destinationPath.startsWith("product/ui/")) {
    value.name = "@superboard/flows-ui";
  }

  value.license = "MIT";

  replaceDependencies(value.dependencies);
  replaceDependencies(value.devDependencies);
  replaceDependencies(value.peerDependencies);
  replaceDependencies(value.optionalDependencies);
  delete value.homepage;
  delete value.bugs;
  delete value.repository;
  if (value.scripts) {
    delete value.scripts.prepare;
    if (value.scripts.tsc) value.scripts.typecheck = "tsc --noEmit -p tsconfig.json";
  }
  return `${JSON.stringify(value, null, 2)}\n`;
}

function addApiHelpers(text) {
  const marker = "const getFetch =";
  if (!text.includes(marker)) throw new Error("The pinned SDK API module no longer matches its reviewed shape");
  const helpers = `export const DEFAULT_API_URL = "/api/v1/flows";

export const getDefaultApiUrl = (): string => DEFAULT_API_URL;

export const joinApiUrl = (baseUrl: string, path: string): string => {
  const normalizedBase = baseUrl.replace(/\\/+$/u, "");
  const normalizedPath = path.replace(/^\\/+/u, "");
  return \`\${normalizedBase}/\${normalizedPath}\`;
};

export const getWebSocketUrl = (
  baseUrl: string,
  path: string,
  params: Record<string, string>,
): string => {
  const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const url = new URL(joinApiUrl(baseUrl, path), origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.search = new URLSearchParams(params).toString();
  return url.toString();
};

export const FLOW_SDK_KEY_HEADER = "x-superboard-flows-sdk-key";

/** Add the environment credential at the shared transport boundary. */
export const withSdkKey = (
  customFetch: CustomFetch | undefined,
  sdkKey: string | undefined,
): CustomFetch | undefined => {
  const credential = sdkKey?.trim();
  if (!credential) return customFetch;
  const fetchFn = customFetch ?? globalThis.fetch.bind(globalThis);
  return (input, init) => {
    const headers = new Headers(init?.headers);
    if (!headers.has(FLOW_SDK_KEY_HEADER)) headers.set(FLOW_SDK_KEY_HEADER, credential);
    return fetchFn(input, { ...init, headers });
  };
};

`;
  return text
    .replace(marker, `${helpers}${marker}`)
    .replace("new URL(url, ctx.baseUrl).toString()", "joinApiUrl(ctx.baseUrl, url)");
}

function transformSdkRuntime(destinationPath, text) {
  let output = text;
  if (destinationPath === "packages/shared/src/api.ts") output = addApiHelpers(output);

  if (destinationPath === "packages/shared/src/api.ts") {
    output = output
      .replace(
        "  blockId?: string;\n  blockKey?: string;",
        "  blockId?: string;\n  blockStateId?: string;\n  blockKey?: string;",
      )
      .replace(
        "{ body, method, version }: { method?: string; body?: unknown; version: string },",
        `{ body, method, version, idempotencyKey }: {
      method?: string;
      body?: unknown;
      version: string;
      idempotencyKey?: string;
    },`,
      )
      .replace(
        '        "x-flows-version": version,',
        `        "x-flows-version": version,
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),`,
      )
      .replace(
        '    sendEvent: (body: EventRequest) => f("/v2/sdk/events", { method: "POST", body, version }),',
        `    sendEvent: (body: EventRequest, idempotencyKey?: string) =>
      f("/v2/sdk/events", { method: "POST", body, version, idempotencyKey }),`,
      )
      .replace(
        '    postSurvey: (body: ApiSurveyAnswer) => f("/v2/sdk/survey", { method: "POST", body, version }),',
        `    postSurvey: (body: ApiSurveyAnswer, idempotencyKey?: string) =>
      f("/v2/sdk/survey", { method: "POST", body, version, idempotencyKey }),`,
      );
  }

  if (destinationPath === "packages/shared/src/event-queue.ts") {
    output = output
      .replace(
        `type EnqueueEventProps = Omit<EventQueueItem, "id"> & {
  customFetch?: CustomFetch;
};`,
        `type EnqueueEventProps = Omit<EventQueueItem, "id"> & {
  customFetch?: CustomFetch;
  idempotencyKey?: string;
};`,
      )
      .replace(
        `  customFetch,
  ...serializableData`,
        `  customFetch,
  idempotencyKey,
  ...serializableData`,
      )
      .replace("    id: crypto.randomUUID(),", "    id: idempotencyKey ?? crypto.randomUUID(),")
      .replace(".sendEvent(item.event)", ".sendEvent(item.event, item.id)")
      .replace(
        `        .catch((err) => {
          log.error("Failed to send event, will retry later", err);
        });`,
        `        .catch((err) => {
          log.error("Failed to send event, will retry later", err);
          return false;
        });
      if (sent === false) break;`,
      )
      .replace(
        `      await getApi({ ...item.apiContext, customFetch })`,
        `      const sent = await getApi({ ...item.apiContext, customFetch })`,
      )
      .replace(
        `        .then(() => {
          removeFromLocalStorageQueue(item.id);
        })`,
        `        .then(() => {
          removeFromLocalStorageQueue(item.id);
          return true;
        })`,
      )
      .replace(
        `const addToLocalStorageQueue = (data: EventQueueItem): void => {
  setLocalStorageQueue((previousValue) => [...previousValue, data]);
};`,
        `const addToLocalStorageQueue = (data: EventQueueItem): void => {
  setLocalStorageQueue((previousValue) =>
    previousValue.some((item) => item.id === data.id) ? previousValue : [...previousValue, data],
  );
};`,
      );
  }

  if (destinationPath === "packages/shared/src/types/active-block.ts") {
    output = output
      .replace(
        `  id: string;
  /**`,
        `  id: string;
  /** Unique runtime state for this activation cycle. */
  blockStateId?: string;
  /**`,
      )
      .replace(
        "  sendActivate: (blockId: string) => Promise<void>,",
        "  sendActivate: (blockId: string, blockStateId?: string) => Promise<void>,",
      )
      .replace(
        '      if (prop === "props") void sendActivate(block.id);',
        '      if (prop === "props") void sendActivate(block.id, block.blockStateId);',
      );
  }

  if (
    destinationPath === "packages/react/src/lib/active-block.ts" ||
    destinationPath === "packages/js/src/lib/active-block.ts"
  ) {
    output = output
      .replaceAll(
        `    id: block.id,
    type: block.type,`,
        `    id: block.id,
    blockStateId: block.blockStateId,
    type: block.type,`,
      )
      .replaceAll(
        `    id: block.id,
    type: "component",`,
        `    id: block.id,
    blockStateId: block.blockStateId,
    type: "component",`,
      )
      .replaceAll(
        `    id: block.id,
    type: "survey",`,
        `    id: block.id,
    blockStateId: block.blockStateId,
    type: "survey",`,
      )
      .replaceAll(
        `    id: activeStep.id,
    tourBlockId: tour.block.id,`,
        `    id: activeStep.id,
    blockStateId: tour.block.blockStateId,
    tourBlockId: tour.block.id,`,
      )
      .replaceAll(
        `    id: activeStep.id,
    tourBlockId: block.id,`,
        `    id: activeStep.id,
    blockStateId: block.blockStateId,
    tourBlockId: block.id,`,
      );
    output = output.replaceAll(
      'exitNodeCb: ({ key, blockId }) => sendEvent({ name: "transition", blockId, propertyKey: key }),',
      'exitNodeCb: ({ key, blockId }) => sendEvent({ name: "transition", blockId, blockStateId: block.blockStateId, propertyKey: key }),',
    );
    if (destinationPath === "packages/react/src/lib/active-block.ts") {
      output = output
        .replace(
          "const getSetStateMemory = (updateBlock: UpdateBlock): SetStateMemory => {",
          "const getSetStateMemory = (updateBlock: UpdateBlock, blockStateId?: string): SetStateMemory => {",
        )
        .replace(
          `      blockId,
      propertyKey: key,`,
          `      blockId,
      blockStateId,
      propertyKey: key,`,
        )
        .replaceAll(
          "const setStateMemory = getSetStateMemory(updateBlock);",
          "const setStateMemory = getSetStateMemory(updateBlock, block.blockStateId);",
        );
    } else {
      output = output
        .replace(
          'import { removeBlock, updateBlock } from "../store";',
          'import { blocks, removeBlock, updateBlock } from "../store";',
        )
        .replace(
          `    blockId,
    propertyKey: key,`,
          `    blockId,
    blockStateId: blocks.peek()?.find((block) => block.id === blockId)?.blockStateId,
    propertyKey: key,`,
        )
        .replace("cancelTour(block.id);", "cancelTour(block);");
    }
  }

  if (
    destinationPath === "packages/react/src/lib/api.ts" ||
    destinationPath === "packages/js/src/lib/api.ts"
  ) {
    output = output
      .replace(
        "export const sendEvent = async (props: SendEventProps): Promise<void> => {",
        "export const sendEvent = async (props: SendEventProps, idempotencyKey?: string): Promise<void> => {",
      )
      .replace(
        `    customFetch,
    event: {`,
        `    customFetch,
    idempotencyKey,
    event: {`,
      )
      .replace(
        `    url: window.location.href,
  });`,
        `    url: window.location.href,
  }, \`survey:\${props.blockStateId}\`);`,
      )
      .replace(
        `const activatedBlockIds = new Set<string>();
export const sendActivate = async (blockId: string): Promise<void> => {
  if (activatedBlockIds.has(blockId)) return;

  activatedBlockIds.add(blockId);
  await sendEvent({ name: "block-activated", blockId });
};`,
        `const activatedBlockStates = new Set<string>();
export const sendActivate = async (blockId: string, blockStateId?: string): Promise<void> => {
  const activationState = blockStateId ? \`\${blockStateId}:\${blockId}\` : blockId;
  if (activatedBlockStates.has(activationState)) return;

  activatedBlockStates.add(activationState);
  try {
    await sendEvent(
      { name: "block-activated", blockId },
      blockStateId ? \`activation:\${activationState}\` : undefined,
    );
  } catch (error) {
    activatedBlockStates.delete(activationState);
    throw error;
  }
};`,
      );
    if (destinationPath === "packages/js/src/lib/api.ts") {
      output = output.replace(
        '"name" | "blockId" | "blockKey" | "propertyKey" | "properties" | "workflowId"',
        '"name" | "blockId" | "blockStateId" | "blockKey" | "propertyKey" | "properties" | "workflowId"',
      );
    }
    output = output.replace(
      '{ name: "block-activated", blockId },',
      '{ name: "block-activated", blockId, blockStateId },',
    );
  }

  if (destinationPath === "packages/js/src/lib/tour.ts") {
    output = output
      .replaceAll(
        `    blockId: tourBlock.id,
    properties:`,
        `    blockId: tourBlock.id,
    blockStateId: tourBlock.blockStateId,
    properties:`,
      )
      .replaceAll(
        '{ name: "transition", blockId: tourBlock.id, propertyKey: "complete" }',
        '{ name: "transition", blockId: tourBlock.id, blockStateId: tourBlock.blockStateId, propertyKey: "complete" }',
      )
      .replace(
        "export const cancelTour = (tourBlockId: string): void => {\n  removeBlock(tourBlockId);\n  void sendEvent({ name: \"transition\", blockId: tourBlockId, propertyKey: \"cancel\" });\n};",
        "export const cancelTour = (tourBlock: Block): void => {\n  removeBlock(tourBlock.id);\n  void sendEvent({ name: \"transition\", blockId: tourBlock.id, blockStateId: tourBlock.blockStateId, propertyKey: \"cancel\" });\n};",
      )
      .replace("cancelTour(block.id);", "cancelTour(block);");
  }

  if (destinationPath === "packages/react/src/hooks/use-running-tours.ts") {
    output = output
      .replaceAll(
        '{ name: "tour-update", blockId, properties:',
        '{ name: "tour-update", blockId, blockStateId: block.blockStateId, properties:',
      )
      .replaceAll(
        '{ name: "transition", propertyKey: "complete", blockId }',
        '{ name: "transition", propertyKey: "complete", blockId, blockStateId: block.blockStateId }',
      )
      .replaceAll(
        '{ name: "transition", blockId, propertyKey: "cancel" }',
        '{ name: "transition", blockId, blockStateId: block.blockStateId, propertyKey: "cancel" }',
      );
  }

  if (destinationPath === "packages/js/src/init.ts") {
    output = output
      .replace(
        'import { getPathname, sendEvents } from "@superboard/flows-shared";',
        'import { getDefaultApiUrl, getPathname, sendEvents, withSdkKey } from "@superboard/flows-shared";',
      )
      .replace(
        'const apiUrl = options.apiUrl ?? "https://api.flows-cloud.com";',
        "const apiUrl = options.apiUrl ?? getDefaultApiUrl();\n  const customFetch = withSdkKey(options.customFetch, options.sdkKey);",
      )
      .replace(
        "config.value = { ...options, apiUrl };",
        "config.value = { ...options, apiUrl, customFetch };",
      )
      .replace("sendEvents(options.customFetch)", "sendEvents(customFetch)");
  }

  if (destinationPath === "packages/js/src/types/configuration.ts") {
    output = output.replace(
      "  apiUrl?: string;",
      `  apiUrl?: string;
  /** Environment SDK key. */
  sdkKey?: string;`,
    );
  }

  if (destinationPath === "packages/react/src/flows-provider.tsx") {
    output = output
      .replace(
        "  logBranding,",
        "  getDefaultApiUrl,\n  logBranding,\n  withSdkKey,",
      )
      .replace(
        "useCallback, useEffect, type FC, type ReactNode",
        "useCallback, useEffect, useMemo, type FC, type ReactNode",
      )
      .replace(
        'apiUrl = "https://api.flows-cloud.com",',
        "apiUrl = getDefaultApiUrl(),",
      )
      .replace(
        "  organizationId: string;",
        `  organizationId: string;
  /** Environment SDK key. */
  sdkKey?: string;`,
      )
      .replace(
        "  organizationId,\n  userId,",
        "  organizationId,\n  sdkKey,\n  userId,",
      )
      .replace(
        "  globalConfig.apiUrl = apiUrl;",
        `  const authenticatedFetch = useMemo(
    () => withSdkKey(customFetch, sdkKey),
    [customFetch, sdkKey],
  );

  globalConfig.apiUrl = apiUrl;`,
      )
      .replace(
        "  globalConfig.customFetch = customFetch;",
        "  globalConfig.customFetch = authenticatedFetch;",
      )
      .replace(
        "    language,\n    customFetch,\n    onAfterLoad,",
        "    language,\n    sdkKey,\n    customFetch: authenticatedFetch,\n    onAfterLoad,",
      )
      .replace("// Log a \"Powered by Flows\" message in the console for free orgs", "// Preserve the upstream free-plan hook without injecting vendor branding")
      .replace(" * Object with custom [user properties](https://flows.sh/docs/users/properties).", " * Object with custom user properties.")
      .replace(" * Language used to enable [localization](https://flows.sh/docs/localization).", " * Language used to enable localization.");
  }

  if (destinationPath === "packages/js/src/store.ts") {
    output = output.replace(
      "// Log a \"Powered by Flows\" message in the console for free orgs",
      "// Preserve the upstream free-plan hook without injecting vendor branding",
    );
  }

  if (destinationPath === "packages/js/src/lib/blocks.ts") {
    output = output
      .replace("  getApi,", "  getApi,\n  getWebSocketUrl,")
      .replace(
        `  const wsUrl = (() => {
    const wsBase = apiUrl.replace("https://", "wss://").replace("http://", "ws://");
    return \`\${wsBase}/ws/sdk/block-updates?\${new URLSearchParams(params).toString()}\`;
  })();`,
        '  const wsUrl = getWebSocketUrl(apiUrl, "/ws/sdk/block-updates", params);',
      )
      .replace(
        "  const { environment, organizationId, userId, apiUrl, customFetch } = configuration;",
        "  const { environment, organizationId, userId, apiUrl, customFetch, sdkKey } = configuration;",
      )
      .replace(
        '  const wsUrl = getWebSocketUrl(apiUrl, "/ws/sdk/block-updates", params);',
        `  const wsUrl = getWebSocketUrl(apiUrl, "/ws/sdk/block-updates", {
    ...params,
    ...(sdkKey ? { sdkKey } : {}),
  });`,
      )
      .replace(
        "  const websocketResult = websocket({ url: wsUrl, onMessage, onOpen: fetchBlocks });",
        `  let firstWebSocketOpen = true;
  const handleWebSocketOpen = (): void => {
    if (firstWebSocketOpen) {
      firstWebSocketOpen = false;
      return;
    }
    fetchBlocks();
  };

  fetchBlocks();
  const websocketResult = websocket({ url: wsUrl, onMessage, onOpen: handleWebSocketOpen });`,
      );
  }

  if (destinationPath === "packages/react/src/hooks/use-blocks.ts") {
    output = output
      .replace("  getApi,", "  getApi,\n  getWebSocketUrl,")
      .replace(
        `    const baseUrl = apiUrl.replace("https://", "wss://").replace("http://", "ws://");
    return \`\${baseUrl}/ws/sdk/block-updates?\${new URLSearchParams(params).toString()}\`;`,
        '    return getWebSocketUrl(apiUrl, "/ws/sdk/block-updates", params);',
      )
      .replace(
        "  organizationId: string;",
        "  organizationId: string;\n  sdkKey?: string;",
      )
      .replace(
        "  organizationId,\n  userId,",
        "  organizationId,\n  sdkKey,\n  userId,",
      )
      .replace(
        '    return getWebSocketUrl(apiUrl, "/ws/sdk/block-updates", params);',
        `    return getWebSocketUrl(apiUrl, "/ws/sdk/block-updates", {
      ...params,
      ...(sdkKey ? { sdkKey } : {}),
    });`,
      )
      .replace(
        "  }, [apiUrl, params, usageLimited]);",
        "  }, [apiUrl, params, sdkKey, usageLimited]);",
      )
      .replace(
        "  // Refetch blocks when userProperties change",
        `  // HTTP block loading is independent from realtime availability. A failed WebSocket
  // must not prevent the initial experience from rendering.
  useEffect(() => {
    fetchBlocks();
  }, [fetchBlocks]);

  // Refetch blocks when userProperties change`,
      )
      .replace(
        "  const { error: wsError } = useWebsocket({ url: websocketUrl, onMessage, onOpen: fetchBlocks });",
        `  const firstWebSocketOpenRef = useRef(true);
  useEffect(() => {
    firstWebSocketOpenRef.current = true;
  }, [websocketUrl]);
  const handleWebSocketOpen = useCallback(() => {
    if (firstWebSocketOpenRef.current) {
      firstWebSocketOpenRef.current = false;
      return;
    }
    fetchBlocks();
  }, [fetchBlocks]);
  const { error: wsError } = useWebsocket({
    url: websocketUrl,
    onMessage,
    onOpen: handleWebSocketOpen,
  });`,
      );
  }

  if (destinationPath === "packages/shared/src/blocks/blocks.spec.ts") {
    output += `

describe("SuperBoard SDK transport authentication", () => {
  it("merges the rotatable SDK key without discarding caller headers", async () => {
    const { FLOW_SDK_KEY_HEADER, withSdkKey } = await import("../api");
    let captured = new Headers();
    const target = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = new Headers(init?.headers);
      return {} as Response;
    }) as typeof fetch;
    const authenticated = withSdkKey(target, "environment-secret");

    await authenticated?.("https://example.test/v2/sdk/blocks", {
      headers: { "x-customer-header": "preserved" },
    });

    expect(captured.get(FLOW_SDK_KEY_HEADER)).toBe("environment-secret");
    expect(captured.get("x-customer-header")).toBe("preserved");
  });
});
`;
  }

  if (destinationPath === "packages/shared/src/blocks/blocks.spec.ts") {
    output += `

describe("SuperBoard SDK event idempotency", () => {
  const response = (body: string, status: number): Response =>
    ({
      ok: status >= 200 && status < 300,
      status,
      statusText: status >= 200 && status < 300 ? "OK" : "Unavailable",
      text: async () => body,
    }) as Response;

  it("reuses the durable queue item id across a failed request and its retry", async () => {
    const { enqueueEvent, sendEvents } = await import("../event-queue");
    const attempts: string[] = [];
    let requestNumber = 0;
    const target = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestNumber += 1;
      attempts.push(new Headers(init?.headers).get("Idempotency-Key") ?? "");
      return response(
        requestNumber === 1 ? "{\\\"message\\\":\\\"retry\\\"}" : "{}",
        requestNumber === 1 ? 503 : 200,
      );
    }) as typeof fetch;
    const event = {
      userId: "user-1",
      environment: "test",
      projectId: "project-1",
      name: "workflow-start" as const,
      workflowId: "workflow-1",
    };

    await enqueueEvent({
      event,
      apiContext: { apiUrl: "/api/v1/flows", version: "test" },
      customFetch: target,
    });
    await sendEvents(target);

    expect(attempts).toHaveLength(2);
    expect(attempts[0]).not.toBe("");
    expect(attempts[1]).toBe(attempts[0]);
  });

  it("keeps command order by stopping at the first failed event", async () => {
    const { enqueueEvent, sendEvents } = await import("../event-queue");
    localStorage.removeItem("flows-events-queue");
    const attempts: string[] = [];
    let available = false;
    const target = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { workflowId?: string };
      attempts.push(body.workflowId ?? "");
      return response(available ? "{}" : "{\\\"message\\\":\\\"retry\\\"}", available ? 200 : 503);
    }) as typeof fetch;
    const context = { apiUrl: "/api/v1/flows", version: "test" };

    await enqueueEvent({
      event: {
        userId: "user-1",
        environment: "test",
        projectId: "project-1",
        name: "workflow-start",
        workflowId: "workflow-a",
      },
      apiContext: context,
      customFetch: target,
    });
    await enqueueEvent({
      event: {
        userId: "user-1",
        environment: "test",
        projectId: "project-1",
        name: "workflow-start",
        workflowId: "workflow-b",
      },
      apiContext: context,
      customFetch: target,
    });

    expect(attempts).toEqual(["workflow-a", "workflow-a"]);
    available = true;
    await sendEvents(target);
    expect(attempts).toEqual(["workflow-a", "workflow-a", "workflow-a", "workflow-b"]);
  });

  it("uses the survey block state as the stable submission key", async () => {
    const { getApi } = await import("../api");
    const keys: string[] = [];
    const target = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      keys.push(new Headers(init?.headers).get("Idempotency-Key") ?? "");
      return response("{}", 200);
    }) as typeof fetch;
    const answer = {
      userId: "user-1",
      environment: "test",
      projectId: "project-1",
      surveyId: "survey-1",
      blockStateId: "survey-state-1",
      questions: [],
      url: "https://example.test",
    };

    await getApi({ apiUrl: "/api/v1/flows", version: "test", customFetch: target })
      .postSurvey(answer, answer.blockStateId);
    await getApi({ apiUrl: "/api/v1/flows", version: "test", customFetch: target })
      .postSurvey(answer, answer.blockStateId);

    expect(keys).toEqual(["survey-state-1", "survey-state-1"]);
  });

  it("deduplicates activations by runtime block state instead of block definition", async () => {
    const { createActiveBlockProxy } = await import("../types/active-block");
    const activations: string[] = [];
    const makeBlock = (blockStateId: string) => ({
      id: "shared-definition",
      blockStateId,
      workflowId: "workflow-1",
      type: "component" as const,
      component: "Card",
      props: {
        __flows: {
          id: "shared-definition",
          workflowId: "workflow-1",
          legacyBranding: false,
        },
      },
    });
    const activate = async (_blockId: string, blockStateId?: string) => {
      activations.push(blockStateId ?? "");
    };

    void createActiveBlockProxy(makeBlock("state-1"), activate).props;
    void createActiveBlockProxy(makeBlock("state-2"), activate).props;

    expect(activations).toEqual(["state-1", "state-2"]);
  });
});
`;
  }

  if (destinationPath === "packages/shared/src/debug.ts") {
    output = output
      .replace(
        'export const dashboardLink = (organizationId: string): string =>\n  `https://app.flows.sh/org/${organizationId}`;',
        'export const dashboardLink = (organizationId: string): string =>\n  `/flows?project=${encodeURIComponent(organizationId)}`;',
      )
      .replace(
        'export const docsLink = "https://flows.sh/docs/sdk-overview#debug-mode";',
        'export const docsLink = "/flows/settings/sdk#debug-mode";',
      );
  }

  if (destinationPath === "packages/shared/src/log.ts") {
    output = output.replace(
      "export const logBranding = () => {\n  log.info(`Product adoption powered by https://flows.sh`);\n};",
      "export const logBranding = (): void => {\n  // Branding is controlled by the SuperBoard host application.\n};",
    );
  }

  if (destinationPath === "packages/js-components/src/internal-components/branding.ts") {
    output = `import type { TemplateResult } from "lit";
import { html } from "lit";

type Props = {
  className?: string;
  component: string;
};

/** Branding is owned by the SuperBoard host and is never injected by the SDK. */
export const Branding = (_props: Props): TemplateResult => html\`\`;
`;
  }

  if (destinationPath === "packages/react-components/src/internal-components/branding.tsx") {
    output = `import type { FC } from "react";

type Props = {
  className?: string;
  component: string;
};

/** Branding is owned by the SuperBoard host and is never injected by the SDK. */
export const Branding: FC<Props> = () => null;
`;
  }

  if (destinationPath.startsWith("tests/e2e/")) {
    output = output
      .replaceAll("https://api.flows-cloud.com", "http://localhost:3000/api/v1/flows")
      .replaceAll("https://app.flows.sh", "http://localhost:3000/flows")
      .replaceAll('url.pathname === "/ws/sdk/block-updates"', 'url.pathname === "/api/v1/flows/ws/sdk/block-updates"')
      .replaceAll("@flows\\/", "@superboard\\/flows-")
      .replaceAll('.startsWith("@flows/")', '.startsWith("@superboard/flows-")')
      .replaceAll(
        '"https://flows.sh/docs/sdk-overview#debug-mode"',
        '"/flows/settings/sdk#debug-mode"',
      )
      .replaceAll(
        '`http://localhost:3000/flows/org/${organizationId}`',
        '`/flows?project=${encodeURIComponent(organizationId)}`',
      );

    if (destinationPath.includes("tests/e2e/tests/components/")) {
      output = output
        .replaceAll(" - should show branding with free org", " - should not inject upstream branding")
        .replaceAll(
          'await expect(page.locator(".flows_basicsV2_card_branding_no_buttons")).toBeVisible();',
          'await expect(page.locator(".flows_basicsV2_card_branding_no_buttons")).toHaveCount(0);',
        )
        .replaceAll(
          'await expect(page.locator(".flows_basicsV2_card_branding_tour")).toBeVisible();',
          'await expect(page.locator(".flows_basicsV2_card_branding_tour")).toHaveCount(0);',
        )
        .replaceAll(
          'await expect(page.locator(".flows_basicsV2_floating_checklist_branding")).toBeVisible();',
          'await expect(page.locator(".flows_basicsV2_floating_checklist_branding")).toHaveCount(0);',
        )
        .replaceAll(
          'await expect(page.locator(".flows_basicsV2_tooltip_branding")).toBeVisible();',
          'await expect(page.locator(".flows_basicsV2_tooltip_branding")).toHaveCount(0);',
        )
        .replaceAll(
          'await expect(page.locator(".flows_basicsV2_modal_branding")).toBeVisible();',
          'await expect(page.locator(".flows_basicsV2_modal_branding")).toHaveCount(0);',
        )
        .replaceAll(
          'await expect(page.locator(".flows_basicsV2_survey_popover_branding")).toBeVisible();',
          'await expect(page.locator(".flows_basicsV2_survey_popover_branding")).toHaveCount(0);',
        );
    }

    if (
      destinationPath === "tests/e2e/tests/debug.spec.ts" ||
      destinationPath === "tests/e2e/tests/components/custom-component.spec.ts"
    ) {
      const insertionMarker =
        destinationPath === "tests/e2e/tests/debug.spec.ts"
          ? "const organizationId = randomUUID();"
          : "const getBlock =";
      const websocketSetup = `test.beforeEach(async ({ page }) => {
  await page.routeWebSocket(
    (url) => url.pathname === "/api/v1/flows/ws/sdk/block-updates",
    () => {},
  );
});

`;
      if (destinationPath === "tests/e2e/tests/debug.spec.ts") {
        output = output.replace(insertionMarker, `${insertionMarker}\n\n${websocketSetup.trimEnd()}`);
      } else {
        output = output.replace(insertionMarker, `${websocketSetup}${insertionMarker}`);
      }
    }

    if (destinationPath === "tests/e2e/tests/components/custom-component.spec.ts") {
      output = output
        .replace(
          " - should hide custom component outside of localhost",
          " - should render custom component outside localhost in observe mode",
        )
        .replace(
          'await expect(page.locator(".flows_basicsV2_modal_modal")).toBeHidden();',
          'await expect(page.locator(".flows_basicsV2_modal_modal")).toBeVisible();',
        );
    }

    if (destinationPath === "tests/e2e/tests/link.spec.ts") {
      output = output.replace(
        `    await page.getByText("Go to another page", { exact: true }).click();
    await expect(page).toHaveURL(\`https://example.com\`);`,
        `    const externalLink = page.getByRole("link", { name: "Go to another page" });
    await expect(externalLink).toHaveAttribute("href", "https://example.com");
    await expect(externalLink).not.toHaveAttribute("target", "_blank");`,
      );
    }

    if (destinationPath === "tests/e2e/tests/websocket.spec.ts") {
      output = output.replace(
        `      const wsPromise = page.waitForEvent("websocket");
      await page.goto(\`/\${packageName}.html\`);
      await wsPromise;

      await page.waitForRequest((req) => {
        return req.url() === "http://localhost:3000/api/v1/flows/v2/sdk/blocks";
      });`,
        `      const wsPromise = page.waitForEvent("websocket");
      const blocksPromise = page.waitForRequest((req) => {
        return req.url() === "http://localhost:3000/api/v1/flows/v2/sdk/blocks";
      });
      await page.goto(\`/\${packageName}.html\`);
      await Promise.all([wsPromise, blocksPromise]);`,
      );
    }

    if (destinationPath === "tests/e2e/tests/utils.ts") {
      output = output.replace(
        `): Promise<void> => {\n  await page.route("**/v2/sdk/blocks", async (route) => {`,
        `): Promise<void> => {\n  await page.unroute("**/v2/sdk/blocks");\n  await page.route("**/v2/sdk/blocks", async (route) => {`,
      );
    }
  } else {
    output = output
      .replaceAll("https://api.flows-cloud.com", "/api/v1/flows")
      .replaceAll("wss://api.flows-cloud.com", "'self'")
      .replaceAll("https://app.flows.sh", "/flows");
  }

  return output;
}

function transformText(sourceKey, destinationPath, contents) {
  let output = contents;
  output = replacePackageNames(
    output,
    sourceKey === "flows-sdk" ? SDK_PACKAGE_NAMES : PRODUCT_PACKAGE_NAMES,
  );
  if (sourceKey === "flows-sh") output = output.replaceAll('"icons"', '"@superboard/flows-icons"');
  if (sourceKey === "flows-sdk") output = transformSdkRuntime(destinationPath, output);

  // SuperBoard owns one Flows surface per project. The upstream SDK calls this
  // boundary an organization, but keeping that name in our public packages
  // would recreate a second tenant model. Rewrite the generated public API and
  // its tests/docs after the upstream-specific patches have been applied.
  if (sourceKey === "flows-sdk") {
    output = output
      .replaceAll("organizationId", "projectId")
      .replaceAll("organization ID", "project ID")
      .replaceAll("Organization ID", "Project ID")
      .replaceAll("ORGANIZATION ID", "PROJECT ID")
      .replaceAll("organization identifier", "project identifier")
      .replaceAll("Organization identifier", "Project identifier")
      .replaceAll("organizationText", "projectText")
      .replaceAll("orgId", "projectId")
      .replaceAll("organization=", "project=")
      .replaceAll("YOUR_ORGANIZATION_ID", "YOUR_PROJECT_ID")
      .replaceAll("organization", "project")
      .replaceAll("Organization", "Project")
      .replaceAll("ORGANIZATION", "PROJECT")
      // Billing and free-plan behavior do not exist in SuperBoard Flows. Keep
      // the upstream component wiring as a permanently-disabled branding
      // compatibility flag, without exposing an organization or plan model.
      .replaceAll("freeOrganization", "legacyBranding")
      .replaceAll("freeOrg", "legacyBranding")
      .replaceAll("free_org", "legacy_branding")
      .replaceAll("free-plan", "legacy-branding")
      .replace(
        /^The fastest and most reliable way to get started with Flows is .*MTUs.*pricing.*\n?/gmu,
        "",
      );

    if (destinationPath === "packages/shared/src/api.ts") {
      output = output.replace(
        `interface BlockResponseMeta {
  usage_limited?: boolean;
  legacy_branding?: boolean;
}

interface BlocksResponse {
  blocks: Block[];
  meta?: BlockResponseMeta;
}`,
        `interface BlocksResponse {
  blocks: Block[];
}`,
      );
    }

    if (destinationPath === "packages/react/src/hooks/use-blocks.ts") {
      output = output
        .replace(
          `  const [usageLimited, setUsageLimited] = useState(false);
  const [legacyBranding, setFreeOrg] = useState(false);`,
          "  const legacyBranding = false;",
        )
        .replace(
          `
        if (res.meta?.usage_limited) setUsageLimited(true);
        if (res.meta?.legacy_branding) setFreeOrg(true);`,
          "",
        )
        .replace("    if (usageLimited) return;\n", "")
        .replace(
          "  }, [apiUrl, params, sdkKey, usageLimited]);",
          "  }, [apiUrl, params, sdkKey]);",
        );
    }

    if (destinationPath === "packages/js/src/lib/blocks.ts") {
      output = output
        .replace(
          "import { blocks, blocksError, config, legacyBranding, pendingMessages, updateBlocks } from \"../store\";",
          "import { blocks, blocksError, config, pendingMessages, updateBlocks } from \"../store\";",
        )
        .replace(
          `
        // Disconnect if the user is usage limited
        if (res.meta?.usage_limited) disconnect?.();
        if (res.meta?.legacy_branding) legacyBranding.value = true;`,
          "",
        );
    }
  }

  if (sourceKey === "flows-sh") {
    // SuperBoard Flows is owned by the already-selected project. The upstream
    // product references are useful for blocks, SDK setup, Launchpad, surveys,
    // tours and localization, but its separate organization and MTU billing
    // domains are intentionally not part of the imported product.
    output = output
      .replaceAll("organizationId", "projectId")
      .replaceAll("organization ID", "project ID")
      .replaceAll("Organization ID", "Project ID")
      .replaceAll("ORGANIZATION ID", "PROJECT ID")
      .replaceAll("YOUR_ORGANIZATION_ID", "YOUR_PROJECT_ID")
      .replaceAll("organization identifier", "project identifier")
      .replaceAll("Organization identifier", "Project identifier")
      .replaceAll("organizations", "projects")
      .replaceAll("Organizations", "Projects")
      .replaceAll("ORGANIZATIONS", "PROJECTS")
      .replaceAll("organization", "project")
      .replaceAll("Organization", "Project")
      .replaceAll("ORGANIZATION", "PROJECT")
      .replaceAll("/org/", "/flows/projects/")
      .replaceAll("organization-setup", "project-settings");

    if (destinationPath === "product/types/src/index.ts") {
      output = output
        .replace(/^export \* from "\.\/billing";\n?/mu, "")
        .replace(/^export \* from "\.\/project";\n?/mu, "");
    }
    if (destinationPath === "product/shared/src/index.ts") {
      output = output.replace(/^export \* from "\.\/billing";\n?/mu, "");
    }
    if (destinationPath === "product/shared/src/links.ts") {
      output = output
        .replace(/^\s*pricing: .*\n/mu, "")
        .replace(/^\s*billing: .*\n/mu, "")
        .replace(/^\s*howWeCountMTus: .*\n/mu, "")
        .replace(/^\s*members: .*\n/mu, "")
        .replace(/^\s*project: \{\n\s*main: .*\n\s*\},\n/mu, "");
    }
    if (destinationPath === "reference/product-docs/content/meta.json") {
      const meta = JSON.parse(output);
      meta.pages = meta.pages.filter(
        (page) =>
          page !== "billing" &&
          page !== "project-setup" &&
          page !== "---Management---",
      );
      output = `${JSON.stringify(meta, null, 2)}\n`;
    }
    if (destinationPath === "reference/product-docs/content/concepts.mdx") {
      output = output
        .replace(
          /## Project\n[\s\S]*?(?=\n### Environments)/u,
          "## Project\n\nFlows automatically uses the SuperBoard project currently selected in the dashboard. Workflows, environments, users, components and analytics remain isolated inside that project. There is no separate Flows tenant or membership model.\n",
        )
        .replace(/\n### MTU\n[\s\S]*?(?=\n### |\n## |$)/u, "\n");
    }
    if (destinationPath === "reference/product-docs/content/components/managing.mdx") {
      output = output.replace(
        "By default the newest library is enabled when you create a new project.",
        "By default the newest library is enabled when Flows is first opened for the selected SuperBoard project.",
      );
    }
    if (destinationPath === "reference/product-docs/content/blocks/logic-blocks/delay.mdx") {
      output = output.replace(
        /\n## Billing impact \(MTUs\)\n[\s\S]*?(?=\n## |$)/u,
        "\n",
      );
    }
    if (destinationPath.endsWith("page-targeting.mdx")) {
      output = output.replaceAll("/billing", "/account").replaceAll("billing", "account");
    }
  }

  output = output
    .replaceAll("https://api.flows-cloud.com", "/api/v1/flows")
    .replaceAll("wss://api.flows-cloud.com", "")
    .replaceAll("https://app.flows.sh", "/flows");

  if (destinationPath.endsWith("package.json")) {
    output = transformPackageJson(sourceKey, destinationPath, output);
  }
  return output;
}

function createSelection(flowsShSource, flowsSdkSource) {
  const selected = [];
  const addFile = (sourceKey, sourceRoot, sourcePath, destinationPath) => {
    const absolutePath = resolve(sourceRoot, sourcePath);
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      throw new Error(`Missing selected upstream file: ${sourceKey}:${sourcePath}`);
    }
    selected.push({ sourceKey, sourceRoot, sourcePath, destinationPath });
  };
  const addTree = (sourceKey, sourceRoot, sourceDirectory, destinationDirectory, predicate) => {
    const absoluteRoot = resolve(sourceRoot, sourceDirectory);
    for (const path of listFiles(absoluteRoot, predicate)) {
      addFile(
        sourceKey,
        sourceRoot,
        posixPath(join(sourceDirectory, path)),
        posixPath(join(destinationDirectory, path)),
      );
    }
  };

  addFile("flows-sdk", flowsSdkSource, "LICENSE", "notices/flows-sdk-LICENSE");
  addFile("flows-sdk", flowsSdkSource, "README.md", "reference/flows-sdk-README.md");
  addFile("flows-sdk", flowsSdkSource, "tsconfig.base.json", "tsconfig.base.json");
  for (const packageName of [
    "shared",
    "styles",
    "js",
    "react",
    "js-components",
    "react-components",
  ]) {
    addTree(
      "flows-sdk",
      flowsSdkSource,
      `workspaces/${packageName}`,
      `packages/${packageName}`,
      () => true,
    );
  }
  addTree("flows-sdk", flowsSdkSource, "workspaces/e2e", "tests/e2e", () => true);
  addTree(
    "flows-sdk",
    flowsSdkSource,
    "examples",
    "reference/framework-examples",
    (path) => REFERENCE_EXTENSIONS.has(extname(path).toLowerCase()),
  );

  addFile("flows-sh", flowsShSource, "LICENSE.md", "notices/flows-sh-LICENSE.md");
  for (const packageName of ["types", "shared", "icons", "ui"]) {
    addTree(
      "flows-sh",
      flowsShSource,
      `packages/${packageName}`,
      `product/${packageName}`,
      (path) => {
        if (isRetiredProductPath(`packages/${packageName}/${path}`)) return false;
        if (path.includes("/.storybook/") || path.startsWith(".storybook/")) return false;
        if (path.includes(".stories.")) return false;
        if (packageName === "ui" && (path.startsWith("src/logo/") || path.startsWith("src/producthunt/"))) {
          return false;
        }
        return true;
      },
    );
  }
  addTree(
    "flows-sh",
    flowsShSource,
    "apps/docs/src/content",
    "reference/product-docs/content",
    (path) => !isRetiredProductPath(`apps/docs/src/content/${path}`),
  );
  addTree(
    "flows-sh",
    flowsShSource,
    "apps/docs/public",
    "reference/product-docs/assets",
    (path) => !isRetiredProductPath(`apps/docs/public/${path}`),
  );
  addTree(
    "flows-sh",
    flowsShSource,
    "examples",
    "reference/product-examples",
    (path) => {
      if (!REFERENCE_EXTENSIONS.has(extname(path).toLowerCase())) return false;
      if (path.includes("/src/components/ui/") || path.includes("/src/components/providers/")) return false;
      if (path.endsWith("/src/app/layout.tsx") || path.endsWith("/src/app/providers.tsx")) return false;
      if (path.endsWith("/src/lib/utils.ts")) return false;
      return true;
    },
  );
  addTree(
    "flows-sh",
    flowsShSource,
    "example-templates",
    "reference/product-templates",
    (path) => {
      if (!REFERENCE_EXTENSIONS.has(extname(path).toLowerCase())) return false;
      if (path.includes("/src/components/ui/") || path.includes("/src/components/providers/")) return false;
      if (path.endsWith("/src/app/layout.tsx") || path.endsWith("/src/app/providers.tsx")) return false;
      return true;
    },
  );

  const destinations = new Set();
  for (const entry of selected) {
    if (destinations.has(entry.destinationPath)) {
      throw new Error(`Duplicate import destination: ${entry.destinationPath}`);
    }
    destinations.add(entry.destinationPath);
  }
  return selected.sort((left, right) => left.destinationPath.localeCompare(right.destinationPath));
}

function writeSelection(stageRoot, selected) {
  const manifestFiles = [];
  for (const entry of selected) {
    const sourceAbsolutePath = resolve(entry.sourceRoot, entry.sourcePath);
    const sourceBytes = readFileSync(sourceAbsolutePath);
    let outputBytes = sourceBytes;
    if (isTextFile(entry.sourcePath)) {
      const transformed = transformText(
        entry.sourceKey,
        entry.destinationPath,
        sourceBytes.toString("utf8"),
      );
      outputBytes = Buffer.from(transformed, "utf8");
    }
    const outputPath = resolve(stageRoot, entry.destinationPath);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, outputBytes);
    manifestFiles.push({
      output_path: entry.destinationPath,
      output_sha256: sha256(outputBytes),
      source: entry.sourceKey,
      source_path: entry.sourcePath,
      source_sha256: sha256(sourceBytes),
    });
  }
  return manifestFiles;
}

function generatedReferenceNotice() {
  return `# Imported Flows reference material

This directory is generated by \`scripts/sync-flows-upstream.mjs\` from two pinned public
commits. The code under \`packages/\` is the SuperBoard-namespaced web SDK. The material under
\`product/\` and \`reference/\` is a reviewed source/reference import: it is not a second dashboard,
is not deployed independently, and has no runtime connection to an upstream service.

Do not edit generated files directly. Change the synchronizer, review the diff, and regenerate.
`;
}

function buildManifest(files) {
  return {
    schema_version: 1,
    sources: Object.fromEntries(
      Object.entries(PINNED_SOURCES).map(([key, value]) => [
        key,
        { repository: value.repository, commit: value.commit },
      ]),
    ),
    policy: {
      generated_by: "scripts/sync-flows-upstream.mjs",
      dashboard_imported: false,
      marketing_site_imported: false,
      runtime_upstream_dependency: false,
      default_api_url: "/api/v1/flows",
      package_namespace: "@superboard",
    },
    files,
  };
}

function verifyOutput({ verifySources = false, sourceDirectories = {} } = {}) {
  if (!existsSync(MANIFEST_PATH)) throw new Error(`Missing ${posixPath(relative(REPOSITORY_ROOT, MANIFEST_PATH))}`);
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  if (manifest.schema_version !== 1) throw new Error("Unsupported Flows upstream manifest version");
  for (const [key, pinned] of Object.entries(PINNED_SOURCES)) {
    const recorded = manifest.sources?.[key];
    if (recorded?.repository !== pinned.repository || recorded?.commit !== pinned.commit) {
      throw new Error(`Pinned source metadata drift for ${key}`);
    }
  }

  const expectedPaths = new Set(["GENERATED.md", ...manifest.files.map((entry) => entry.output_path)]);
  const actualPaths = listFiles(OUTPUT_ROOT).filter((path) => path !== "manifest.json");
  for (const path of actualPaths) {
    if (!expectedPaths.has(path)) throw new Error(`Unreviewed generated file: ${path}`);
  }
  for (const entry of manifest.files) {
    const outputPath = resolve(OUTPUT_ROOT, entry.output_path);
    if (!existsSync(outputPath)) throw new Error(`Missing generated file: ${entry.output_path}`);
    const actualHash = sha256(readFileSync(outputPath));
    if (actualHash !== entry.output_sha256) throw new Error(`Generated file drift: ${entry.output_path}`);

    if (verifySources) {
      const sourceRoot = sourceDirectories[entry.source];
      if (!sourceRoot) throw new Error(`Missing checkout for source verification: ${entry.source}`);
      const sourcePath = resolve(sourceRoot, entry.source_path);
      if (!existsSync(sourcePath)) throw new Error(`Missing upstream source file: ${entry.source_path}`);
      if (sha256(readFileSync(sourcePath)) !== entry.source_sha256) {
        throw new Error(`Upstream source drift: ${entry.source}:${entry.source_path}`);
      }
    }
  }

  const generatedHash = sha256(Buffer.from(generatedReferenceNotice(), "utf8"));
  const actualGeneratedHash = sha256(readFileSync(resolve(OUTPUT_ROOT, "GENERATED.md")));
  if (generatedHash !== actualGeneratedHash) throw new Error("Generated reference notice drift");
  return manifest;
}

export function syncFlowsUpstream({ flowsShSource, flowsSdkSource }) {
  assertPinnedCheckout("flows-sh", flowsShSource);
  assertPinnedCheckout("flows-sdk", flowsSdkSource);
  const selected = createSelection(flowsShSource, flowsSdkSource);
  const stageRoot = resolve(dirname(OUTPUT_ROOT), `.flows-upstream-stage-${process.pid}`);
  const backupRoot = resolve(dirname(OUTPUT_ROOT), `.flows-upstream-backup-${process.pid}`);
  rmSync(stageRoot, { recursive: true, force: true });
  rmSync(backupRoot, { recursive: true, force: true });
  mkdirSync(stageRoot, { recursive: true });
  let previousOutputBackedUp = false;
  let newOutputInstalled = false;
  let synchronizedManifest;
  try {
    const files = writeSelection(stageRoot, selected);
    writeFileSync(resolve(stageRoot, "GENERATED.md"), generatedReferenceNotice());
    writeFileSync(resolve(stageRoot, "manifest.json"), `${JSON.stringify(buildManifest(files), null, 2)}\n`);
    mkdirSync(dirname(OUTPUT_ROOT), { recursive: true });
    if (existsSync(OUTPUT_ROOT)) {
      renameSync(OUTPUT_ROOT, backupRoot);
      previousOutputBackedUp = true;
    }
    try {
      renameSync(stageRoot, OUTPUT_ROOT);
      newOutputInstalled = true;
      synchronizedManifest = verifyOutput({
        verifySources: true,
        sourceDirectories: { "flows-sh": flowsShSource, "flows-sdk": flowsSdkSource },
      });
    } catch (error) {
      if (newOutputInstalled) {
        rmSync(OUTPUT_ROOT, { recursive: true, force: true });
      }
      if (previousOutputBackedUp && existsSync(backupRoot)) {
        renameSync(backupRoot, OUTPUT_ROOT);
        previousOutputBackedUp = false;
      }
      throw error;
    }
  } finally {
    rmSync(stageRoot, { recursive: true, force: true });
    if (newOutputInstalled && previousOutputBackedUp) {
      rmSync(backupRoot, { recursive: true, force: true });
    }
  }
  return synchronizedManifest;
}

export function checkFlowsUpstream(options = {}) {
  return verifyOutput(options);
}

function runCli() {
  const options = parseArguments(process.argv.slice(2));
  const sourceDirectories = {
    "flows-sh": options.flowsShSource,
    "flows-sdk": options.flowsSdkSource,
  };
  if (options.check) {
    if (options.verifySources) {
      assertPinnedCheckout("flows-sh", options.flowsShSource);
      assertPinnedCheckout("flows-sdk", options.flowsSdkSource);
    }
    const manifest = checkFlowsUpstream({
      verifySources: options.verifySources,
      sourceDirectories,
    });
    console.log(`Flows upstream import is clean (${manifest.files.length} files).`);
    return;
  }
  if (!options.flowsShSource || !options.flowsSdkSource) {
    throw new Error("Sync requires --flows-sh-source and --flows-sdk-source");
  }
  const manifest = syncFlowsUpstream({
    flowsShSource: options.flowsShSource,
    flowsSdkSource: options.flowsSdkSource,
  });
  console.log(`Synchronized ${manifest.files.length} pinned Flows files.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
