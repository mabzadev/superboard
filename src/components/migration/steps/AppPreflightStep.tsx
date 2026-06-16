"use client";

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface AppPreflightStepProps {
  oldHost: string;
  ios: boolean;
  android: boolean;
  onContinue: () => void;
}

// Build the visible checklist based on which platforms apply. Keys stay stable
// so the disabled-until-all-checked gate is just `keys.every(k => checked[k])`.
type ChecklistKey = "ios" | "android" | "rollout";

interface ChecklistItem {
  key: ChecklistKey;
  id: string;
  // React node so we can highlight `applinks:{oldHost}` as code.
  label: React.ReactNode;
}

const AppPreflightStep = ({
  oldHost,
  ios,
  android,
  onContinue,
}: AppPreflightStepProps) => {
  const items = useMemo<ChecklistItem[]>(() => {
    const list: ChecklistItem[] = [];
    if (ios) {
      list.push({
        key: "ios",
        id: "app-preflight-ios",
        label: (
          <>
            I&apos;ve added{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">
              applinks:{oldHost}
            </code>{" "}
            to my iOS Associated Domains entitlement and shipped a new build to
            the App Store.
          </>
        ),
      });
    }
    if (android) {
      list.push({
        key: "android",
        id: "app-preflight-android",
        label: (
          <>
            I&apos;ve updated my{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">
              assetlinks.json
            </code>{" "}
            setup with the SHA-256 cert fingerprint and shipped a new Android
            build.
          </>
        ),
      });
    }
    // "Common" item per spec is always present.
    list.push({
      key: "rollout",
      id: "app-preflight-rollout",
      label: <>My users have had time to update to the new build.</>,
    });
    return list;
  }, [ios, android, oldHost]);

  const [checked, setChecked] = useState<Record<ChecklistKey, boolean>>({
    ios: false,
    android: false,
    rollout: false,
  });

  const allChecked = items.every((item) => checked[item.key]);

  const handleToggle = (key: ChecklistKey, value: boolean) => {
    setChecked((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="flex flex-col gap-5">
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>Ship the new build before you flip DNS</AlertTitle>
        <AlertDescription>
          <p className="leading-relaxed">
            Flipping DNS before the new build is live regresses universal links
            — confirm each item below before you continue.
          </p>
        </AlertDescription>
      </Alert>

      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li
            key={item.key}
            className="flex items-start gap-3 rounded-lg border border-sidebar-border px-4 py-3"
          >
            <Checkbox
              id={item.id}
              className="mt-0.5"
              checked={checked[item.key]}
              onCheckedChange={(value) =>
                handleToggle(item.key, value === true)
              }
            />
            <Label
              htmlFor={item.id}
              className="text-sm leading-relaxed font-normal cursor-pointer items-start"
            >
              {item.label}
            </Label>
          </li>
        ))}
      </ul>

      <div className="flex justify-end">
        <Button
          type="button"
          disabled={!allChecked}
          onClick={() => {
            if (allChecked) onContinue();
          }}
        >
          Continue
        </Button>
      </div>
    </div>
  );
};

export default AppPreflightStep;
