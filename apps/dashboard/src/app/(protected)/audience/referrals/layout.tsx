
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Referrals",
};

export default function ReferralsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
