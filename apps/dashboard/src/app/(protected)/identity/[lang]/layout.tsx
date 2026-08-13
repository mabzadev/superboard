import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import Setup from 'app/Setup'
import english from 'identity/translations/en.json'
import french from 'identity/translations/fr.json'

export const metadata: Metadata = {
  title: 'Identity · SuperBoard',
  description: 'Authentication, authorization and identity administration',
}

const messages = { en: english, fr: french } as const

export default async function IdentityLayout ({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params
  if (lang !== 'en' && lang !== 'fr') notFound()

  return (
    <NextIntlClientProvider locale={lang} messages={messages[lang]}>
      <Setup>{children}</Setup>
    </NextIntlClientProvider>
  )
}
