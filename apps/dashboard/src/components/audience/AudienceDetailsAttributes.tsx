import { Input } from "../ui/input";
import { Copy } from "lucide-react";
import { handleCopyText } from "@/lib/copyTextHelper";
import type { Visitor } from "@/types";

interface KeyValuePair {
  key: string;
  value: string;
}

const AudienceDetailsAttributes = ({
  visitorInfo,
  dataTable,
}: {
  visitorInfo: Visitor | null;
  columns?: unknown;
  table?: unknown;
  dataTable: KeyValuePair[];
}) => {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <AttributeField
          label="ID"
          description="SuperBoard generated ID for your project"
          value={visitorInfo?.uuid ?? ""}
        />
        {visitorInfo?.inviter && (
          <AttributeField
            label="Invited By"
            description="This user signed up from a link sent by the user with the identifier"
            value={visitorInfo.inviter}
          />
        )}
        {visitorInfo?.sdk_identifier && (
          <AttributeField
            label="SDK Identifier"
            description="An identifier set by your team using the SDKs, usually a user ID"
            value={visitorInfo.sdk_identifier}
          />
        )}
      </div>

      {dataTable.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">SDK Attributes</label>
            <span className="text-xs text-muted-foreground">
              Custom attributes added by your team using the SDK
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {dataTable.map((item: KeyValuePair) => (
              <div
                key={item.key}
                className="flex items-center rounded-lg border border-sidebar-border bg-secondary/50 overflow-hidden"
              >
                <div className="flex items-center px-3 py-2.5 border-r border-sidebar-border bg-secondary min-w-[140px]">
                  <span className="text-sm font-mono font-medium truncate">
                    {item.key}
                  </span>
                </div>
                <div className="flex-1 px-3 py-2.5 min-w-0">
                  <span className="text-sm font-mono text-muted-foreground truncate block">
                    {item.value?.toString()}
                  </span>
                </div>
                <button
                  onClick={() => handleCopyText(item.value?.toString() ?? "")}
                  className="flex items-center justify-center px-3 py-2.5 border-l border-sidebar-border text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const AttributeField = ({
  label,
  description,
  value,
}: {
  label: string;
  description: string;
  value: string;
}) => (
  <div className="flex flex-col gap-1.5">
    <label className="text-sm font-medium">{label}</label>
    <div className="flex items-center gap-0 rounded-md border border-input bg-secondary overflow-hidden">
      <Input
        readOnly
        value={value ?? ""}
        className="border-0 shadow-none ring-0 focus-visible:ring-0 focus-visible:border-0 rounded-none"
      />
      {value && (
        <button
          onClick={() => handleCopyText(value)}
          className="flex items-center justify-center px-3 h-9 border-l border-input text-muted-foreground hover:text-foreground transition-colors"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
    <span className="text-xs text-muted-foreground">{description}</span>
  </div>
);

export default AudienceDetailsAttributes;
