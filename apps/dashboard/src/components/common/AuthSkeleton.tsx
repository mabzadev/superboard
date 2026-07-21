import { Skeleton } from "@/components/ui/skeleton";

export default function AuthSkeleton() {
  return (
    <div className="bg-muted flex min-h-svh flex-col items-center justify-center p-6 md:p-10 w-full">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col gap-4 rounded-xl border bg-card p-6">
          <Skeleton className="h-7 w-40 mx-auto" />
          <Skeleton className="h-4 w-56 mx-auto" />
          <div className="space-y-4 mt-2">
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
        </div>
      </div>
    </div>
  );
}
