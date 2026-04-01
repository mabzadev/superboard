import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Messaging",
};

export default function MessagingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
