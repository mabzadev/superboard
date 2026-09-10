import { Context } from 'hono'
import { typeConfig } from '../configs'
import {
  appModel, userModel,
} from '../models'

type AppRealm = {
  melody_app_id: number;
  project_id: number | null;
}

type SubjectBridge = {
  melody_user_id: number;
  application_user_id: string;
  project_id: number;
}

const projectId = (c: Context<typeConfig.Context>): number | null => {
  const value = Number(c.env.MELODY_PROJECT_ID)
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

export const bindAppToCurrentProject = async (
  c: Context<typeConfig.Context>,
  appId: number,
): Promise<void> => {
  const currentProjectId = projectId(c)
  if (!c.env.MELODY_INTERNAL_ADMIN || !currentProjectId) return
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO identity_app_realm
         (melody_app_id,realm,project_id)
       VALUES (?,?,?)
       ON CONFLICT(melody_app_id) DO UPDATE SET
         realm=excluded.realm,
         project_id=excluded.project_id,
         updated_at=CURRENT_TIMESTAMP`,
    ).bind(
      appId,
      c.env.IDENTITY_REALM,
      currentProjectId,
    ),
    c.env.DB.prepare(
      `INSERT INTO identity_app_feature_policy
         (melody_app_id,revision,config_json)
       VALUES (?,1,?)
       ON CONFLICT(melody_app_id) DO NOTHING`,
    ).bind(
      appId,
      JSON.stringify({ allFeatures: true }),
    ),
  ])
}

export const getCurrentProjectApps = async (
  c: Context<typeConfig.Context>,
): Promise<appModel.Record[]> => {
  const apps = await appModel.getAll(c.env.DB)
  const currentProjectId = projectId(c)
  if (!c.env.MELODY_INTERNAL_ADMIN || !currentProjectId) return apps
  const mapped = await c.env.DB.prepare(
    `SELECT melody_app_id FROM identity_app_realm
     WHERE realm=? AND project_id=?`,
  ).bind(
    c.env.IDENTITY_REALM,
    currentProjectId,
  ).all<{ melody_app_id: number }>()
  const ids = new Set(mapped.results.map((row) => Number(row.melody_app_id)))
  return apps.filter((app) => ids.has(app.id))
}

export const appBelongsToCurrentProject = async (
  c: Context<typeConfig.Context>,
  appId: number,
): Promise<boolean> => {
  const currentProjectId = projectId(c)
  if (!c.env.MELODY_INTERNAL_ADMIN || !currentProjectId) return true
  const row = await c.env.DB.prepare(
    `SELECT melody_app_id FROM identity_app_realm
     WHERE realm=? AND project_id=? AND melody_app_id=?`,
  ).bind(
    c.env.IDENTITY_REALM,
    currentProjectId,
    appId,
  ).first<{ melody_app_id: number }>()
  return Boolean(row)
}

export const canonicalSubject = async (
  c: Context<typeConfig.Context>,
  appId: number,
  user: userModel.Record,
): Promise<string> => {
  const realm = await appRealm(
    c,
    appId,
  )
  if (!realm?.project_id) return user.authId
  return ensureProjectSubject(
    c,
    realm.project_id,
    user,
  )
}

export const canonicalSubjectForCurrentProject = async (
  c: Context<typeConfig.Context>,
  user: userModel.Record,
): Promise<string> => {
  const currentProjectId = projectId(c)
  if (!currentProjectId) return user.authId
  return ensureProjectSubject(
    c,
    currentProjectId,
    user,
  )
}

export const resolveUserBySubject = async (
  c: Context<typeConfig.Context>,
  subject: string,
  clientId?: string,
): Promise<userModel.Record | null> => {
  let targetProjectId = projectId(c)
  if (!targetProjectId && clientId) {
    const realm = await c.env.DB.prepare(
      `SELECT mapping.project_id
       FROM identity_app_realm mapping
       INNER JOIN app ON app.id=mapping.melody_app_id
       WHERE mapping.realm=? AND app."clientId"=? AND app."deletedAt" IS NULL
       LIMIT 1`,
    ).bind(
      c.env.IDENTITY_REALM,
      clientId,
    ).first<{ project_id: number | null }>()
    targetProjectId = realm?.project_id ?? null
  }

  if (targetProjectId) {
    const bridge = await c.env.DB.prepare(
      `SELECT melody_user_id,application_user_id,project_id
       FROM identity_subject_bridge
       WHERE realm=? AND project_id=? AND application_user_id=?
       LIMIT 1`,
    ).bind(
      c.env.IDENTITY_REALM,
      targetProjectId,
      subject,
    ).first<SubjectBridge>()
    if (bridge) return userModel.getById(
      c.env.DB,
      Number(bridge.melody_user_id),
    )
    if (c.env.MELODY_INTERNAL_ADMIN) return null
  }

  return userModel.getByAuthId(
    c.env.DB,
    subject,
  )
}

export const getCurrentProjectUsers = async (
  c: Context<typeConfig.Context>,
  search: string | undefined,
  pagination: typeConfig.Pagination | undefined,
  orgSlug?: string,
): Promise<{ users: userModel.Record[]; count: number } | null> => {
  const currentProjectId = projectId(c)
  if (!c.env.MELODY_INTERNAL_ADMIN || !currentProjectId) return null
  const conditions = [
    'bridge.realm=?',
    'bridge.project_id=?',
    'source."deletedAt" IS NULL',
  ]
  const values: unknown[] = [c.env.IDENTITY_REALM, currentProjectId]
  if (orgSlug) {
    conditions.push('source."orgSlug"=?')
    values.push(orgSlug)
  }
  if (search) {
    conditions.push(
      `(COALESCE(source."firstName", '') || ' ' ||
        COALESCE(source."lastName", '') || ' ' ||
        COALESCE(source.email, '')) LIKE ?`,
    )
    values.push(`%${search}%`)
  }
  const from = `FROM "user" source
    INNER JOIN identity_subject_bridge bridge
      ON bridge.melody_user_id=source.id
    WHERE ${conditions.join(' AND ')}`
  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) count ${from}`,
  ).bind(...values).first<{ count: number }>()
  const pageValues = [...values]
  let page = ''
  if (pagination) {
    page = ' LIMIT ? OFFSET ?'
    pageValues.push(
      pagination.pageSize,
      (pagination.pageNumber - 1) * pagination.pageSize,
    )
  }
  const rows = await c.env.DB.prepare(
    `SELECT source.*,bridge.application_user_id ${from}
     ORDER BY source.id ASC${page}`,
  ).bind(...pageValues).all<userModel.Raw & { application_user_id: string }>()
  return {
    users: rows.results.map((row) => ({
      ...userModel.convertToRecord(row),
      authId: row.application_user_id,
    })),
    count: Number(countRow?.count ?? 0),
  }
}

async function appRealm (
  c: Context<typeConfig.Context>,
  appId: number,
): Promise<AppRealm | null> {
  return c.env.DB.prepare(
    `SELECT melody_app_id,project_id FROM identity_app_realm
     WHERE realm=? AND melody_app_id=? LIMIT 1`,
  ).bind(
    c.env.IDENTITY_REALM,
    appId,
  ).first<AppRealm>()
}

async function ensureProjectSubject (
  c: Context<typeConfig.Context>,
  targetProjectId: number,
  user: userModel.Record,
): Promise<string> {
  const existing = await c.env.DB.prepare(
    `SELECT melody_user_id,application_user_id,project_id
     FROM identity_subject_bridge
     WHERE realm=? AND melody_user_id=? AND project_id=? LIMIT 1`,
  ).bind(
    c.env.IDENTITY_REALM,
    user.id,
    targetProjectId,
  ).first<SubjectBridge>()
  if (existing) {
    await refreshApplicationUser(
      c,
      targetProjectId,
      existing.application_user_id,
      user,
    )
    return existing.application_user_id
  }

  const provider = legacyProvider(user)
  const providerSubjectHash = provider && user.socialAccountId
    ? await sha256(user.socialAccountId)
    : null
  let applicationUser = providerSubjectHash
    ? await c.env.DB.prepare(
      `SELECT target.id FROM application_users target
       INNER JOIN application_identities identity
         ON identity.project_id=target.project_id AND identity.user_id=target.id
       WHERE target.project_id=? AND identity.provider=?
         AND identity.subject_hash=? AND target.deleted_at IS NULL LIMIT 1`,
    ).bind(
      targetProjectId,
      provider,
      providerSubjectHash,
    ).first<{ id: string }>()
    : null
  if (!applicationUser && user.email) {
    applicationUser = await c.env.DB.prepare(
      `SELECT id FROM application_users
       WHERE project_id=? AND email=? AND deleted_at IS NULL LIMIT 1`,
    ).bind(
      targetProjectId,
      user.email,
    ).first<{ id: string }>()
  }
  const applicationUserId = applicationUser?.id ?? await stableSubjectId(
    c.env.IDENTITY_REALM,
    targetProjectId,
    user.id,
  )
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ') || null
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO application_users
         (id,project_id,email,password_hash,name,is_anonymous,email_verified_at)
       VALUES (?,?,?,?,?,0,?)
       ON CONFLICT(id) DO UPDATE SET
         password_hash=excluded.password_hash,
         name=excluded.name,
         email_verified_at=CASE
           WHEN excluded.email_verified_at IS NOT NULL THEN excluded.email_verified_at
           ELSE application_users.email_verified_at
         END,
         deleted_at=NULL,
         updated_at=CURRENT_TIMESTAMP`,
    ).bind(
      applicationUserId,
      targetProjectId,
      user.email,
      user.password,
      displayName,
      user.emailVerified ? new Date().toISOString() : null,
    ),
    c.env.DB.prepare(
      `INSERT INTO identity_subject_bridge
         (id,realm,melody_user_id,project_id,application_user_id)
       VALUES (?,?,?,?,?)
       ON CONFLICT(realm,melody_user_id,project_id) DO UPDATE SET
         application_user_id=excluded.application_user_id,
         updated_at=CURRENT_TIMESTAMP`,
    ).bind(
      crypto.randomUUID(),
      c.env.IDENTITY_REALM,
      user.id,
      targetProjectId,
      applicationUserId,
    ),
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO identity_event_outbox
         (id,event_type,aggregate_id,payload_json)
       VALUES (?,?,?,?)`,
    ).bind(
      `identity-subject-linked:${c.env.IDENTITY_REALM}:${targetProjectId}:${user.id}`,
      'identity.subject.linked',
      applicationUserId,
      JSON.stringify({
        realm: c.env.IDENTITY_REALM,
        projectId: targetProjectId,
        melodyUserId: user.id,
        applicationUserId,
      }),
    ),
  ]
  if (provider && providerSubjectHash && user.socialAccountId) {
    statements.push(c.env.DB.prepare(
      `INSERT INTO application_identities
         (id,project_id,user_id,provider,subject_hash,provider_email)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(project_id,provider,subject_hash) DO UPDATE SET
         user_id=excluded.user_id,
         provider_email=excluded.provider_email`,
    ).bind(
      crypto.randomUUID(),
      targetProjectId,
      applicationUserId,
      provider,
      providerSubjectHash,
      user.email,
    ))
  }
  await c.env.DB.batch(statements)
  return applicationUserId
}

async function refreshApplicationUser (
  c: Context<typeConfig.Context>,
  targetProjectId: number,
  applicationUserId: string,
  user: userModel.Record,
): Promise<void> {
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ') || null
  await c.env.DB.prepare(
    `UPDATE application_users SET
       password_hash=?,
       name=?,
       email_verified_at=CASE
         WHEN ?=1 AND email_verified_at IS NULL THEN CURRENT_TIMESTAMP
         ELSE email_verified_at
       END,
       deleted_at=NULL,
       updated_at=CURRENT_TIMESTAMP
     WHERE project_id=? AND id=?`,
  ).bind(
    user.password,
    displayName,
    user.emailVerified ? 1 : 0,
    targetProjectId,
    applicationUserId,
  ).run()
}

function legacyProvider (user: userModel.Record): 'google' | 'apple' | null {
  if (user.socialAccountType === userModel.SocialAccountType.Google) return 'google'
  if (user.socialAccountType === userModel.SocialAccountType.Apple) return 'apple'
  return null
}

async function stableSubjectId (
  realm: string,
  targetProjectId: number,
  melodyUserId: number,
): Promise<string> {
  const digest = await sha256(`${realm}:${targetProjectId}:${melodyUserId}`)
  const value = `${digest.slice(0, 12)}5${digest.slice(13, 16)}${(
    (Number.parseInt(digest[16], 16) & 0x3) | 0x8
  ).toString(16)}${digest.slice(17, 32)}`
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
}

async function sha256 (value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
