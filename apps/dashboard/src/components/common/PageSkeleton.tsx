import { Skeleton } from "@/components/ui/skeleton";

export default function PageSkeleton() {
  return (
    <div className="flex h-dvh">
      {/* Sidebar skeleton */}
      <div className="hidden md:flex w-64 shrink-0 flex-col gap-4 border-r border-sidebar-border bg-sidebar p-4">
        {/* Project switcher */}
        <Skeleton className="h-10 w-full rounded-md" />
        {/* Nav items */}
        <div className="flex flex-col gap-2 mt-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-md" />
          ))}
        </div>
        <div className="flex flex-col gap-2 mt-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={`s-${i}`} className="h-9 w-full rounded-md" />
          ))}
        </div>
        <div className="flex-1" />
        {/* User avatar */}
        <Skeleton className="h-10 w-full rounded-md" />
      </div>

      {/* Main content area */}
      <div className="flex flex-1 flex-col">
        {/* Header bar */}
        <div className="flex items-center gap-3 px-6 h-14 border-b border-sidebar-border">
          <Skeleton className="h-5 w-32" />
          <div className="flex-1" />
          <Skeleton className="h-8 w-8 rounded-full" />
        </div>

        {/* Content area */}
        <div className="flex-1 p-6 space-y-6">
          <div className="flex gap-4">
            <Skeleton className="h-9 w-[200px]" />
            <Skeleton className="h-9 w-[150px]" />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[130px] rounded-md" />
            ))}
          </div>
          <Skeleton className="h-[400px] rounded-md" />
        </div>
      </div>
    </div>
  );
}
