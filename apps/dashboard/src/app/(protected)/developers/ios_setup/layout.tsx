import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "iOS Setup",
};

export default function IosSetupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
