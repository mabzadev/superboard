#!/usr/bin/env node
import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

export function flutterFlowLibraryPageEnvironmentName(pageName) {
  if (!/^[A-Z][A-Za-z0-9]*Page$/u.test(pageName || "")) {
    throw new Error(`Invalid FlutterFlow library page name ${String(pageName)}`);
  }
  const words = pageName
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1_$2")
    .toUpperCase();
  return `FF_LIBRARY_${words}_KEY`;
}

export function resolveFlutterFlowLibraryPage(pageName, snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error(`${pageName} inspect output must be an object`);
  }
  if (snapshot.kind !== "page" || snapshot.name !== pageName) {
    throw new Error(
      `${pageName} inspect output identifies ${String(snapshot.kind)}:${String(snapshot.name)}`,
    );
  }
  const key = String(snapshot.key || snapshot.root?.key || "").trim();
  if (!/^[A-Za-z0-9_-]{3,255}$/u.test(key)) {
    throw new Error(`${pageName} has no valid immutable FlutterFlow page key`);
  }
  if (snapshot.root?.key && snapshot.root.key !== key) {
    throw new Error(`${pageName} top-level and root page keys disagree`);
  }
  return {
    name: pageName,
    key,
    environment: flutterFlowLibraryPageEnvironmentName(pageName),
  };
}

export async function resolveFlutterFlowLibraryPages({
  inputDirectory,
  manifestPath = resolve(root, "config/flutterflow-library.json"),
  read = readFile,
}) {
  const manifest = JSON.parse(await read(manifestPath, "utf8"));
  if (!Array.isArray(manifest.pages) || manifest.pages.length === 0) {
    throw new Error("FlutterFlow library manifest declares no reusable pages");
  }
  const pages = [];
  for (const pageName of manifest.pages) {
    const path = resolve(inputDirectory, `${pageName}.json`);
    let snapshot;
    try {
      snapshot = JSON.parse(await read(path, "utf8"));
    } catch (error) {
      throw new Error(`${pageName} inspect output is unavailable: ${error.message}`);
    }
    pages.push(resolveFlutterFlowLibraryPage(pageName, snapshot));
  }
  if (new Set(pages.map(({ key }) => key)).size !== pages.length) {
    throw new Error("FlutterFlow library page keys must be unique");
  }
  if (new Set(pages.map(({ environment }) => environment)).size !== pages.length) {
    throw new Error("FlutterFlow library page environment names must be unique");
  }
  return { schemaVersion: 1, status: "ok", pages };
}

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? null : process.argv[index + 1] || null;
}

async function main() {
  const inputDirectory = argument("input-dir");
  const githubEnvironment = argument("github-env");
  if (!inputDirectory) throw new Error("--input-dir is required");
  const result = await resolveFlutterFlowLibraryPages({ inputDirectory });
  if (githubEnvironment) {
    const lines = result.pages
      .map(({ environment, key }) => `${environment}=${key}`)
      .join("\n");
    await appendFile(githubEnvironment, `${lines}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
