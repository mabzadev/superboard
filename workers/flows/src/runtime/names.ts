const RUNTIME_SEPARATOR = ":";
const HUB_SHARDS = 64;

export function flowRuntimeName(
  projectId: number,
  environmentId: string,
  userIdHash: string,
): string {
  return [projectId, environmentId, userIdHash].join(
    RUNTIME_SEPARATOR,
  );
}

export function flowHubName(
  projectId: number,
  environmentId: string,
  userIdHash: string,
): string {
  const shard = fnv1a(userIdHash) % HUB_SHARDS;
  return [projectId, environmentId, shard].join(
    RUNTIME_SEPARATOR,
  );
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
