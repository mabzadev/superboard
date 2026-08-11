import { desiredCloudflareResources } from "./cloudflare-bootstrap-core.mjs";

export function targetWithoutResourceIds(source, environment) {
  const target = structuredClone(source);
  for (const { idPath } of desiredCloudflareResources(target, environment)) {
    if (!idPath) continue;
    let cursor = target.environments[environment];
    for (const part of idPath.slice(0, -1)) cursor = cursor[part];
    cursor[idPath.at(-1)] = null;
  }
  return target;
}
