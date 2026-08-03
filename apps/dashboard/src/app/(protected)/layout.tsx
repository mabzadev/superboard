"use client";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import ProtectedRoute from "@/lib/ProtectedRoute";
import ClientLayout from "./ClientLayout";
import { ProjectSelectionProvider } from "@/context/useProjectSelection";
import React, { Suspense } from "react";
import PageSkeleton from "@/components/common/PageSkeleton";
import CreateCampaignGlobalDialogProvider from "@/context/useCreateCampaignDialogContext";
import LinkDialogProvider from "@/context/useLinkDialogContext";
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProtectedRoute>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-4 focus:bg-background focus:text-foreground"
      >
        Skip to main content
      </a>
      <ProjectSelectionProvider>
        <LinkDialogProvider>
          <CreateCampaignGlobalDialogProvider>
            <ClientLayout>
              <SidebarProvider>
                <AppSidebar />
                <SidebarInset>
                  <main id="main-content">
                    <Suspense fallback={<PageSkeleton />}>
                      {children}
                    </Suspense>
                  </main>
                </SidebarInset>
              </SidebarProvider>
            </ClientLayout>
          </CreateCampaignGlobalDialogProvider>
        </LinkDialogProvider>
      </ProjectSelectionProvider>
    </ProtectedRoute>
  );
}
