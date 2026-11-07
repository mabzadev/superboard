export enum TableName {
  App = 'app',
  User = 'user',
  UserAttribute = 'user_attribute',
  UserAttributeValue = 'user_attribute_value',
  UserAppConsent = 'user_app_consent',
  Role = 'role',
  UserRole = 'user_role',
  UserPasskey = 'user_passkey',
  Scope = 'scope',
  AppScope = 'app_scope',
  ScopeLocale = 'scope_locale',
  EmailLog = 'email_log',
  SignInLog = 'sign_in_log',
}

export enum BaseKVKey {
  JwtPublicSecret = 'jwtPublicSecret',
  DeprecatedJwtPublicSecret = 'deprecatedJwtPublicSecret',
  JwtPrivateSecret = 'jwtPrivateSecret',
  SessionSecret = 'sessionSecret',
  RefreshToken = 'RT',
  AuthCode = 'AC',
  EmbeddedSession = 'ES',
  EmailMfaCode = 'EMC',
  EmailMfaRememberDevice = 'EMRD',
  OtpMfaRememberDevice = 'OMRD',
  OtpMfaCode = 'OMC',
  OtpMfaUsedStep = 'OMUS',
  PasswordlessCode = 'PLC',
  EmailVerificationCode = 'EVC',
  PasskeyEnrollChallenge = 'PEC',
  PasskeyVerifyChallenge = 'PVC',
  PasswordResetCode = 'PRC',
  FailedLoginAttempts = 'FLA',
  FailedMfaCodeAttempts = 'FMA',
  FailedPasswordResetCodeAttempts = 'FPRCA',
  FailedChangeEmailCodeAttempts = 'FCECA',
  FailedEmailVerificationCodeAttempts = 'FEVCA',
  FailedAuthCodeVerifierAttempts = 'FACVA',
  EmailMfaEmailAttempts = 'EMEA',
  PasswordResetAttempts = 'PRA',
  ChangeEmailCode = 'CEC',
  ChangeEmailAttempts = 'CEA',
  OidcCodeVerifier = 'OVC',
}

export const getKVKey = (
  base: BaseKVKey, key1: string, key2?: string,
): string => {
  const baseKey = `${base}-${key1}`
  return key2 ? `${baseKey}-${key2}` : baseKey
}

export enum SessionKey {
  AuthInfo = 'authInfo',
}

export const getAuthInfoSessionKeyByClientId = (clientId: string) => {
  return `${SessionKey.AuthInfo}-${clientId}`
}

export const getEmailMfaRememberDeviceCookieKey = (userId: number) => {
  return `${BaseKVKey.EmailMfaRememberDevice}-${userId}`
}

export const getOtpMfaRememberDeviceCookieKey = (userId: number) => {
  return `${BaseKVKey.OtpMfaRememberDevice}-${userId}`
}

