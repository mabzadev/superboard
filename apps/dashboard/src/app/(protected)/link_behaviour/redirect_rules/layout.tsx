
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Redirect Rules",
};

export default function RedirectRulesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
