import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Web Setup",
};

export default function WebSetupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
