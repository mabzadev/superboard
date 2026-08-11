#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  environmentFromArgs,
  loadTarget,
  parseArgs,
  validateTarget,
} from "./cloudflare-target.mjs";

const FIELD_OPTIONS = Object.freeze({
  googleAudiences: {
    argument: "google-audiences",
    clear: "clear-google-audiences",
    label: "Google audiences",
  },
  appleAudiences: {
    argument: "apple-audiences",
    clear: "clear-apple-audiences",
    label: "Apple audiences",
  },
  webOrigins: {
    argument: "web-origins",
    clear: "clear-web-origins",
    label: "Web origins",
  },
  supportProjectIds: {
    argument: "support-project-ids",
    clear: "clear-support-project-ids",
    label: "Support project ids",
  },
});

export function applicationConfigurationConfirmation(plan) {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        target: plan.target,
        environment: plan.environment,
        desired: plan.desired,
      }),
    )
    .digest("hex")
    .slice(0, 12);
  return (
    "TARGET:CONFIGURE-APPLICATION:" +
    plan.target +
    ":" +
    plan.environment +
    ":" +
    digest
  );
}

export function applicationConfigurationUpdates(args) {
  const updates = {};
  for (const [field, option] of Object.entries(FIELD_OPTIONS)) {
    const hasValue = typeof args[option.argument] === "string";
    const clear = args[option.clear] === true;
    if (hasValue && clear) {
      throw new Error(
        "--" +
          option.argument +
          " and --" +
          option.clear +
          " are mutually exclusive",
      );
    }
    if (!hasValue && !clear) continue;
    updates[field] = clear
      ? []
      : field === "supportProjectIds"
        ? positiveIntegerList(args[option.argument], option.label)
        : publicIdentifierList(args[option.argument], option.label, {
            webOrigins: field === "webOrigins",
          });
  }
  if (Object.keys(updates).length === 0) {
    throw new Error(
      "Provide at least one application identity, web origin or Support project option",
    );
  }
  return updates;
}

export async function buildApplicationConfigurationPlan({
  target,
  targetName,
  environment,
  updates,
}) {
  if (!target.environments?.[environment]) {
    throw new Error(targetName + " does not define " + environment);
  }
  const current = {
    googleAudiences: [...target.applicationIdentity.googleAudiences].sort(),
    appleAudiences: [...target.applicationIdentity.appleAudiences].sort(),
    webOrigins: [...target.applicationIdentity.webOrigins].sort(),
    supportProjectIds: [
      ...target.environments[environment].supportProjectIds,
    ].sort((left, right) => left - right),
  };
  const desired = {
    googleAudiences: updates.googleAudiences ?? current.googleAudiences,
    appleAudiences: updates.appleAudiences ?? current.appleAudiences,
    webOrigins: updates.webOrigins ?? current.webOrigins,
    supportProjectIds: updates.supportProjectIds ?? current.supportProjectIds,
  };
  const changes = Object.keys(desired)
    .filter(
      (field) =>
        JSON.stringify(current[field]) !== JSON.stringify(desired[field]),
    )
    .map((field) => ({
      field,
      current: current[field],
      desired: desired[field],
    }));
  const plan = {
    schemaVersion: 1,
    mode: "application-configuration-plan",
    target: targetName,
    environment,
    changed: changes.length > 0,
    current,
    desired,
    changes,
  };
  return {
    ...plan,
    confirmation: applicationConfigurationConfirmation(plan),
    note: "Application audiences, HTTPS origins and numeric project ids are public configuration; secret values are never accepted.",
  };
}

export async function applyApplicationConfiguration({
  path,
  target,
  plan,
  confirm,
}) {
  if (confirm !== plan.confirmation) {
    throw new Error(
      "Refusing target mutation: pass --confirm " + plan.confirmation,
    );
  }
  if (!plan.changed) {
    return { ...plan, mode: "application-configuration-apply", applied: false };
  }
  const updated = structuredClone(target);
  updated.applicationIdentity.googleAudiences = plan.desired.googleAudiences;
  updated.applicationIdentity.appleAudiences = plan.desired.appleAudiences;
  updated.applicationIdentity.webOrigins = plan.desired.webOrigins;
  updated.environments[plan.environment].supportProjectIds =
    plan.desired.supportProjectIds;
  await validateTarget(updated);

  const temporaryPath = path + "." + process.pid + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporaryPath, JSON.stringify(updated, null, 2) + "\n", {
      flag: "wx",
      mode: 0o644,
    });
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return { ...plan, mode: "application-configuration-apply", applied: true };
}

function publicIdentifierList(value, label, { webOrigins = false } = {}) {
  const values = uniqueCsv(value);
  if (values.length === 0) throw new Error(label + " cannot be empty");
  for (const item of values) {
    if (item.length < 3 || item.length > 255 || /\s/u.test(item)) {
      throw new Error(label + " contains an invalid value");
    }
    if (webOrigins) {
      let url;
      try {
        url = new URL(item);
      } catch {
        throw new Error(label + " must contain public HTTPS origins");
      }
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      ) {
        throw new Error(label + " must contain public HTTPS origins");
      }
    }
  }
  return values.sort();
}

function positiveIntegerList(value, label) {
  const values = uniqueCsv(value).map((item) => Number(item));
  if (
    values.length === 0 ||
    values.some((item) => !Number.isSafeInteger(item) || item <= 0)
  ) {
    throw new Error(label + " must contain positive integers");
  }
  return values.sort((left, right) => left - right);
}

function uniqueCsv(value) {
  const values = String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (new Set(values).size !== values.length) {
    throw new Error("Application configuration values must be unique");
  }
  return values;
}

async function main() {
  const args = parseArgs();
  const targetName = String(args.target || "");
  const environment = environmentFromArgs(args);
  const { path, target } = await loadTarget(targetName);
  const updates = applicationConfigurationUpdates(args);
  const plan = await buildApplicationConfigurationPlan({
    target,
    targetName,
    environment,
    updates,
  });
  if (!args.apply) {
    process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
    return;
  }
  const result = await applyApplicationConfiguration({
    path,
    target,
    plan,
    confirm: String(args.confirm || ""),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
