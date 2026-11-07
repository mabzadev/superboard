import { Context } from 'hono'
import { env } from 'hono/adapter'
import {
  variableConfig, typeConfig,
} from '../configs'

export interface Branding {
  logoUrl: string;
  emailLogoUrl: string;
  fontFamily: string;
  fontUrl: string;
  layoutColor: string;
  labelColor: string;
  primaryButtonColor: string;
  primaryButtonLabelColor: string;
  primaryButtonBorderColor: string;
  secondaryButtonColor: string;
  secondaryButtonLabelColor: string;
  secondaryButtonBorderColor: string;
  criticalIndicatorColor: string;
  termsLink: string;
  privacyPolicyLink: string;
}

export const getBranding = (c: Context<typeConfig.Context>): Branding => {
  const {
    COMPANY_LOGO_URL: logoUrl,
    COMPANY_EMAIL_LOGO_URL: emailLogoUrl,
    TERMS_LINK: termsLink,
    PRIVACY_POLICY_LINK: privacyPolicyLink,
  } = env(c)
  return {
    fontFamily: variableConfig.DefaultBranding.FontFamily,
    fontUrl: variableConfig.DefaultBranding.FontUrl,
    layoutColor: variableConfig.DefaultBranding.LayoutColor,
    labelColor: variableConfig.DefaultBranding.LabelColor,
    primaryButtonColor: variableConfig.DefaultBranding.PrimaryButtonColor,
    primaryButtonLabelColor: variableConfig.DefaultBranding.PrimaryButtonLabelColor,
    primaryButtonBorderColor: variableConfig.DefaultBranding.PrimaryButtonBorderColor,
    secondaryButtonColor: variableConfig.DefaultBranding.SecondaryButtonColor,
    secondaryButtonLabelColor: variableConfig.DefaultBranding.SecondaryButtonLabelColor,
    secondaryButtonBorderColor: variableConfig.DefaultBranding.SecondaryButtonBorderColor,
    criticalIndicatorColor: variableConfig.DefaultBranding.CriticalIndicatorColor,
    termsLink,
    privacyPolicyLink,
    logoUrl,
    emailLogoUrl,
  }
}
