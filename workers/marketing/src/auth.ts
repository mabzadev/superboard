import { verifyInternalProjectContextRequest, type ProjectContext } from '@opengrow/contracts/project-context';
import { configuredSecrets } from '@opengrow/contracts/secret';
import type { Env } from './types';

export async function verifyInternalProjectContext(request: Request, env: Env): Promise<ProjectContext> {
  const verified = await verifyInternalProjectContextRequest(
    request,
    configuredSecrets(env.INTERNAL_API_TOKEN, env.INTERNAL_API_TOKEN_PREVIOUS),
    'marketing',
  );
  if (!verified.ok) throw failure(verified.code, verified.message, 401);
  return verified.context;
}

export function failure(code: string, message: string, status = 422, details?: Record<string, unknown>) {
  return Object.assign(new Error(message), { code, status, details });
}
