"use client";

import { formatDistanceToNow, format } from "date-fns";
import { Cable, ExternalLink, Trash2, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import DeleteConfirm from "@/components/common/delete-confirm";
import {
  useMcpTokensQuery,
  useRevokeMcpTokenMutation,
} from "@/hooks/queries/useMcpQueries";
import {
  showSuccessNotification,
  showErrorNotification,
} from "@/lib/Notifications";
import { config } from "@/lib/config";

export default function McpTokensSection() {
  const { data: tokens, isLoading } = useMcpTokensQuery();
  const revokeMutation = useRevokeMcpTokenMutation();

  const handleRevoke = async (tokenId: string) => {
    try {
      await revokeMutation.mutateAsync(tokenId);
      showSuccessNotification("Token revoked");
    } catch {
      showErrorNotification("Failed to revoke token");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold">Connected Apps</span>
        <span className="text-xs text-muted-foreground">
          AI tools connected to your account via MCP (Model Context Protocol).
        </span>
      </div>

      <div className="flex flex-col gap-1 rounded-xl border border-sidebar-border px-5 py-4">
        <span className="text-xs font-medium text-muted-foreground">
          MCP endpoint for this application
        </span>
        <a
          className="break-all font-mono text-xs text-primary hover:underline"
          href={`${config.mcpUrl}/mcp`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {config.mcpUrl}/mcp
        </a>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-sidebar-border overflow-hidden divide-y divide-sidebar-border">
          {[1, 2].map((i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-4">
              <div className="h-4 w-4 bg-muted rounded animate-pulse shrink-0" />
              <div className="flex flex-col gap-1.5 flex-1">
                <div className="h-4 w-32 bg-muted rounded animate-pulse" />
                <div className="h-3 w-48 bg-muted rounded animate-pulse" />
              </div>
              <div className="h-5 w-20 bg-muted rounded-md animate-pulse shrink-0" />
              <div className="h-8 w-20 bg-muted rounded-md animate-pulse shrink-0" />
            </div>
          ))}
        </div>
      ) : !tokens || tokens.length === 0 ? (
        <div className="rounded-xl border border-sidebar-border px-5 py-8 flex flex-col items-center gap-4">
          <div className="flex items-center justify-center h-11 w-11 rounded-xl bg-muted ring-1 ring-sidebar-border">
            <Unplug className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="flex flex-col items-center gap-1 text-center">
            <span className="text-sm font-medium">No connected apps</span>
            <span className="text-xs text-muted-foreground leading-relaxed">
              Connect AI tools like Claude Desktop or Cursor to manage your
              links and analytics directly from your editor.
            </span>
          </div>
          <a
            href={`${config.docsUrl}/mcp`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="outline" size="sm">
              <ExternalLink className="h-3.5 w-3.5" />
              View setup guide
            </Button>
          </a>
        </div>
      ) : (
        <div className="rounded-xl border border-sidebar-border overflow-hidden divide-y divide-sidebar-border">
          {tokens.map((token) => (
            <div key={token.id} className="flex items-center gap-4 px-5 py-4">
              <Cable className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                <span className="text-sm font-medium truncate">
                  {token.name}
                </span>
                <span className="text-xs text-muted-foreground truncate">
                  Added {format(new Date(token.created_at), "MMM d, yyyy")}
                  {token.last_used_at && (
                    <>
                      <span className="mx-1.5 text-muted-foreground/40">·</span>
                      Active{" "}
                      {formatDistanceToNow(new Date(token.last_used_at), {
                        addSuffix: true,
                      })}
                    </>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium",
                    "bg-valid-green/10 text-valid-green"
                  )}
                >
                  <div className="h-1.5 w-1.5 rounded-full bg-valid-green" />
                  Connected
                </div>
                <DeleteConfirm
                  onConfirm={() => handleRevoke(token.id)}
                  title="Revoke access?"
                  description={`This will disconnect "${token.name}" from your account. The application will need to re-authorize to regain access.`}
                  confirmText="Revoke"
                >
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Revoke
                  </Button>
                </DeleteConfirm>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
