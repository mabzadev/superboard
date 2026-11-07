import { useMemo } from 'hono/jsx'
import { typeConfig } from '../../configs'

export interface InitialProps {
  locales: typeConfig.Locale[];
  logoUrl: string;
  enableLocaleSelector: boolean;
  enableSignUp: boolean;
  enablePasswordReset: boolean;
  enablePasswordSignIn: boolean;
  enablePasswordlessSignIn: boolean;
  usePasswordlessAsMagicLink: boolean;
  enableMfaRememberDevice: boolean;
  enableNames: boolean;
  allowPasskey: boolean;
  allowRecoveryCode: boolean;
  namesIsRequired: boolean;
  appName: string;
  termsLink: string;
  privacyPolicyLink: string;
  googleClientId: string;
  githubClientId: string;
  appleClientId: string;
  oidcProviders: string[];
  enableUserAttribute: boolean;
  captchaSiteKey: string;
}

const useInitialProps = () => {
  const initialProps: InitialProps = useMemo(
    () => {
      const intialProps = (
        '__initialProps' in window &&
        typeof window.__initialProps === 'object' &&
        !!window.__initialProps
      )
        ? window.__initialProps
        : {
          locales: [],
          logoUrl: '',
        }

      const locales = 'locales' in intialProps ? String(intialProps.locales).split(',') : []

      return {
        locales: locales as typeConfig.Locale[],
        logoUrl: 'logoUrl' in intialProps ? String(intialProps.logoUrl) : '',
        googleClientId: 'googleClientId' in intialProps ? String(intialProps.googleClientId) : '',
        githubClientId: 'githubClientId' in intialProps ? String(intialProps.githubClientId) : '',
        appleClientId: 'appleClientId' in intialProps ? String(intialProps.appleClientId) : '',
        oidcProviders: 'oidcProviders' in intialProps && intialProps.oidcProviders ? String(intialProps.oidcProviders).split(',') : [],
        enableLocaleSelector: 'enableLocaleSelector' in intialProps ? Boolean(intialProps.enableLocaleSelector) : false,
        enableSignUp: 'enableSignUp' in intialProps ? Boolean(intialProps.enableSignUp) : false,
        enablePasswordReset: 'enablePasswordReset' in intialProps ? Boolean(intialProps.enablePasswordReset) : false,
        enablePasswordSignIn: 'enablePasswordSignIn' in intialProps ? Boolean(intialProps.enablePasswordSignIn) : false,
        enablePasswordlessSignIn: 'enablePasswordlessSignIn' in intialProps ? Boolean(intialProps.enablePasswordlessSignIn) : false,
        usePasswordlessAsMagicLink: 'usePasswordlessAsMagicLink' in intialProps ? Boolean(intialProps.usePasswordlessAsMagicLink) : false,
        enableMfaRememberDevice: 'enableMfaRememberDevice' in intialProps ? Boolean(intialProps.enableMfaRememberDevice) : false,
        enableNames: 'enableNames' in intialProps ? Boolean(intialProps.enableNames) : false,
        namesIsRequired: 'namesIsRequired' in intialProps ? Boolean(intialProps.namesIsRequired) : false,
        enableUserAttribute: 'enableUserAttribute' in intialProps ? Boolean(intialProps.enableUserAttribute) : false,
        termsLink: 'termsLink' in intialProps ? String(intialProps.termsLink) : '',
        privacyPolicyLink: 'privacyPolicyLink' in intialProps ? String(intialProps.privacyPolicyLink) : '',
        appName: 'appName' in intialProps ? String(intialProps.appName) : '',
        allowPasskey: 'allowPasskey' in intialProps ? Boolean(intialProps.allowPasskey) : false,
        allowRecoveryCode: 'allowRecoveryCode' in intialProps ? Boolean(intialProps.allowRecoveryCode) : false,
        captchaSiteKey: 'captchaSiteKey' in intialProps ? String(intialProps.captchaSiteKey) : '',
      }
    },
    [],
  )

  return { initialProps }
}

export default useInitialProps
