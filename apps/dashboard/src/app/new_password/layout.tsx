
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "New Password",
  description: "Set a new password for your SuperBoard account.",
};

export default function NewPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
