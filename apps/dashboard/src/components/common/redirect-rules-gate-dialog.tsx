"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PencilRuler } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

const RedirectRulesGateDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleGoToRules = () => {
    onOpenChange(false);
    const query = searchParams.toString();
    router.push(`/link_behaviour/redirect_rules${query ? `?${query}` : ""}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px] p-0 gap-0 border-sidebar-border">
        <DialogHeader className="sr-only">
          <DialogTitle>Redirect rules required</DialogTitle>
          <DialogDescription>
            You need to configure redirect rules before creating links or
            campaigns.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center text-center px-8 pt-8 pb-6 gap-4">
          <div className="flex items-center justify-center h-12 w-12 rounded-xl bg-muted">
            <PencilRuler className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="flex flex-col gap-1.5">
            <h3 className="text-base font-semibold tracking-tight">
              Set up redirect rules first
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Before creating links, you need to configure how they behave on
              each platform. This defines where users are sent when they click
              your links.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 px-8 pb-8">
          <Button onClick={handleGoToRules}>
            <PencilRuler className="h-3.5 w-3.5" />
            Configure Redirect Rules
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Maybe later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default RedirectRulesGateDialog;
