import React, { useRef, useCallback, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  ResolvedRedirects,
  ResolvedPlatformRedirect,
} from "@/hooks/useResolvedRedirects";
import {
  Smartphone,
  Monitor,
  AppWindow,
  Eye,
  ArrowDown,
  QrCode,
  Store,
  Globe,
  MousePointerClick,
  Link2,
  Download,
  ImageDown,
  Copy,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { handleCopyText } from "@/lib/copyTextHelper";

const RedirectPreviewModal = ({
  open,
  onOpenChange,
  resolvedRedirects,
  linkUrl,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resolvedRedirects: ResolvedRedirects;
  linkUrl?: string;
}) => {
  const treeRef = useRef<HTMLDivElement>(null);

  const handleDownload = useCallback(async () => {
    if (!treeRef.current) return;
    const { toPng } = await import("html-to-image");
    const isDark = document.documentElement.classList.contains("dark");
    const dataUrl = await toPng(treeRef.current, {
      backgroundColor: isDark ? "#1a1a1a" : "white",
      pixelRatio: 2,
      style: { padding: "24px" },
    });
    const link = document.createElement("a");
    link.download = "redirect-preview.png";
    link.href = dataUrl;
    link.click();
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[90vw] xl:max-w-[1400px] max-h-[90vh] p-0 gap-0 overflow-hidden border-sidebar-border flex flex-col">
        <DialogDescription className="sr-only">
          Preview of redirect paths for each platform
        </DialogDescription>
        <DialogHeader className="px-6 pt-5 pb-4 shrink-0">
          <div className="flex items-center justify-between pr-8">
            <div>
              <DialogTitle className="text-base font-semibold">
                Redirect Preview
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Shows what happens when a user clicks this link on each device.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <ImageDown className="h-3.5 w-3.5" />
              Export
            </Button>
          </div>
        </DialogHeader>

        <Separator />

        <div className="overflow-auto px-6 pb-6" ref={treeRef}>
          {/* Root node */}
          <div className="flex flex-col items-center pt-5 pb-3">
            <div
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-medium overflow-hidden"
              style={{ borderRadius: "9999px" }}
            >
              <MousePointerClick className="h-3.5 w-3.5" />
              User clicks link
            </div>
            {linkUrl && (
              <span className="text-[10px] font-mono text-muted-foreground mt-1.5">
                {linkUrl}
              </span>
            )}
          </div>

          {/* Connector line down */}
          <div className="flex justify-center">
            <div className="w-px h-5 bg-sidebar-border" />
          </div>

          {/* Horizontal connector across 3 columns */}
          <div className="mx-auto" style={{ width: "calc(100% - 120px)" }}>
            <div className="h-px bg-sidebar-border" />
          </div>

          {/* Three platform branches side by side */}
          <div className="grid grid-cols-3 gap-3 min-w-[700px]">
            <PlatformBranch
              redirect={resolvedRedirects.ios}
              icon={<Smartphone className="h-4 w-4" />}
              label="iOS"
              storeName="App Store"
            />
            <PlatformBranch
              redirect={resolvedRedirects.android}
              icon={<Smartphone className="h-4 w-4" />}
              label="Android"
              storeName="Google Play"
            />
            <PlatformBranch
              redirect={resolvedRedirects.desktop}
              icon={<Monitor className="h-4 w-4" />}
              label="Desktop"
              storeName=""
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

/* ── Shared building blocks ────────────────────────────────── */

const VLine = ({ className }: { className?: string }) => (
  <div className="flex justify-center">
    <div className={cn("w-px h-4 bg-sidebar-border", className)} />
  </div>
);

const VArrow = () => (
  <div className="flex justify-center py-0.5">
    <ArrowDown className="h-3 w-3 text-muted-foreground/50" />
  </div>
);

const TreeNode = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "rounded-lg border border-sidebar-border bg-background px-2.5 py-2 text-center transition-colors",
      className
    )}
  >
    {children}
  </div>
);

const UrlBox = ({ url, label }: { url: string; label?: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!url) return;
    handleCopyText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className={cn(
        "rounded-lg border max-w-full w-fit overflow-hidden transition-colors",
        copied
          ? "border-valid-green/30 bg-valid-green-light/10"
          : "border-primary/20 bg-primary/5"
      )}
    >
      {label && (
        <span className="text-[10px] text-muted-foreground block px-2.5 pt-1.5 font-medium text-center">
          {label}
        </span>
      )}
      <div className="flex items-center gap-1 px-2 py-1.5 overflow-hidden">
        <span className="text-[11px] font-mono text-primary truncate min-w-0">
          {url || "Not configured"}
        </span>
        {url && (
          <button
            onClick={handleCopy}
            className="shrink-0 p-1 rounded-md hover:bg-background/80 transition-colors"
          >
            {copied ? (
              <Check className="h-3 w-3 text-valid-green" />
            ) : (
              <Copy className="h-3 w-3 text-muted-foreground" />
            )}
          </button>
        )}
      </div>
    </div>
  );
};

const EndNode = ({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "success" | "default";
}) => (
  <div
    className={cn(
      "rounded-lg border px-2.5 py-2 text-center",
      variant === "success"
        ? "bg-valid-green-light/20 border-valid-green/20"
        : "bg-secondary/50 border-sidebar-border"
    )}
  >
    {children}
  </div>
);

const SourceBadge = ({ source }: { source: "custom" | "default" }) => (
  <Badge
    variant={source === "custom" ? "default" : "outline"}
    className="text-[10px] py-0 px-1.5"
  >
    {source === "custom" ? "Custom" : "Default"}
  </Badge>
);

/* ── Platform branch (vertical tree column) ───────────────── */

const PlatformBranch = ({
  redirect,
  icon,
  label,
  storeName,
}: {
  redirect: ResolvedPlatformRedirect;
  icon: React.ReactNode;
  label: string;
  storeName: string;
}) => {
  return (
    <div className="flex flex-col items-center group/platform hover:bg-muted/30 rounded-xl pt-0 pb-3 px-2 transition-colors">
      {/* Connector from horizontal bar */}
      <VLine />

      {/* Platform header */}
      <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-sidebar-border bg-sidebar mb-0.5 w-full justify-center">
        {icon}
        <span className="text-xs font-semibold">{label}</span>
        <SourceBadge source={redirect.source} />
      </div>

      {redirect.type === "redirect_web" && (
        <RedirectWebBranch redirect={redirect} />
      )}
      {redirect.type === "app_or_fallback" && (
        <AppOrFallbackBranch redirect={redirect} storeName={storeName} />
      )}
      {redirect.type === "generated_page" && <GeneratedPageBranch />}
    </div>
  );
};

/* ── Redirect to web ──────────────────────────────────────── */

const RedirectWebBranch = ({
  redirect,
}: {
  redirect: ResolvedPlatformRedirect;
}) => (
  <div className="flex flex-col items-center w-full">
    {redirect.showPreview && (
      <>
        <VArrow />
        <TreeNode className="w-full">
          <div className="flex items-center justify-center gap-1">
            <Eye className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-[10px]">App preview page</span>
          </div>
        </TreeNode>
      </>
    )}
    <VArrow />
    <TreeNode className="w-full">
      <div className="flex items-center justify-center gap-1.5">
        <Globe className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] font-medium">Redirect to web</span>
      </div>
    </TreeNode>
    <VArrow />
    <UrlBox url={redirect.url} />
  </div>
);

/* ── App or fallback ──────────────────────────────────────── */

const AppOrFallbackBranch = ({
  redirect,
  storeName,
}: {
  redirect: ResolvedPlatformRedirect;
  storeName: string;
}) => (
  <div className="flex flex-col items-center w-full">
    {/* Preview page — shown before the install check */}
    {redirect.showPreview && (
      <>
        <VArrow />
        <TreeNode className="w-full mb-0.5">
          <div className="flex items-center justify-center gap-1">
            <Eye className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-[10px]">App preview page</span>
          </div>
        </TreeNode>
      </>
    )}

    <VArrow />
    <TreeNode className="w-full bg-secondary/50">
      <span className="text-[11px] font-semibold">App installed?</span>
    </TreeNode>

    {/* Two sub-branches side by side */}
    <div className="flex w-full mt-1">
      {/* YES branch */}
      <div className="w-1/2 flex flex-col items-center px-0.5 overflow-hidden">
        <VLine className="h-3" />
        <span className="text-[10px] font-semibold text-valid-green mb-1">
          Yes
        </span>
        <EndNode variant="success">
          <div className="flex items-center justify-center gap-1">
            <AppWindow className="h-3 w-3 text-valid-green shrink-0" />
            <span className="text-[10px] font-medium text-valid-green leading-tight">
              Opens app with link data
            </span>
          </div>
        </EndNode>
      </div>

      {/* NO branch */}
      <div className="w-1/2 flex flex-col items-center px-0.5 overflow-hidden">
        <VLine className="h-3" />
        <span className="text-[10px] font-semibold text-muted-foreground mb-1">
          No
        </span>

        {/* Store redirect */}
        {redirect.appStoreRedirect ? (
          <>
            <TreeNode className="w-full">
              <div className="flex items-center justify-center gap-1">
                <Store className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-[10px] font-medium">{storeName}</span>
              </div>
            </TreeNode>
            {/* Deferred deep link */}
            <VLine className="h-2" />
            <TreeNode className="w-full">
              <div className="flex items-center justify-center gap-1">
                <Download className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-[10px]">Installs app</span>
              </div>
            </TreeNode>
            <VLine className="h-2" />
            <EndNode variant="success">
              <div className="flex items-center justify-center gap-1">
                <Link2 className="h-3 w-3 text-valid-green shrink-0" />
                <span className="text-[10px] font-medium text-valid-green leading-tight">
                  App opens with link data
                </span>
              </div>
            </EndNode>
          </>
        ) : (
          <>
            <TreeNode className="w-full">
              <div className="flex items-center justify-center gap-1">
                <Globe className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-[10px]">Fallback</span>
              </div>
            </TreeNode>
            <VLine className="h-2" />
            <UrlBox url={redirect.url} />
          </>
        )}
      </div>
    </div>
  </div>
);

/* ── Generated page (desktop) ─────────────────────────────── */

const GeneratedPageBranch = () => (
  <div className="flex flex-col items-center w-full">
    <VArrow />
    <TreeNode className="w-full">
      <div className="flex items-center justify-center gap-1.5">
        <QrCode className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] font-medium">Grovs page</span>
      </div>
      <span className="text-[10px] text-muted-foreground block mt-0.5">
        QR code + download links
      </span>
    </TreeNode>
  </div>
);

export default RedirectPreviewModal;
