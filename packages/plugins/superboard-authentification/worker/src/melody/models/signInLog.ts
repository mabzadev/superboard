import {
  adapterConfig, errorConfig,
  typeConfig,
} from '../configs'
import { dbUtil } from '../utils'

export interface Record {
  id: number;
  userId: number;
  ip: string | null;
  detail: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface Raw extends Record {
  projectId?: number | null;
}

export interface PaginatedRecords {
  logs: Record[];
  count: number;
}

export interface Create {
  userId: number;
  ip: string | null;
  detail: string | null;
  projectId?: number;
}

const TableName = adapterConfig.TableName.SignInLog

export const getAll = async (
  db: D1Database,
  option?: {
    search?: typeConfig.Search;
    pagination?: typeConfig.Pagination;
    projectId?: number;
  },
): Promise<Record[]> => {
  const stmt = dbUtil.d1SelectAllQuery(
    db,
    TableName,
    {
      ...option,
      match: option?.projectId
        ? { column: 'projectId', value: String(option.projectId) }
        : undefined,
      sort: {
        column: 'id',
        order: 'DESC',
      },
    },
  )
  const { results: logs }: { results: Raw[] } = await stmt.all()
  return logs.map(({ projectId: _projectId, ...log }) => log)
}

export const count = async (
  db: D1Database,
  projectId?: number,
): Promise<number> => {
  const query = `SELECT COUNT(*) as count FROM ${TableName} where "deletedAt" IS NULL${projectId ? ' AND "projectId" = $1' : ''}`
  const stmt = projectId ? db.prepare(query).bind(projectId) : db.prepare(query)
  const result = await stmt.first() as { count: number }
  return Number(result.count)
}

export const getById = async (
  db: D1Database,
  id: number,
  projectId?: number,
): Promise<Record | null> => {
  const query = `SELECT * FROM ${TableName} WHERE id = $1 AND "deletedAt" IS NULL${projectId ? ' AND "projectId" = $2' : ''}`

  const stmt = db.prepare(query)
    .bind(...(projectId ? [id, projectId] : [id]))
  const log = await stmt.first() as Raw | null
  if (!log) return null
  const { projectId: _projectId, ...record } = log
  return record
}

export const create = async (
  db: D1Database, create: Create,
): Promise<true> => {
  const query = create.projectId
    ? `INSERT INTO ${TableName} ("userId", ip, detail, "projectId") values ($1, $2, $3, $4)`
    : `INSERT INTO ${TableName} ("userId", ip, detail) values ($1, $2, $3)`
  const stmt = db.prepare(query).bind(
    create.userId,
    create.ip,
    create.detail,
    ...(create.projectId ? [create.projectId] : []),
  )
  const result = await dbUtil.d1Run(stmt)
  if (!result.success) throw new errorConfig.InternalServerError()
  return true
}

export const destroy = async (
  db: D1Database,
  date: string,
  projectId?: number,
) => {
  const query = `DELETE FROM ${TableName} WHERE "createdAt" < $1${projectId ? ' AND "projectId" = $2' : ''}`
  const stmt = db.prepare(query).bind(...(projectId ? [date, projectId] : [date]))
  const result = await dbUtil.d1Run(stmt)
  if (!result.success) throw new errorConfig.InternalServerError()
  return true
}
