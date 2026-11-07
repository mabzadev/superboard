import { useMemo } from 'hono/jsx/dom'
import {
  useLocale, useInitialProps, useCurrentView,
  View,
} from './hooks'
import {
  AcceptInvitation,
  SignIn,
  MagicSignIn,
  SignUp,
  Consent,
  MfaEnroll,
  OtpSetup,
  OtpMfa,
  EmailMfa,
  PasskeyEnroll,
  ResetPassword,
  UpdateInfo,
  ChangePassword,
  ResetMfa,
  ManagePasskey,
  ManageRecoveryCode,
  ChangeEmail,
  AuthCodeExpired,
  VerifyEmail,
  PasswordlessVerify,
  RecoveryCodeEnroll,
  RecoveryCodeSignIn,
} from './views'
import { Layout } from './blocks'
import { getLocaleFromParams } from './tools/param'
import './client.css'

const Main = () => {
  const { initialProps } = useInitialProps()

  const {
    locale, handleSwitchLocale,
  } = useLocale({ initialLocale: getLocaleFromParams() })

  const {
    view, handleSwitchView,
  } = useCurrentView()

  const CurrentView = useMemo(
    () => {
      switch (view) {
      case View.MagicSignIn:
        return MagicSignIn
      case View.SignUp:
        return SignUp
      case View.Consent:
        return Consent
      case View.MfaEnroll:
        return MfaEnroll
      case View.OtpSetup:
        return OtpSetup
      case View.OtpMfa:
        return OtpMfa
      case View.PasswordlessVerify:
        return PasswordlessVerify
      case View.EmailMfa:
        return EmailMfa
      case View.PasskeyEnroll:
        return PasskeyEnroll
      case View.RecoveryCodeEnroll:
        return RecoveryCodeEnroll
      case View.ResetPassword:
        return ResetPassword
      case View.UpdateInfo:
        return UpdateInfo
      case View.ChangePassword:
        return ChangePassword
      case View.ResetMfa:
        return ResetMfa
      case View.ManagePasskey:
        return ManagePasskey
      case View.ManageRecoveryCode:
        return ManageRecoveryCode
      case View.ChangeEmail:
        return ChangeEmail
      case View.AuthCodeExpired:
        return AuthCodeExpired
      case View.VerifyEmail:
        return VerifyEmail
      case View.AcceptInvitation:
        return AcceptInvitation
      case View.RecoveryCodeSignIn:
        return RecoveryCodeSignIn
      case View.SignIn:
      default:
        return SignIn
      }
    },
    [view],
  )

  return (
    <Layout
      locale={locale}
      locales={initialProps.enableLocaleSelector ? initialProps.locales : [locale]}
      logoUrl={initialProps.logoUrl}
      onSwitchLocale={handleSwitchLocale}
    >
      <CurrentView
        locale={locale}
        onSwitchView={handleSwitchView}
      />
    </Layout>
  )
}

export default Main
