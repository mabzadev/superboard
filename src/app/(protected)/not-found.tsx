import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex w-full flex-col items-center justify-center min-h-screen bg-muted text-center px-4">
      <h2 className="text-2xl font-bold">Page not found</h2>
      <p className="my-4 text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <Button asChild>
        <Link href="/dashboard">Go to Dashboard</Link>
      </Button>
    </div>
  );
}
