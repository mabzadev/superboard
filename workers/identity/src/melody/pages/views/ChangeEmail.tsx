import { typeConfig } from '../../configs'
import {
  useChangeEmailForm, useSubmitError,
} from '../hooks'
import { View } from '../hooks/useCurrentView'
import { ChangeEmail as ChangeEmailBlock } from '../blocks'

interface ChangeEmailProps {
  locale: typeConfig.Locale;
  onSwitchView: (view: View) => void;
}

const ChangeEmail = ({
  locale,
  onSwitchView,
}: ChangeEmailProps) => {
  const {
    handleSubmitError, submitError,
  } = useSubmitError({
    locale,
    onSwitchView,
  })

  const {
    values,
    errors,
    handleChange,
    handleSubmit,
    success,
    redirectUri,
    resent,
    handleResend,
    isSubmitting,
    isResending,
  } = useChangeEmailForm({
    locale,
    onSubmitError: handleSubmitError,
  })

  return (
    <ChangeEmailBlock
      locale={locale}
      success={success}
      onSubmit={handleSubmit}
      onChange={handleChange}
      values={values}
      errors={errors}
      submitError={submitError}
      redirectUri={redirectUri}
      resent={resent}
      onResend={handleResend}
      isSubmitting={isSubmitting}
      isResending={isResending}
    />
  )
}

export default ChangeEmail
