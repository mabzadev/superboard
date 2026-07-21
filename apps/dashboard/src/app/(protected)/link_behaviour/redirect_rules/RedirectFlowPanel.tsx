import {
  ArrowRight,
  Monitor,
  Globe,
  MousePointerClick,
  Eye,
  AppWindow,
  Store,
  QrCode,
} from "lucide-react";
import Image from "next/image";
import androidIcon from "@/assets/icons/generic/Android.svg";
import androidIconDark from "@/assets/icons/generic/Android_dark_mode.svg";
import iosIcon from "@/assets/icons/generic/Apple.svg";
import iosIconDark from "@/assets/icons/generic/Apple_dark_mode.svg";
import React from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";

/* ─── Props ─── */
interface RedirectFlowPanelProps {
  androidApp: boolean;
  androidStore: boolean;
  androidCustomUrl: string;
  androidShowPreview: boolean;
  iosApp: boolean;
  iosStore: boolean;
  iosCustomUrl: string;
  iosShowPreview: boolean;
  desktopGeneratedPage: boolean;
  desktopCustomUrl: string;
  defaultUrl: string;
}

/* ─── Primitives ─── */

const NODE_H = "h-8";

const HArrow = () => (
  <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0 mx-1.5" />
);

const Node = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "rounded-md border border-sidebar-border bg-sidebar px-3 shrink-0 text-[11px] flex items-center",
      NODE_H,
      className
    )}
  >
    {children}
  </div>
);

const UrlNode = ({ url }: { url: string }) => (
  <Node>
    <span className="font-mono truncate">{formatUrl(url)}</span>
  </Node>
);

function formatUrl(url: string): string {
  if (!url) return "Not set";
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    const host = u.hostname.replace(/^www\./, "");
    return host.length > 22 ? host.slice(0, 20) + "..." : host;
  } catch {
    return url.length > 22 ? url.slice(0, 20) + "..." : url;
  }
}

/* ─── Fork: vertical rail with two horizontal branches ─── */
function Fork({
  branches,
}: {
  branches: { label: string; node: React.ReactNode }[];
}) {
  return (
    <div className="flex shrink-0">
      {/* Vertical rail */}
      <div className="flex flex-col items-center shrink-0 w-0">
        <div className="h-4 shrink-0" />
        <div className="flex-1 w-px bg-sidebar-border" />
        <div className="h-4 shrink-0" />
      </div>
      {/* Branch rows */}
      <div className="flex flex-col gap-3">
        {branches.map((b) => (
          <div key={b.label} className={cn("flex items-center", NODE_H)}>
            <div className="w-5 h-px bg-sidebar-border shrink-0" />
            <Node className="w-[100px] justify-center font-medium">
              {b.label}
            </Node>
            <HArrow />
            {b.node}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Platform flows ─── */

function AppFlow({
  showPreview,
  storeName,
  store,
  customUrl,
}: {
  showPreview: boolean;
  storeName: string;
  store: boolean;
  customUrl: string;
}) {
  return (
    <div className="flex items-center">
      {showPreview && (
        <>
          <Node>
            <div className="flex items-center gap-1.5">
              <Eye className="h-3 w-3 text-muted-foreground shrink-0" />
              Preview page
            </div>
          </Node>
          <HArrow />
        </>
      )}
      <Node>
        <div className="flex items-center gap-1.5">
          <AppWindow className="h-3 w-3 text-muted-foreground shrink-0" />
          <span className="font-medium">Try to open app</span>
        </div>
      </Node>
      <div className="w-3 h-px bg-sidebar-border shrink-0" />
      <Fork
        branches={[
          {
            label: "Installed",
            node: (
              <Node>
                <div className="flex items-center gap-1.5">
                  <AppWindow className="h-3 w-3 text-muted-foreground shrink-0" />
                  Opens app
                </div>
              </Node>
            ),
          },
          {
            label: "Not installed",
            node: store ? (
              <Node>
                <div className="flex items-center gap-1.5">
                  <Store className="h-3 w-3 text-muted-foreground shrink-0" />
                  {storeName}
                </div>
              </Node>
            ) : (
              <UrlNode url={customUrl} />
            ),
          },
        ]}
      />
    </div>
  );
}

function WebFlow({
  customUrl,
  showPreview,
}: {
  customUrl: string;
  showPreview?: boolean;
}) {
  if (customUrl) {
    return (
      <div className="flex items-center">
        {showPreview && (
          <>
            <Node>
              <div className="flex items-center gap-1.5">
                <Eye className="h-3 w-3 text-muted-foreground shrink-0" />
                Preview page
              </div>
            </Node>
            <HArrow />
          </>
        )}
        <Node>
          <div className="flex items-center gap-1.5">
            <Globe className="h-3 w-3 text-muted-foreground shrink-0" />
            Redirect to web
          </div>
        </Node>
        <HArrow />
        <UrlNode url={customUrl} />
      </div>
    );
  }
  return (
    <Node>
      <div className="flex items-center gap-1.5">
        <Globe className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-muted-foreground">Default fallback</span>
      </div>
    </Node>
  );
}

function DesktopFlow({
  generatedPage,
  customUrl,
}: {
  generatedPage: boolean;
  customUrl: string;
}) {
  if (generatedPage) {
    return (
      <Node>
        <div className="flex items-center gap-1.5">
          <QrCode className="h-3 w-3 text-muted-foreground shrink-0" />
          Grovs page
        </div>
      </Node>
    );
  }
  return <WebFlow customUrl={customUrl} />;
}

/* ─── Platform group ─── */

function PlatformGroup({
  icon,
  label,
  description,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        {icon}
        <span className="text-sm font-semibold">{label}</span>
        {description && (
          <span className="text-xs text-muted-foreground">· {description}</span>
        )}
      </div>
      <div className="overflow-x-auto scrollbar-hide">{children}</div>
    </div>
  );
}

/* ─── Trunk: vertical rail connecting platform groups ─── */

function TrunkBranch({
  children,
  isLast,
}: {
  children: React.ReactNode;
  isLast?: boolean;
}) {
  return (
    <div className="flex">
      {/* Rail segment */}
      <div className="flex flex-col items-center shrink-0 w-0">
        {isLast ? (
          <>
            <div className="h-8 w-px bg-sidebar-border shrink-0" />
            <div className="flex-1" />
          </>
        ) : (
          <div className="flex-1 w-px bg-sidebar-border" />
        )}
      </div>
      {/* Horizontal tap + content */}
      <div className="flex items-start py-6 flex-1">
        <div className="w-5 h-px bg-sidebar-border mt-[10px] shrink-0" />
        {children}
      </div>
    </div>
  );
}

/* ─── Main ─── */
const RedirectFlowPanel = ({
  androidApp,
  androidStore,
  androidCustomUrl,
  androidShowPreview,
  iosApp,
  iosStore,
  iosCustomUrl,
  iosShowPreview,
  desktopGeneratedPage,
  desktopCustomUrl,
}: RedirectFlowPanelProps) => {
  const { resolvedTheme } = useTheme();
  return (
    <div className="flex flex-col p-5">
      <div className="flex items-center gap-3 mb-5">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-sm font-semibold">Redirect Flow</label>
          <span className="text-xs text-muted-foreground">
            What happens when a user clicks a link on each platform.
          </span>
        </div>
      </div>

      <div className="flex flex-col">
        {/* Root */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20 text-xs font-medium w-fit">
          <MousePointerClick className="h-3.5 w-3.5" />
          Link Clicked
        </div>

        {/* Trunk */}
        <div className="ml-3 flex flex-col pt-3">
          <TrunkBranch>
            <PlatformGroup
              icon={
                <Image
                  src={resolvedTheme === "dark" ? androidIconDark : androidIcon}
                  alt="android"
                  width={18}
                  height={18}
                  className="w-[18px] h-[18px]"
                />
              }
              label="Android"
              description={
                androidApp
                  ? "Link opens the app"
                  : "Link redirects to a web URL"
              }
            >
              {androidApp ? (
                <AppFlow
                  showPreview={androidShowPreview}
                  storeName="Play Store"
                  store={androidStore}
                  customUrl={androidCustomUrl}
                />
              ) : (
                <WebFlow
                  customUrl={androidCustomUrl}
                  showPreview={androidShowPreview}
                />
              )}
            </PlatformGroup>
          </TrunkBranch>

          <TrunkBranch>
            <PlatformGroup
              icon={
                <Image
                  src={resolvedTheme === "dark" ? iosIconDark : iosIcon}
                  alt="ios"
                  width={16}
                  height={18}
                  className="w-4 h-[18px]"
                />
              }
              label="iOS"
              description={
                iosApp ? "Link opens the app" : "Link redirects to a web URL"
              }
            >
              {iosApp ? (
                <AppFlow
                  showPreview={iosShowPreview}
                  storeName="App Store"
                  store={iosStore}
                  customUrl={iosCustomUrl}
                />
              ) : (
                <WebFlow
                  customUrl={iosCustomUrl}
                  showPreview={iosShowPreview}
                />
              )}
            </PlatformGroup>
          </TrunkBranch>

          <TrunkBranch isLast>
            <PlatformGroup
              icon={
                <Monitor className="h-[18px] w-[18px] text-muted-foreground" />
              }
              label="Desktops & Laptops"
              description={
                desktopGeneratedPage
                  ? "Link shows Grovs landing page"
                  : "Link redirects to a web URL"
              }
            >
              <DesktopFlow
                generatedPage={desktopGeneratedPage}
                customUrl={desktopCustomUrl}
              />
            </PlatformGroup>
          </TrunkBranch>
        </div>
      </div>
    </div>
  );
};

export default RedirectFlowPanel;
