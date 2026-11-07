import { useEffect } from 'hono/jsx'
import { typeConfig } from '../../configs'
import {
  useSubmitError, View, useSignUpForm,
  useInitialProps, useCaptcha,
} from '../hooks'
import { getAuthorizeParams } from '../tools/param'
import { SignUp as SignUpBlock } from '../blocks'

export interface SignUpProps {
  locale: typeConfig.Locale;
  onSwitchView: (view: View, response?: any) => void;
}

const SignUp = ({
  locale,
  onSwitchView,
}: SignUpProps) => {
  const { initialProps } = useInitialProps()
  const params = getAuthorizeParams()

  const {
    submitError, handleSubmitError,
  } = useSubmitError({
    onSwitchView,
    locale,
  })
  const captcha = useCaptcha()
  const {
    values, errors, handleChange, handleSubmit, isSubmitting, userAttributes, getSignUpInfo,
  } = useSignUpForm({
    locale,
    initialProps,
    params,
    onSubmitError: handleSubmitError,
    onSwitchView,
    captchaToken: captcha.token,
    onCaptchaReset: captcha.reset,
  })

  useEffect(
    () => {
      getSignUpInfo()
    },
    [getSignUpInfo],
  )

  return (
    <SignUpBlock
      locale={locale}
      onSubmit={handleSubmit}
      onChange={handleChange}
      values={values}
      errors={errors}
      submitError={submitError}
      onSwitchView={onSwitchView}
      initialProps={initialProps}
      isSubmitting={isSubmitting}
      userAttributes={userAttributes}
      captchaResetCount={captcha.resetCount}
      onCaptchaToken={captcha.setToken}
    />
  )
}

export default SignUp
