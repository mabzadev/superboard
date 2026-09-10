import { useEffect } from 'hono/jsx'
import {
  useSubmitError, View,
} from '../hooks'
import { typeConfig } from '../../configs'
import useMfaEnrollForm from '../hooks/useMfaEnrollForm'
import { MfaEnroll as MfaEnrollBlock } from '../blocks'

export interface MfaEnrollProps {
  locale: typeConfig.Locale;
  onSwitchView: (view: View) => void;
}

const MfaEnroll = ({
  locale,
  onSwitchView,
}: MfaEnrollProps) => {
  const {
    submitError, handleSubmitError,
  } = useSubmitError({
    locale,
    onSwitchView,
  })

  const {
    mfaEnrollInfo,
    getMfaEnrollInfo,
    handleEnroll,
    isEnrolling,
  } = useMfaEnrollForm({
    locale,
    onSubmitError: handleSubmitError,
    onSwitchView,
  })

  useEffect(
    () => {
      getMfaEnrollInfo()
    },
    [getMfaEnrollInfo],
  )

  return (
    <MfaEnrollBlock
      locale={locale}
      mfaEnrollInfo={mfaEnrollInfo}
      onEnroll={handleEnroll}
      submitError={submitError}
      isEnrolling={isEnrolling}
    />
  )
}

export default MfaEnroll
