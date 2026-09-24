import { Context } from 'hono'
import { typeConfig } from '../configs'

export type DeliveryLogScope = {
  appId?: number;
  clientId?: string;
  userId?: number;
}

const positiveInteger = (value: unknown): number | undefined => {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

export const currentProjectId = (
  c: Context<typeConfig.Context>,
): number | undefined => positiveInteger(c.env.MELODY_PROJECT_ID)

export const resolveProjectId = async (
  c: Context<typeConfig.Context>,
  scope: DeliveryLogScope & { receiver?: string } = {},
): Promise<number | undefined> => {
  const current = currentProjectId(c)
  if (current) return current

  const realm = c.env.IDENTITY_REALM?.trim()
  if (!realm) return undefined

  if (scope.appId) {
    const row = await c.env.DB.prepare(
      `SELECT project_id FROM identity_app_realm
       WHERE realm=? AND melody_app_id=? AND project_id IS NOT NULL
       LIMIT 1`,
    ).bind(
      realm,
      scope.appId,
    ).first<{ project_id: number }>()
    const appProjectId = positiveInteger(row?.project_id)
    if (appProjectId) return appProjectId
  }

  if (scope.clientId) {
    const row = await c.env.DB.prepare(
      `SELECT mapping.project_id
       FROM identity_app_realm mapping
       INNER JOIN app ON app.id=mapping.melody_app_id
       WHERE mapping.realm=? AND app."clientId"=?
         AND mapping.project_id IS NOT NULL AND app."deletedAt" IS NULL
       LIMIT 1`,
    ).bind(
      realm,
      scope.clientId,
    ).first<{ project_id: number }>()
    const clientProjectId = positiveInteger(row?.project_id)
    if (clientProjectId) return clientProjectId
  }

  if (scope.userId) {
    const userProjects = await c.env.DB.prepare(
      `SELECT DISTINCT project_id FROM identity_subject_bridge
       WHERE realm=? AND melody_user_id=?
       ORDER BY project_id LIMIT 2`,
    ).bind(
      realm,
      scope.userId,
    ).all<{ project_id: number }>()
    if (userProjects.results.length === 1) {
      return positiveInteger(userProjects.results[0]?.project_id)
    }
  }

  if (scope.receiver) {
    const receiverProjects = await c.env.DB.prepare(
      `SELECT DISTINCT bridge.project_id
       FROM identity_subject_bridge bridge
       INNER JOIN "user" source ON source.id=bridge.melody_user_id
       WHERE bridge.realm=? AND LOWER(source.email)=LOWER(?)
         AND source."deletedAt" IS NULL
       ORDER BY bridge.project_id LIMIT 2`,
    ).bind(
      realm,
      scope.receiver,
    ).all<{ project_id: number }>()
    if (receiverProjects.results.length === 1) {
      return positiveInteger(receiverProjects.results[0]?.project_id)
    }
  }

  return undefined
}
