import { typeConfig } from '../../configs'
import {
  useSubmitError, View, useRecoveryCodeForm,
} from '../hooks'
import { getAuthorizeParams } from '../tools/param'
import { RecoveryCodeSignIn as RecoveryCodeSignInBlock } from '../blocks'

export interface RecoveryCodeSignInProps {
  locale: typeConfig.Locale;
  onSwitchView: (view: View, response?: any) => void;
}

const RecoveryCodeSignIn = ({
  locale,
  onSwitchView,
}: RecoveryCodeSignInProps) => {
  const params = getAuthorizeParams()

  const {
    submitError, handleSubmitError,
  } = useSubmitError({
    onSwitchView,
    locale,
  })

  const {
    values, errors, handleChange, handleSubmit, isSubmitting,
    newRecoveryCode, handleContinue,
  } = useRecoveryCodeForm({
    locale,
    params,
    onSubmitError: handleSubmitError,
    onSwitchView,
  })

  return (
    <RecoveryCodeSignInBlock
      locale={locale}
      onSubmit={handleSubmit}
      onChange={handleChange}
      values={values}
      errors={errors}
      submitError={submitError}
      onSwitchView={onSwitchView}
      isSubmitting={isSubmitting}
      newRecoveryCode={newRecoveryCode}
      handleContinue={handleContinue}
    />
  )
}

export default RecoveryCodeSignIn
