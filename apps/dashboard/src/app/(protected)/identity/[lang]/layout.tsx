import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Setup from "app/Setup";
import IdentityIntlProvider from "identity/IdentityIntlProvider";
import english from "identity/translations/en.json";
import french from "identity/translations/fr.json";

export const metadata: Metadata = {
  title: "Identity · SuperBoard",
  description: "Authentication, authorization and identity administration",
};

const messages = { en: english, fr: french } as const;

export default async function IdentityLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (lang !== "en" && lang !== "fr") notFound();

  return (
    <IdentityIntlProvider locale={lang} messages={messages[lang]}>
      <Setup>{children}</Setup>
    </IdentityIntlProvider>
  );
}
