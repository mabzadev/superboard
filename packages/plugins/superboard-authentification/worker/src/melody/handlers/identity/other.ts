import { Context } from 'hono'
import { env } from 'hono/adapter'
import {
  errorConfig, messageConfig, typeConfig,
} from '../../configs'
import {
  baseDto, identityDto, userDto,
} from '../../dtos'
import {
  identityService,
  kvService,
  userService,
} from '../../services'
import {
  cryptoUtil, loggerUtil, requestUtil, timeUtil, validateUtil,
} from '../../utils'
import { userModel } from '../../models'

export const postVerifyEmail = async (c: Context<typeConfig.Context>) => {
  const reqBody = await c.req.json()

  const bodyDto = new identityDto.PostVerifyEmailDto({
    id: String(reqBody.id),
    code: String(reqBody.code),
  })
  await validateUtil.dto(bodyDto)

  await userService.verifyUserEmail(
    c,
    bodyDto,
  )

  return c.json({ success: true })
}

export const postResetPasswordCode = async (c: Context<typeConfig.Context>) => {
  const reqBody = await c.req.json()

  const bodyDto = new baseDto.ResetPasswordDto(reqBody)

  const email = bodyDto.email
  const locale = requestUtil.getLocaleFromQuery(
    c,
    reqBody.locale,
  )

  await identityService.processResetPassword(
    c,
    email,
    locale,
  )

  return c.json({ success: true })
}

export const postResetPassword = async (c: Context<typeConfig.Context>) => {
  const reqBody = await c.req.json()

  const bodyDto = new identityDto.PostResetPasswordDto({
    email: String(reqBody.email),
    code: String(reqBody.code),
    password: String(reqBody.password),
  })
  await validateUtil.dto(bodyDto)

  await userService.resetUserPassword(
    c,
    bodyDto,
  )

  const {
    ACCOUNT_LOCKOUT_THRESHOLD: lockThreshold,
    UNLOCK_ACCOUNT_VIA_PASSWORD_RESET: allowUnlock,
  } = env(c)
  if (lockThreshold && allowUnlock) {
    const ip = requestUtil.getRequestIP(c)
    await kvService.clearFailedLoginAttemptsByIP(
      c.env.KV,
      bodyDto.email,
      ip,
    )
  }

  return c.json({ success: true })
}

export const getAcceptInvitation = async (c: Context<typeConfig.Context>) => {
  const token = c.req.query('invitationToken')

  if (!token) {
    throw new errorConfig.NotFound(messageConfig.RequestError.InvitationNotFound)
  }

  const user = await userModel.getByInvitationToken(
    c.env.DB,
    token,
  )

  if (!user || !user.invitationToken) {
    throw new errorConfig.NotFound(messageConfig.RequestError.InvitationNotFound)
  }

  if (user.isActive) {
    throw new errorConfig.Forbidden(messageConfig.RequestError.UserAlreadyActive)
  }

  const now = timeUtil.getDbCurrentTime()
  if (user.invitationExpiresAt && user.invitationExpiresAt < now) {
    throw new errorConfig.Forbidden(messageConfig.RequestError.InvitationExpired)
  }

  return c.json({ success: true })
}

export const postAcceptInvitation = async (c: Context<typeConfig.Context>) => {
  const reqBody = await c.req.json()

  const bodyDto = new userDto.PostAcceptInvitationDto(reqBody)
  await validateUtil.dto(bodyDto)

  const user = await userModel.getByInvitationToken(
    c.env.DB,
    bodyDto.token,
  )

  if (!user || !user.invitationToken) {
    loggerUtil.triggerLogger(
      c,
      loggerUtil.LoggerLevel.Warn,
      messageConfig.RequestError.InvitationNotFound,
    )
    throw new errorConfig.NotFound(messageConfig.RequestError.InvitationNotFound)
  }

  if (user.isActive) {
    loggerUtil.triggerLogger(
      c,
      loggerUtil.LoggerLevel.Warn,
      messageConfig.RequestError.UserAlreadyActive,
    )
    throw new errorConfig.Forbidden(messageConfig.RequestError.UserAlreadyActive)
  }

  const now = timeUtil.getDbCurrentTime()
  if (user.invitationExpiresAt && user.invitationExpiresAt < now) {
    loggerUtil.triggerLogger(
      c,
      loggerUtil.LoggerLevel.Warn,
      messageConfig.RequestError.InvitationExpired,
    )
    throw new errorConfig.Forbidden(messageConfig.RequestError.InvitationExpired)
  }

  const hashedPassword = await cryptoUtil.bcryptText(bodyDto.password)

  await userModel.update(
    c.env.DB,
    user.id,
    {
      password: hashedPassword,
      isActive: 1,
      emailVerified: 1,
      invitationToken: null,
      invitationExpiresAt: null,
    },
  )

  return c.json({ success: true })
}
