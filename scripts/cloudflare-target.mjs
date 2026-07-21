import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import Ajv from "ajv/dist/2020.js";

export const root = resolve(new URL("..", import.meta.url).pathname);

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      args[key] = argv[index + 1];
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

export async function loadTarget(targetName) {
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(targetName ?? "")) {
    throw new Error("--target must contain only lowercase letters, numbers and hyphens");
  }
  const path = resolve(root, "deploy", "targets", `${targetName}.json`);
  const target = JSON.parse(await readFile(path, "utf8"));
  await validateTarget(target);
  return { path, target };
}

export async function validateTarget(target) {
  const schemaPath = resolve(root, "deploy", "targets", "schema.json");
  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  if (!validate(target)) {
    const details = validate.errors?.map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
    throw new Error(`Invalid target manifest: ${details}`);
  }
  return target;
}

export function environmentFromArgs(args) {
  const environment = args.environment ?? "staging";
  if (!new Set(["staging", "production"]).has(environment)) {
    throw new Error("--environment must be staging or production");
  }
  return environment;
}
