import { Context } from 'hono'
import {
  errorConfig, typeConfig,
} from '../configs'
import {
  emailLogModel, signInLogModel, smsLogModel,
} from '../models'
import {
  currentProjectId,
  resolveProjectId,
} from './logScope'

// A configured SuperBoard realm always fails closed when an access token is
// not bound to a project. Project identifiers are strictly positive.
const NO_PROJECT_ACCESS = -1

const requestProjectId = async (
  c: Context<typeConfig.Context>,
): Promise<number | undefined> => {
  if (c.env.MELODY_INTERNAL_ADMIN) {
    const projectId = currentProjectId(c)
    if (!projectId) throw new errorConfig.InternalServerError()
    return projectId
  }

  if (!c.env.IDENTITY_REALM?.trim()) return undefined
  const clientId = c.get('access_token_body')?.azp
  return (await resolveProjectId(
    c,
    { clientId },
  )) ?? NO_PROJECT_ACCESS
}

export const getEmailLogs = async (
  c: Context<typeConfig.Context>,
  pagination: typeConfig.Pagination | undefined,
): Promise<emailLogModel.PaginatedRecords> => {
  const projectId = await requestProjectId(c)
  const logs = await emailLogModel.getAll(
    c.env.DB,
    { pagination, projectId },
  )
  const count = pagination
    ? await emailLogModel.count(
      c.env.DB,
      projectId,
    )
    : logs.length

  return {
    logs, count,
  }
}

export const deleteEmailLogs = async (
  c: Context<typeConfig.Context>,
  before: string,
) => {
  const projectId = await requestProjectId(c)
  const targetDate = before.replace(
    'T',
    ' ',
  ).replace(
    'Z',
    '',
  )
  await emailLogModel.destroy(
    c.env.DB,
    targetDate,
    projectId,
  )
}

export const getEmailLogById = async (
  c: Context<typeConfig.Context>,
  id: number,
): Promise<emailLogModel.Record> => {
  const projectId = await requestProjectId(c)
  const log = await emailLogModel.getById(
    c.env.DB,
    id,
    projectId,
  )

  if (!log) throw new errorConfig.NotFound()

  return log
}

export const getSmsLogs = async (
  c: Context<typeConfig.Context>,
  pagination: typeConfig.Pagination | undefined,
): Promise<emailLogModel.PaginatedRecords> => {
  const projectId = await requestProjectId(c)
  const logs = await smsLogModel.getAll(
    c.env.DB,
    { pagination, projectId },
  )
  const count = pagination
    ? await smsLogModel.count(
      c.env.DB,
      projectId,
    )
    : logs.length

  return {
    logs, count,
  }
}

export const deleteSmsLogs = async (
  c: Context<typeConfig.Context>,
  before: string,
) => {
  const projectId = await requestProjectId(c)
  const targetDate = before.replace(
    'T',
    ' ',
  ).replace(
    'Z',
    '',
  )
  await smsLogModel.destroy(
    c.env.DB,
    targetDate,
    projectId,
  )
}

export const getSmsLogById = async (
  c: Context<typeConfig.Context>,
  id: number,
): Promise<smsLogModel.Record> => {
  const projectId = await requestProjectId(c)
  const log = await smsLogModel.getById(
    c.env.DB,
    id,
    projectId,
  )

  if (!log) throw new errorConfig.NotFound()

  return log
}

export const getSignInLogs = async (
  c: Context<typeConfig.Context>,
  pagination: typeConfig.Pagination | undefined,
): Promise<signInLogModel.PaginatedRecords> => {
  const projectId = await requestProjectId(c)
  const logs = await signInLogModel.getAll(
    c.env.DB,
    { pagination, projectId },
  )
  const count = pagination
    ? await signInLogModel.count(
      c.env.DB,
      projectId,
    )
    : logs.length

  return {
    logs, count,
  }
}

export const deleteSignInLogs = async (
  c: Context<typeConfig.Context>,
  before: string,
) => {
  const projectId = await requestProjectId(c)
  const targetDate = before.replace(
    'T',
    ' ',
  ).replace(
    'Z',
    '',
  )
  await signInLogModel.destroy(
    c.env.DB,
    targetDate,
    projectId,
  )
}

export const getSignInLogById = async (
  c: Context<typeConfig.Context>,
  id: number,
): Promise<signInLogModel.Record> => {
  const projectId = await requestProjectId(c)
  const log = await signInLogModel.getById(
    c.env.DB,
    id,
    projectId,
  )

  if (!log) throw new errorConfig.NotFound()

  return log
}
