'use client'

import NextLink from 'next/link'
import {
  redirect as nextRedirect,
  usePathname as useNextPathname,
  useRouter as useNextRouter,
} from 'next/navigation'
import { useLocale } from 'next-intl'
import type { ComponentProps } from 'react'

const localized = (href: string, locale: string) => {
  if (!href.startsWith('/')) return href
  if (href.startsWith('/identity/')) return href
  return `/identity/${locale}${href === '/' ? '' : href}`
}

export function Link (props: ComponentProps<typeof NextLink>) {
  const locale = useLocale()
  const href = typeof props.href === 'string'
    ? localized(props.href, locale)
    : props.href
  return <NextLink {...props} href={href} />
}

export function usePathname () {
  const locale = useLocale()
  const pathname = useNextPathname()
  const prefix = `/identity/${locale}`
  const result = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname
  return result || '/'
}

export function useRouter () {
  const locale = useLocale()
  const router = useNextRouter()
  return {
    ...router,
    push: (href: string) => router.push(localized(href, locale)),
    replace: (href: string) => router.replace(localized(href, locale)),
  }
}

export const getPathname = ({ href, locale }: { href: string; locale: string }) =>
  localized(href, locale)

export const redirect = ({ href, locale }: { href: string; locale: string }) =>
  nextRedirect(localized(href, locale))
