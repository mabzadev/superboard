"use client";
import AppHeader from "@/components/layout/app-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProjectSelection } from "@/context/useProjectSelection";
import { useState } from "react";
import { Copy, Eye, EyeOff, KeyRound } from "lucide-react";
import { handleCopyText } from "@/lib/copyTextHelper";
import { config } from "@/lib/config";

const AccessKeyPage = () => {
  const { selectedInstance } = useProjectSelection();
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="flex flex-col relative overflow-hidden h-dvh">
      <div className="border-b border-sidebar-border">
        <AppHeader hideEnvSelect />
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-col overflow-hidden min-w-0 w-full">
          <div className="flex-1 overflow-auto">
            <div className="flex flex-col gap-0 px-6 py-4 max-w-[800px]">
              <div className="flex flex-col gap-5">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-muted shrink-0">
                    <KeyRound className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold">Access Key</span>
                    <span className="text-xs text-muted-foreground leading-snug">
                      Use this key to authenticate with the grovs SDK. Only
                      share it with developers.
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <div className="flex w-full relative">
                      <Input
                        type={revealed ? "text" : "password"}
                        className="pr-10 font-mono text-xs"
                        readOnly
                        value={selectedInstance?.api_key}
                      />
                      <button
                        type="button"
                        onClick={() => setRevealed(!revealed)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {revealed ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="pl-3 pr-4 shrink-0 h-9"
                      onClick={() =>
                        selectedInstance &&
                        handleCopyText(selectedInstance.api_key)
                      }
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copy
                    </Button>
                  </div>
                </div>

                <div className="rounded-xl border border-sidebar-border bg-muted/30 p-5">
                  <span className="text-sm text-muted-foreground leading-relaxed">
                    Need to regenerate your key? Contact{" "}
                    <a
                      href={`mailto:${config.supportEmail}`}
                      className="text-blue-600 dark:text-blue-400 underline underline-offset-4 hover:opacity-80 transition-opacity"
                    >
                      {config.supportEmail}
                    </a>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AccessKeyPage;
