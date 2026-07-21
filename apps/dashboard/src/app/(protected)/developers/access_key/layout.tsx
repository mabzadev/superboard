import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Access Key",
};

export default function AccessKeyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
