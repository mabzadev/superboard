import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Infrastructure",
  description: "OpenGrow Workers, endpoints, data and background-job health.",
};

export default function InfrastructureLayout({ children }: { children: React.ReactNode }) {
  return children;
}
