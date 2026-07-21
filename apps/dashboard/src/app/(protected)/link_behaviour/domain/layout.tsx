
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Domain",
};

export default function DomainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
