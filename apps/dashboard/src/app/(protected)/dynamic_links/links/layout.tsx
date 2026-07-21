
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Links",
};

export default function LinksLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
