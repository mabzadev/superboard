"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Code2, Copy, KeyRound, Plus, RefreshCw } from "lucide-react";

import {
  flowsApi,
  type FlowEnvironment,
  type FlowLanguageGroup,
} from "@/api/flows/flowsService";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  showErrorNotification,
  showSuccessNotification,
} from "@/lib/Notifications";
import { config } from "@/lib/config";
import { useFlows } from "./FlowsContext";
import { FlowsPage } from "./FlowsPage";
import { useFlowI18n } from "./i18n";

export function EnvironmentsSettingsPage() {
  const { t, tr } = useFlowI18n();
  const { projectRef } = useFlows();
  const [items, setItems] = useState<FlowEnvironment[]>([]);
  const [open, setOpen] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!projectRef) return;
    try {
      setItems(await flowsApi.listEnvironments(projectRef));
    } catch (cause) {
      showErrorNotification(message(cause, t("apiFailure")));
    }
  }, [projectRef, t]);
  useEffect(() => {
    void load();
  }, [load]);
  const rotate = async (id: string) => {
    if (!projectRef) return;
    try {
      const result = await flowsApi.rotateEnvironmentKey(projectRef, id);
      setRevealedKey(result.sdk_key);
      showSuccessNotification(tr("SDK key rotated"));
    } catch (cause) {
      showErrorNotification(message(cause, t("apiFailure")));
    }
  };
  return (
    <FlowsPage
      title={t("environments")}
      description={t("environmentsDescription")}
      actions={
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus /> {tr("New environment")}
            </Button>
          </DialogTrigger>
          <CreateEnvironmentDialog
            onCreated={() => {
              setOpen(false);
              void load();
            }}
          />
        </Dialog>
      }
    >
      {revealedKey && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="text-sm">{tr("New SDK key")}</CardTitle>
            <CardDescription>{t("revealOnce")}</CardDescription>
          </CardHeader>
          <CardContent>
            <CopyField value={revealedKey} />
          </CardContent>
        </Card>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((environment) => (
          <Card key={environment.id}>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>{environment.name}</CardTitle>
                <span className="rounded-full border bg-muted px-2 py-0.5 text-xs capitalize">
                  {environment.kind}
                </span>
              </div>
              <CardDescription className="font-mono">
                {environment.key}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <p className="text-sm text-muted-foreground">
                {environment.allow_draft
                  ? tr("Draft releases allowed")
                  : tr("Published versions only")}
              </p>
              <div className="flex items-center gap-2 rounded bg-muted px-3 py-2 font-mono text-xs">
                <KeyRound className="size-4" />
                <span className="flex-1">••••••••••••</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void rotate(environment.id)}
              >
                <RefreshCw /> {t("rotateKey")}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </FlowsPage>
  );
}

function CreateEnvironmentDialog({ onCreated }: { onCreated: () => void }) {
  const { t, tr } = useFlowI18n();
  const { projectRef } = useFlows();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [kind, setKind] = useState("development");
  const [allowDraft, setAllowDraft] = useState(true);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!projectRef || !name || !key) return;
    setBusy(true);
    try {
      const result = await flowsApi.createEnvironment(projectRef, {
        name,
        key,
        kind,
        allow_draft: allowDraft,
      });
      showSuccessNotification(
        `${tr("New environment created")}. ${tr("New SDK key")}: ${result.sdk_key ?? "generated"}`
      );
      onCreated();
    } catch (cause) {
      showErrorNotification(message(cause, t("apiFailure")));
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{tr("New environment")}</DialogTitle>
        <DialogDescription>
          {tr(
            "SDK keys are isolated and rotatable. Only development environments can use drafts."
          )}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <label className="grid gap-2">
          <Label>{t("name")}</Label>
          <Input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (!key) setKey(identifier(event.target.value));
            }}
          />
        </label>
        <label className="grid gap-2">
          <Label>{t("identifier")}</Label>
          <Input
            className="font-mono"
            value={key}
            onChange={(event) => setKey(identifier(event.target.value))}
          />
        </label>
        <label className="grid gap-2">
          <Label>{tr("Kind")}</Label>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="development">{tr("Development")}</SelectItem>
              <SelectItem value="test">{tr("Test")}</SelectItem>
              <SelectItem value="production">{tr("Production")}</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <div className="flex items-center justify-between rounded border p-3">
          <Label>{tr("Allow draft releases")}</Label>
          <Switch checked={allowDraft} onCheckedChange={setAllowDraft} />
        </div>
      </div>
      <DialogFooter>
        <Button disabled={!name || !key || busy} onClick={() => void create()}>
          {busy ? t("saving") : t("create")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function LocalizationSettingsPage() {
  const { t, tr } = useFlowI18n();
  const { projectRef } = useFlows();
  const [groups, setGroups] = useState<FlowLanguageGroup[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [defaultLocale, setDefaultLocale] = useState("en");
  const [locales, setLocales] = useState("en, fr");
  const [fallbacks, setFallbacks] = useState("fr:en");
  const load = useCallback(async () => {
    if (!projectRef) return;
    try {
      const result = await flowsApi.listLocalization(projectRef);
      setGroups(result);
      const selected =
        result.find((item) => item.id === selectedId) ?? result[0];
      if (selected) {
        setSelectedId(selected.id);
        setName(selected.name);
        setDefaultLocale(selected.default_locale);
        setLocales(selected.locales.join(", "));
        setFallbacks(
          Object.entries(selected.fallbacks)
            .map(([from, to]) => `${from}:${to}`)
            .join(", ")
        );
      }
    } catch (cause) {
      showErrorNotification(message(cause, t("apiFailure")));
    }
  }, [projectRef, selectedId, t]);
  useEffect(() => {
    void load();
  }, [load]);
  const save = async () => {
    if (!projectRef) return;
    try {
      await flowsApi.saveLocalization(projectRef, {
        id: selectedId ?? undefined,
        name,
        default_locale: defaultLocale,
        locales: csv(locales),
        fallbacks: parseFallbacks(fallbacks),
      });
      showSuccessNotification(tr("Localization saved"));
      await load();
    } catch (cause) {
      showErrorNotification(message(cause, t("apiFailure")));
    }
  };
  return (
    <FlowsPage
      title={t("localization")}
      description={t("localizationDescription")}
    >
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="self-start">
          <CardHeader>
            <CardTitle>{tr("Language groups")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1">
            {groups.map((group) => (
              <Button
                key={group.id}
                variant={selectedId === group.id ? "secondary" : "ghost"}
                className="justify-start"
                onClick={() => {
                  setSelectedId(group.id);
                  setName(group.name);
                  setDefaultLocale(group.default_locale);
                  setLocales(group.locales.join(", "));
                  setFallbacks(
                    Object.entries(group.fallbacks)
                      .map(([from, to]) => `${from}:${to}`)
                      .join(", ")
                  );
                }}
              >
                {group.name}
              </Button>
            ))}
            <Button
              variant="outline"
              className="mt-2"
              onClick={() => {
                setSelectedId(null);
                setName(tr("New group"));
                setDefaultLocale("en");
                setLocales("en, fr");
                setFallbacks("fr:en");
              }}
            >
              <Plus /> {tr("New group")}
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{name || tr("Language group")}</CardTitle>
            <CardDescription>
              {tr(
                "Translated block fields show missing values and use these fallback rules at runtime."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid max-w-xl gap-4">
            <label className="grid gap-2">
              <Label>{t("name")}</Label>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="grid gap-2">
              <Label>{t("defaultLocale")}</Label>
              <Input
                value={defaultLocale}
                onChange={(event) =>
                  setDefaultLocale(identifier(event.target.value))
                }
              />
            </label>
            <label className="grid gap-2">
              <Label>{t("locales")}</Label>
              <Input
                value={locales}
                onChange={(event) => setLocales(event.target.value)}
                placeholder="en, fr, de"
              />
              <span className="text-xs text-muted-foreground">
                {tr("Comma-separated BCP 47 language codes.")}
              </span>
            </label>
            <label className="grid gap-2">
              <Label>{t("fallbacks")}</Label>
              <Input
                value={fallbacks}
                onChange={(event) => setFallbacks(event.target.value)}
                placeholder="fr-CH:fr, fr:en"
              />
            </label>
            <Button
              className="w-fit"
              disabled={!name || !defaultLocale || csv(locales).length === 0}
              onClick={() => void save()}
            >
              {t("save")}
            </Button>
          </CardContent>
        </Card>
      </div>
    </FlowsPage>
  );
}

const SDK_SNIPPETS = {
  javascript: (projectId: string, environmentKey: string, apiUrl: string) =>
    `import { init } from "@superboard/flows-js";\n\nconst flows = init({\n  apiUrl: "${apiUrl}",\n  projectId: "${projectId}",\n  environment: "${environmentKey}",\n  sdkKey: "YOUR_ENVIRONMENT_SDK_KEY",\n  userId: currentUser.id,\n});`,
  react: (projectId: string, environmentKey: string, apiUrl: string) =>
    `import { FlowsProvider } from "@superboard/flows-react";\n\n<FlowsProvider\n  apiUrl="${apiUrl}"\n  projectId="${projectId}"\n  environment="${environmentKey}"\n  sdkKey="YOUR_ENVIRONMENT_SDK_KEY"\n  userId={user.id}\n>\n  <App />\n</FlowsProvider>`,
  flutter: (projectId: string, environmentKey: string, apiUrl: string) =>
    `await SuperBoardFlows.initialize(\n  apiUrl: '${apiUrl}',\n  projectId: '${projectId}',\n  environment: '${environmentKey}',\n  sdkKey: 'YOUR_ENVIRONMENT_SDK_KEY',\n  userId: currentUser.id,\n);\n\nreturn SuperBoardFlowsOverlay(child: app);`,
  flutterflow: (projectId: string, environmentKey: string, apiUrl: string) =>
    `await superboardFlowsInitialize(\n  apiUrl: '${apiUrl}',\n  projectId: '${projectId}',\n  environment: '${environmentKey}',\n  sdkKey: 'YOUR_ENVIRONMENT_SDK_KEY',\n  userId: currentUserId,\n);`,
} as const;

export type FlowSdkSnippetPlatform = keyof typeof SDK_SNIPPETS;

export function flowsSdkApiUrl(apiUrl: string): string {
  return `${apiUrl.trim().replace(/\/+$/u, "")}/api/v1/flows`;
}

export function flowSdkSnippet(
  platform: FlowSdkSnippetPlatform,
  projectId: string,
  environmentKey: string,
  apiUrl = config.apiUrl
): string {
  return SDK_SNIPPETS[platform](
    projectId,
    environmentKey,
    flowsSdkApiUrl(apiUrl)
  );
}

export function SdkSettingsPage() {
  const { t, tr } = useFlowI18n();
  const { projectRef } = useFlows();
  const [environments, setEnvironments] = useState<FlowEnvironment[]>([]);
  const [environmentKey, setEnvironmentKey] = useState("production");
  useEffect(() => {
    if (!projectRef) return;
    void flowsApi
      .listEnvironments(projectRef)
      .then((items) => {
        setEnvironments(items);
        setEnvironmentKey(items[0]?.key ?? "production");
      })
      .catch((cause: unknown) =>
        showErrorNotification(message(cause, t("apiFailure")))
      );
  }, [projectRef, t]);
  const tabs = useMemo(
    () =>
      [
        {
          id: "javascript",
          label: "JavaScript",
          install:
            "npm install @superboard/flows-js @superboard/flows-js-components",
        },
        {
          id: "react",
          label: "React",
          install:
            "npm install @superboard/flows-react @superboard/flows-react-components",
        },
        {
          id: "flutter",
          label: "Flutter",
          install: "flutter pub add superboard_flows",
        },
        {
          id: "flutterflow",
          label: "FlutterFlow",
          install: "Import SuperBoard Flows custom actions and widgets",
        },
      ] as const,
    []
  );
  return (
    <FlowsPage title={t("sdk")} description={t("sdkDescription")}>
      <Card>
        <CardHeader>
          <CardTitle>{tr("Runtime selection")}</CardTitle>
          <CardDescription>
            {tr(
              "Use the current project identifier and a rotatable environment key. The API stays on SuperBoard."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2">
            <Label>{tr("Project identifier")}</Label>
            <CopyField value={projectRef ?? ""} />
          </label>
          <label className="grid gap-2">
            <Label>{tr("Environment")}</Label>
            <Select value={environmentKey} onValueChange={setEnvironmentKey}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {environments.map((environment) => (
                  <SelectItem key={environment.id} value={environment.key}>
                    {environment.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </CardContent>
      </Card>
      <Tabs defaultValue="javascript">
        <TabsList className="flex h-auto flex-wrap">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((tab) => (
          <TabsContent value={tab.id} key={tab.id}>
            <SdkCodePanel
              title={tab.label}
              install={tr(tab.install)}
              code={flowSdkSnippet(tab.id, projectRef ?? "", environmentKey)}
            />
          </TabsContent>
        ))}
      </Tabs>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Code2 className="size-4" /> {tr("Debug and compatibility")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm text-muted-foreground">
          <p>
            •{" "}
            {tr(
              "Configure SPA navigation and language in the SDK initialization."
            )}
          </p>
          <p>
            •{" "}
            {tr(
              "The debug overlay reconnects WebSockets and displays ordered block updates."
            )}
          </p>
          <p>
            •{" "}
            {tr(
              "Legacy @flows packages remain compatible through the canonical SDK key header supplied by customFetch."
            )}
          </p>
          <p>
            •{" "}
            {tr(
              "Existing Paywall and Onboarding widgets remain deprecated adapters to Flows workflows."
            )}
          </p>
          <p>
            •{" "}
            {tr(
              "Purchases and restores always delegate to Products; Flows never invents revenue."
            )}
          </p>
        </CardContent>
      </Card>
    </FlowsPage>
  );
}

function SdkCodePanel({
  title,
  install,
  code,
}: {
  title: string;
  install: string;
  code: string;
}) {
  const { t, tr } = useFlowI18n();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {tr(
            "Install and initialize with your authenticated application user."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("install")}
          </p>
          <CopyField value={install} />
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {tr("Initialize")}
          </p>
          <div className="relative">
            <pre className="overflow-x-auto rounded-[var(--radius)] border bg-slate-950 p-4 pr-12 text-xs leading-5 text-slate-100">
              <code>{code}</code>
            </pre>
            <CopyButton value={code} className="absolute top-2 right-2" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
function CopyField({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border bg-background p-2 pl-3">
      <code className="min-w-0 flex-1 break-all text-xs">{value || "—"}</code>
      {value && <CopyButton value={value} />}
    </div>
  );
}
function CopyButton({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const { t } = useFlowI18n();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      title={copied ? t("copied") : t("copyCode")}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        });
      }}
    >
      {copied ? <Check /> : <Copy />}
      <span className="sr-only">{t("copyCode")}</span>
    </Button>
  );
}
function message(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}
function identifier(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function csv(value: string) {
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ];
}
function parseFallbacks(value: string) {
  return Object.fromEntries(
    value
      .split(",")
      .map((item) =>
        item
          .trim()
          .split(":")
          .map((part) => part.trim())
      )
      .filter(
        (parts): parts is [string, string] =>
          parts.length === 2 && Boolean(parts[0]) && Boolean(parts[1])
      )
  );
}
