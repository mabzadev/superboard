import { typeConfig } from '../../configs'
import { getAuthCodeExpiredParams } from '../tools/param'
import { AuthCodeExpired as AuthCodeExpiredBlock } from '../blocks'

const AuthCodeExpired = ({ locale }: {
  locale: typeConfig.Locale;
}) => {
  const authCodeExpiredParams = getAuthCodeExpiredParams()

  return (
    <AuthCodeExpiredBlock
      locale={locale}
      authCodeExpiredParams={authCodeExpiredParams}
    />
  )
}

export default AuthCodeExpired
