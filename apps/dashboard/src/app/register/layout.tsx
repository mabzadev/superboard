import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Register",
  description: "Create a Grovs account to start growing your mobile app.",
};

export default function RegisterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
