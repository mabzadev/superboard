import { ErrorType } from '@melody-auth/shared'
import type { GetUserInfoRes } from '@melody-auth/shared'
import { AuthService } from './auth.service'
import { provideAuth } from './auth.provider'

export type UserInfo = GetUserInfoRes

export {
  AuthService,
  provideAuth,
  ErrorType,
}
