import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Database, Plus } from "lucide-react";
import React, { useState } from "react";

type KeyValuePair = { key: string; value: string };

const CreateLinkDataSection = React.memo(function CreateLinkDataSection({
  addKeyValuePair,
  data,
  columns,
  disabledActions,
}: {
  addKeyValuePair: (key: string, value: string) => void;
  data: KeyValuePair[];
  columns: ColumnDef<KeyValuePair>[];
  disabledActions?: boolean;
}) {
  const [key, setKey] = useState<string>("");
  const [value, setValue] = useState<string>("");

  const handleAddKeyValuePair = (key: string, value: string) => {
    addKeyValuePair(key, value);
    setKey("");
    setValue("");
  };

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 overflow-hidden">
        {/* Left — Inputs & List */}
        <div className="flex flex-1 flex-col gap-2 overflow-auto">
          <div className="flex flex-col gap-5 px-6 py-6">
            {/* Add new pair */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Custom Data</label>
              <span className="text-xs text-muted-foreground">
                Attach key-value pairs that will be delivered to your app
                alongside the link. Useful for deep linking, referral tracking,
                or passing custom context.
              </span>
              <div
                className={cn(
                  "flex items-center w-full rounded-lg border overflow-hidden transition-all bg-transparent dark:bg-input/30",
                  "border-sidebar-border focus-within:border-primary/40 focus-within:ring-[3px] focus-within:ring-primary/10"
                )}
              >
                <div className="flex-1 relative">
                  <Input
                    className="border-none bg-transparent dark:bg-transparent rounded-none shadow-none font-mono text-sm tracking-tight focus-visible:ring-0 h-10"
                    placeholder="key"
                    value={key}
                    readOnly={disabledActions}
                    onChange={(e) => setKey(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        key !== "" &&
                        value !== "" &&
                        !disabledActions
                      ) {
                        e.preventDefault();
                        handleAddKeyValuePair(key, value);
                      }
                    }}
                  />
                </div>
                <div className="flex items-center px-2 shrink-0 text-muted-foreground/50 select-none">
                  <span className="text-sm font-mono">=</span>
                </div>
                <div className="flex-1 relative border-l border-sidebar-border">
                  <Input
                    className="border-none bg-transparent dark:bg-transparent rounded-none shadow-none font-mono text-sm tracking-tight focus-visible:ring-0 h-10"
                    placeholder="value"
                    value={value}
                    readOnly={disabledActions}
                    onChange={(e) => setValue(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        key !== "" &&
                        value !== "" &&
                        !disabledActions
                      ) {
                        e.preventDefault();
                        handleAddKeyValuePair(key, value);
                      }
                    }}
                  />
                </div>
                <div className="flex items-center pr-1.5 shrink-0">
                  <Button
                    disabled={value === "" || key === ""}
                    variant="secondary"
                    size="sm"
                    className="h-7 px-2.5 text-xs font-medium"
                    onClick={() => {
                      if (!disabledActions) handleAddKeyValuePair(key, value);
                    }}
                  >
                    <Plus className="h-3 w-3" />
                    Add
                  </Button>
                </div>
              </div>
            </div>

            <Separator />

            {/* Data list */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">
                Parameters passed to your app
                {data.length > 0 && (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    ({data.length})
                  </span>
                )}
              </label>

              {data.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {table.getRowModel().rows.map((row) => (
                    <div
                      key={row.id}
                      className="flex items-center rounded-lg border border-sidebar-border bg-secondary/50 overflow-hidden group transition-colors hover:bg-secondary"
                    >
                      <div className="flex items-center px-3 py-2.5 border-r border-sidebar-border bg-secondary min-w-[140px]">
                        <span className="text-sm font-mono font-medium truncate">
                          {row.original.key}
                        </span>
                      </div>
                      <div className="flex-1 px-3 py-2.5 min-w-0">
                        <span className="text-sm font-mono text-muted-foreground truncate block">
                          {row.original.value?.toString()}
                        </span>
                      </div>
                      {row.getVisibleCells().map((cell) =>
                        cell.column.id === "actions" ? (
                          <div key={cell.id} className="shrink-0 pr-1.5">
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext()
                            )}
                          </div>
                        ) : null
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-sidebar-border bg-secondary/30 py-10">
                  <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-background border border-sidebar-border">
                    <Database className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <span className="text-sm text-muted-foreground">
                    No parameters added yet
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

export default CreateLinkDataSection;
