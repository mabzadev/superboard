"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bell,
  CheckCircle2,
  Code2,
  FileCode2,
  Globe,
  KeyRound,
  Link2,
  Package,
  RotateCcw,
  Smartphone,
  Store,
  Trash2,
} from "lucide-react";
import {
  deleteSdkConfiguration,
  getAccessKey,
  getSdkConfiguration,
  saveSdkConfiguration,
  testSdkConfiguration,
  type SdkConfiguration,
  type SdkPlatform,
} from "@/api/app/appService";
import {
  RenderCodeBlock,
  SectionHeader,
  StepNavigation,
  WizardSidebar,
  type CodeBlockData,
  type StepDef,
} from "@/components/developers/SetupShared";
import {
  EmptyProject,
  ModulePage,
  moduleErrorMessage,
} from "@/components/modules/ModulePage";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useProjectSelection } from "@/context/useProjectSelection";
import {
  showErrorNotification,
  showSuccessNotification,
} from "@/lib/Notifications";
import { config } from "@/lib/config";
import sdkCatalog from "../../../../../config/sdk-libraries.json";

type SetupForm = {
  bundle_id: string;
  team_id: string;
  package_name: string;
  sha256: string;
  domain: string;
  push_credential_reference: string;
  store_credential_reference: string;
  minimum_version: string;
  recommended_version: string;
  maintenance_enabled: boolean;
  maintenance_message: string;
  store_url: string;
};

const emptyForm: SetupForm = {
  bundle_id: "",
  team_id: "",
  package_name: "",
  sha256: "",
  domain: "",
  push_credential_reference: "",
  store_credential_reference: "",
  minimum_version: "",
  recommended_version: "",
  maintenance_enabled: false,
  maintenance_message: "",
  store_url: "",
};

const platformLabels: Record<SdkPlatform, string> = {
  ios: "iOS",
  android: "Android",
  web: "Web",
};

const steps: Record<SdkPlatform, StepDef[]> = {
  ios: [
    { name: "Register App", icon: Smartphone, optional: false },
    { name: "URL Scheme", icon: Link2, optional: false },
    { name: "Add the SDK", icon: Package, optional: false },
    { name: "Push Notifications", icon: Bell, optional: true },
    { name: "Store Integration", icon: Store, optional: true },
    { name: "Initialize SDK", icon: Code2, optional: false },
  ],
  android: [
    { name: "Register App", icon: Smartphone, optional: false },
    { name: "Intent Filters", icon: FileCode2, optional: false },
    { name: "Add the SDK", icon: Package, optional: false },
    { name: "Push Notifications", icon: Bell, optional: true },
    { name: "Store Integration", icon: Store, optional: true },
    { name: "Initialize SDK", icon: Code2, optional: false },
  ],
  web: [
    { name: "Register Domain", icon: Globe, optional: false },
    { name: "Add the SDK", icon: Package, optional: false },
    { name: "Integrate the SDK", icon: Code2, optional: false },
  ],
};

function configurationForm(configuration: Record<string, unknown>): SetupForm {
  return {
    ...emptyForm,
    ...Object.fromEntries(
      Object.keys(emptyForm)
        .filter((key) => key !== "maintenance_enabled")
        .map((key) => [
          key,
          typeof configuration[key] === "string" ? configuration[key] : "",
        ])
    ),
    maintenance_enabled: configuration.maintenance_enabled === true,
  } as SetupForm;
}

function code(
  language: string,
  filename: string,
  content: string
): CodeBlockData[] {
  return [{ language, filename, code: content }];
}

function library(id: "ios" | "android" | "javascript") {
  const value = sdkCatalog.libraries.find((item) => item.id === id);
  if (!value) throw new Error(`SDK catalogue entry ${id} is missing`);
  if (!("install" in value) || typeof value.install !== "string") {
    throw new Error(`SDK catalogue entry ${id} has no published installation`);
  }
  return value;
}

function registryLibrary(id: "android" | "javascript") {
  const value = library(id);
  if (!("distribution" in value) || !value.distribution) {
    throw new Error(`SDK catalogue entry ${id} has no distribution contract`);
  }
  return value;
}

export function sdkInstallCode(
  platform: "android" | "ios" | "web"
): CodeBlockData[] {
  if (platform === "ios") {
    return code("swift", "Package.swift", library("ios").install);
  }
  if (platform === "web") {
    const javascript = registryLibrary("javascript");
    const distribution = javascript.distribution;
    const tokenEnvironmentVariable =
      distribution.authentication.tokenEnvironmentVariable;
    const scope = javascript.packageName.split("/")[0];
    const registryHost = new URL(distribution.registry).host;
    return [
      ...code(
        "ini",
        ".npmrc",
        `${scope}:registry=${distribution.registry}\n//${registryHost}/:_authToken=\${${tokenEnvironmentVariable}}`
      ),
      ...code(
        "bash",
        "Terminal",
        `test -n "\${${tokenEnvironmentVariable}:-}" \\\n  && ${javascript.install}`
      ),
    ];
  }

  const android = registryLibrary("android");
  const distribution = android.distribution;
  const authentication = distribution.authentication;
  if (!authentication.usernameEnvironmentVariable) {
    throw new Error("Android distribution requires a GitHub username variable");
  }
  const usernameEnvironmentVariable =
    authentication.usernameEnvironmentVariable;
  const tokenEnvironmentVariable = authentication.tokenEnvironmentVariable;
  const settings = [
    `val openGrowPackagesUser = providers.environmentVariable("${usernameEnvironmentVariable}").orNull`,
    `    ?: error("${usernameEnvironmentVariable} is required")`,
    `val openGrowPackagesToken = providers.environmentVariable("${tokenEnvironmentVariable}").orNull`,
    `    ?: error("${tokenEnvironmentVariable} is required")`,
    "",
    "dependencyResolutionManagement {",
    "    repositories {",
    "        maven {",
    '            name = "SuperBoardGitHubPackages"',
    `            url = uri("${distribution.registry}")`,
    "            credentials {",
    "                username = openGrowPackagesUser",
    "                password = openGrowPackagesToken",
    "            }",
    "        }",
    "    }",
    "}",
  ].join("\n");
  return [
    ...code("kotlin", "settings.gradle.kts", settings),
    ...code("kotlin", "build.gradle.kts", android.install),
    ...code(
      "bash",
      "Terminal",
      [
        `test -n "\${${usernameEnvironmentVariable}:-}"`,
        `test -n "\${${tokenEnvironmentVariable}:-}"`,
        "./gradlew assemble",
      ].join(" \\\n  && ")
    ),
  ];
}

function stepCode(
  platform: SdkPlatform,
  step: number,
  accessKey: string,
  form: SetupForm
): CodeBlockData[] | null {
  if (platform === "ios") {
    if (step === 1)
      return code(
        "xml",
        "Info.plist",
        `<key>CFBundleURLTypes</key>\n<array>\n  <dict><key>CFBundleURLSchemes</key><array><string>opengrow</string></array></dict>\n</array>`
      );
    if (step === 2) return sdkInstallCode("ios");
    if (step === 3)
      return code(
        "swift",
        "AppDelegate.swift",
        `SuperBoard.shared.registerForPushNotifications()`
      );
    if (step === 4)
      return code(
        "swift",
        "AppDelegate.swift",
        `SuperBoardPurchases.shared.configure(storeKit: .automatic)`
      );
    if (step === 5)
      return code(
        "swift",
        "App.swift",
        `SuperBoard.configure(\n  accessKey: "${accessKey}",\n  appId: "${form.bundle_id || "com.example.app"}"\n)`
      );
  }
  if (platform === "android") {
    if (step === 1)
      return code(
        "xml",
        "AndroidManifest.xml",
        `<intent-filter android:autoVerify="true">\n  <action android:name="android.intent.action.VIEW" />\n  <category android:name="android.intent.category.BROWSABLE" />\n  <data android:scheme="https" android:host="${new URL(config.shortlinkUrl).hostname}" />\n</intent-filter>`
      );
    if (step === 2) return sdkInstallCode("android");
    if (step === 3)
      return code(
        "kotlin",
        "SuperBoardMessagingService.kt",
        `SuperBoard.setPushToken(token)`
      );
    if (step === 4)
      return code(
        "kotlin",
        "Application.kt",
        `SuperBoardPurchases.configure(this)`
      );
    if (step === 5)
      return code(
        "kotlin",
        "Application.kt",
        `SuperBoard.initialize(\n  context = this,\n  accessKey = "${accessKey}",\n  appId = "${form.package_name || "com.example.app"}"\n)`
      );
  }
  if (platform === "web") {
    const javascriptLibrary = library("javascript");
    if (step === 1) return sdkInstallCode("web");
    if (step === 2)
      return code(
        "typescript",
        "superboard.ts",
        `import SuperBoard from "${javascriptLibrary.packageName}";\n\nconst openGrow = new SuperBoard(\n  "${accessKey}",\n  false,\n  (data) => console.info("SuperBoard link", data),\n  "${config.sdkUrl}",\n);\nopenGrow.start();`
      );
  }
  return null;
}

export default function SdkSetupWizard({
  platform,
}: {
  platform: SdkPlatform;
}) {
  const { selectedProject } = useProjectSelection();
  const platformSteps = steps[platform];
  const [record, setRecord] = useState<SdkConfiguration | null>(null);
  const [form, setForm] = useState<SetupForm>(emptyForm);
  const [initial, setInitial] = useState<SetupForm>(emptyForm);
  const [currentStep, setCurrentStep] = useState(0);
  const [completed, setCompleted] = useState<boolean[]>(
    platformSteps.map(() => false)
  );
  const [accessKey, setAccessKey] = useState("YOUR_ACCESS_KEY");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      const [configuration, key] = await Promise.all([
        getSdkConfiguration(selectedProject.id, platform),
        getAccessKey(selectedProject.id),
      ]);
      setRecord(configuration);
      const nextForm = configurationForm(configuration?.configuration ?? {});
      setForm(nextForm);
      setInitial(nextForm);
      const savedSteps = Array.isArray(
        configuration?.configuration.completed_steps
      )
        ? configuration.configuration.completed_steps
        : [];
      setCompleted(platformSteps.map((_, index) => savedSteps.includes(index)));
      setAccessKey(key?.prefix ? `${key.prefix}••••••••` : "YOUR_ACCESS_KEY");
      setError(null);
    } catch (cause) {
      setError(moduleErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [platform, platformSteps, selectedProject]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasChanges = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initial),
    [form, initial]
  );
  const visitedSteps = useMemo(
    () => new Set(platformSteps.map((_, index) => index)),
    [platformSteps]
  );

  const save = async (nextStep?: number) => {
    if (!selectedProject) return;
    setSaving(true);
    try {
      const nextCompleted = completed.map((value, index) =>
        index === currentStep ? true : value
      );
      const configuration = {
        ...form,
        completed_steps: nextCompleted
          .map((value, index) => (value ? index : -1))
          .filter((index) => index >= 0),
      };
      const saved = await saveSdkConfiguration(
        selectedProject.id,
        platform,
        configuration
      );
      setRecord(saved);
      setInitial(form);
      setCompleted(nextCompleted);
      showSuccessNotification(`${platformLabels[platform]} setup saved`);
      if (nextStep !== undefined) setCurrentStep(nextStep);
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const finish = async () => {
    await save();
    if (!selectedProject) return;
    try {
      await testSdkConfiguration(selectedProject.id, platform);
      showSuccessNotification("SDK configuration verified");
      await load();
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    }
  };

  const remove = async () => {
    if (!selectedProject) return;
    setSaving(true);
    try {
      await deleteSdkConfiguration(selectedProject.id, platform);
      setRecord(null);
      setForm(emptyForm);
      setInitial(emptyForm);
      setCompleted(platformSteps.map(() => false));
      setCurrentStep(0);
      showSuccessNotification("SDK configuration removed");
    } catch (cause) {
      showErrorNotification(moduleErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const next = Math.min(currentStep + 1, platformSteps.length - 1);
  const isInteractive =
    currentStep === 0 || currentStep === 3 || currentStep === 4;
  const currentDefinition = platformSteps[currentStep] ?? platformSteps[0]!;

  return (
    <ModulePage
      title={`${platformLabels[platform]} Setup`}
      description={`Complete the ${platformSteps.length}-step ${platformLabels[platform]} SDK integration and verify it against this project.`}
      error={error}
    >
      {!selectedProject ? (
        <EmptyProject />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="capitalize">
                {loading ? "loading" : record?.status || "not configured"}
              </Badge>
              {record?.status === "verified" ? (
                <span className="flex items-center gap-1 text-sm text-emerald-600">
                  <CheckCircle2 className="size-4" /> Verified
                </span>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={loading}
                onClick={() => void load()}
              >
                <RotateCcw className="size-4" /> Reload
              </Button>
              <Button
                variant="destructive"
                disabled={!record || saving}
                onClick={() => void remove()}
              >
                <Trash2 className="size-4" /> Remove setup
              </Button>
            </div>
          </div>

          <Card className="overflow-hidden">
            <CardContent className="flex min-h-[620px] overflow-x-auto p-0">
              <WizardSidebar
                platformLabel={`${platformLabels[platform]} SDK`}
                steps={platformSteps}
                currentStep={currentStep}
                visitedSteps={visitedSteps}
                stepCompleted={completed}
                sdkConfigured={Boolean(record)}
                onStepClick={setCurrentStep}
                onOverview={() => setCurrentStep(0)}
              />
              <div className="flex min-w-[560px] flex-1 flex-col">
                <div className="flex-1 overflow-auto p-6">
                  <SetupStep
                    platform={platform}
                    step={currentStep}
                    definition={currentDefinition}
                    form={form}
                    setForm={setForm}
                    accessKey={accessKey}
                  />
                </div>
                <StepNavigation
                  currentStep={currentStep}
                  totalSteps={platformSteps.length}
                  isOptional={currentDefinition.optional}
                  hasChanges={hasChanges || !completed[currentStep]}
                  isInteractive={isInteractive}
                  isSaving={saving}
                  onBack={() => setCurrentStep(Math.max(0, currentStep - 1))}
                  onContinue={() => {
                    setCompleted((values) =>
                      values.map((value, index) =>
                        index === currentStep ? true : value
                      )
                    );
                    setCurrentStep(next);
                  }}
                  onSaveAndContinue={() => void save(next)}
                  onSkip={() => setCurrentStep(next)}
                  onFinish={() => void finish()}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </ModulePage>
  );
}

function SetupStep({
  platform,
  step,
  definition,
  form,
  setForm,
  accessKey,
}: {
  platform: SdkPlatform;
  step: number;
  definition: StepDef;
  form: SetupForm;
  setForm: React.Dispatch<React.SetStateAction<SetupForm>>;
  accessKey: string;
}) {
  const codeBlock = stepCode(platform, step, accessKey, form);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <SectionHeader
        icon={definition.icon}
        title={definition.name}
        subtitle={stepDescription(platform, step)}
        badge={
          definition.optional ? (
            <Badge variant="secondary">Optional</Badge>
          ) : undefined
        }
      />
      {step === 0 ? (
        <>
          <RegistrationFields
            platform={platform}
            form={form}
            setForm={setForm}
          />
          <RuntimePolicyFields form={form} setForm={setForm} />
        </>
      ) : null}
      {(platform === "ios" || platform === "android") && step === 3 ? (
        <div className="space-y-2">
          <Label>Push secret reference</Label>
          <Input
            placeholder="secret://push/provider-key"
            value={form.push_credential_reference}
            onChange={(event) =>
              setForm((value) => ({
                ...value,
                push_credential_reference: event.currentTarget.value,
              }))
            }
          />
          <p className="text-xs text-muted-foreground">
            Save only a Secret Store or operator-managed reference. The API
            rejects credential values and private key material.
          </p>
        </div>
      ) : null}
      {(platform === "ios" || platform === "android") && step === 4 ? (
        <div className="space-y-2">
          <Label>Store secret reference</Label>
          <Input
            placeholder="secret://store/provider-key"
            value={form.store_credential_reference}
            onChange={(event) =>
              setForm((value) => ({
                ...value,
                store_credential_reference: event.currentTarget.value,
              }))
            }
          />
          <p className="text-xs text-muted-foreground">
            Save only a reference. App Store Connect and Google Play credentials
            remain Worker secrets.
          </p>
        </div>
      ) : null}
      {codeBlock ? <RenderCodeBlock data={codeBlock} /> : null}
      {step > 0 ? (
        <Alert>
          <KeyRound className="size-4" />
          <AlertTitle>Project-scoped configuration</AlertTitle>
          <AlertDescription>
            These instructions use the selected project and environment.
            Switching projects resets the setup context.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function RegistrationFields({
  platform,
  form,
  setForm,
}: {
  platform: SdkPlatform;
  form: SetupForm;
  setForm: React.Dispatch<React.SetStateAction<SetupForm>>;
}) {
  if (platform === "ios")
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Bundle ID"
          placeholder="com.example.app"
          value={form.bundle_id}
          onChange={(bundle_id) =>
            setForm((value) => ({ ...value, bundle_id }))
          }
        />
        <Field
          label="Apple Team ID"
          placeholder="ABCDE12345"
          value={form.team_id}
          onChange={(team_id) => setForm((value) => ({ ...value, team_id }))}
        />
      </div>
    );
  if (platform === "android")
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Package name"
          placeholder="com.example.app"
          value={form.package_name}
          onChange={(package_name) =>
            setForm((value) => ({ ...value, package_name }))
          }
        />
        <Field
          label="SHA-256 certificate"
          placeholder="AA:BB:CC:…"
          value={form.sha256}
          onChange={(sha256) => setForm((value) => ({ ...value, sha256 }))}
        />
      </div>
    );
  return (
    <Field
      label="Application domain"
      placeholder="app.example.com"
      value={form.domain}
      onChange={(domain) => setForm((value) => ({ ...value, domain }))}
    />
  );
}

function RuntimePolicyFields({
  form,
  setForm,
}: {
  form: SetupForm;
  setForm: React.Dispatch<React.SetStateAction<SetupForm>>;
}) {
  return (
    <div className="space-y-4 rounded-md border p-4">
      <div>
        <h3 className="font-medium">Runtime policy</h3>
        <p className="text-xs text-muted-foreground">
          Common maintenance and application-update policy returned to the SDK.
          Leave versions empty to disable update enforcement.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Minimum version"
          placeholder="2.0.0"
          value={form.minimum_version}
          onChange={(minimum_version) =>
            setForm((value) => ({ ...value, minimum_version }))
          }
        />
        <Field
          label="Recommended version"
          placeholder="2.1.0"
          value={form.recommended_version}
          onChange={(recommended_version) =>
            setForm((value) => ({ ...value, recommended_version }))
          }
        />
      </div>
      <Field
        label="Store URL"
        placeholder="https://apps.apple.com/app/id…"
        value={form.store_url}
        onChange={(store_url) => setForm((value) => ({ ...value, store_url }))}
      />
      <div className="flex items-center justify-between gap-4 rounded-md border p-3">
        <div>
          <Label>Maintenance mode</Label>
          <p className="text-xs text-muted-foreground">
            Takes priority over update prompts for this platform.
          </p>
        </div>
        <Switch
          checked={form.maintenance_enabled}
          onCheckedChange={(maintenance_enabled) =>
            setForm((value) => ({ ...value, maintenance_enabled }))
          }
        />
      </div>
      <Field
        label="Maintenance message"
        placeholder="The service is temporarily unavailable."
        value={form.maintenance_message}
        onChange={(maintenance_message) =>
          setForm((value) => ({ ...value, maintenance_message }))
        }
      />
    </div>
  );
}

function Field({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </div>
  );
}

function stepDescription(platform: SdkPlatform, step: number) {
  const descriptions: Record<SdkPlatform, string[]> = {
    ios: [
      "Register the bundle and Apple development team used by your application.",
      "Declare the URL scheme used to return customers to the correct screen.",
      "Install the native SuperBoard package with Swift Package Manager.",
      "Connect APNs so messaging and link attribution can continue after install.",
      "Connect server-side App Store purchase events without exposing credentials in the app.",
      "Initialize SuperBoard once during application startup.",
    ],
    android: [
      "Register the Android package and signing certificate.",
      "Declare verified intent filters for web and application deep links.",
      "Add the SuperBoard Android package to your Gradle build.",
      "Connect Firebase Cloud Messaging for attribution and support notifications.",
      "Connect server-side Google Play purchase events without shipping credentials.",
      "Initialize SuperBoard once from the Application class.",
    ],
    web: [
      "Register the public domain allowed to initialize the Web SDK.",
      "Install the SuperBoard Web package with your package manager.",
      "Initialize the SDK once and forward client-side navigation events.",
    ],
  };
  return descriptions[platform][step] ?? "Complete this SDK integration step.";
}
