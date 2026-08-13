"use client";

import type { AbstractIntlMessages } from "next-intl";
import { NextIntlClientProvider } from "next-intl";
import type { PropsWithChildren } from "react";

export default function IdentityIntlProvider({
  children,
  locale,
  messages,
}: PropsWithChildren<{
  locale: string;
  messages: AbstractIntlMessages;
}>) {
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
