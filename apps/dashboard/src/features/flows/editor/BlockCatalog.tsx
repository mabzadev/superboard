"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import type {
  FlowBlockType,
  FlowComponentDefinition,
} from "@/api/flows/flowsService";
import { Input } from "@/components/ui/input";
import { useFlowI18n } from "../i18n";
import { BLOCK_CATALOG, componentBlockType } from "./graph";

export const FLOW_BLOCK_DRAG_TYPE = "application/superboard-flow-block";
export const FLOW_COMPONENT_DRAG_TYPE = "application/superboard-flow-component";

export function BlockCatalog({
  onAdd,
  components = [],
  onAddComponent,
}: {
  onAdd: (type: FlowBlockType) => void;
  components?: FlowComponentDefinition[];
  onAddComponent?: (component: FlowComponentDefinition) => void;
}) {
  const { tr } = useFlowI18n();
  const [search, setSearch] = useState("");
  const componentTypes = useMemo(
    () => new Set(components.map(componentBlockType)),
    [components]
  );
  const groups = useMemo(() => {
    const query = search.trim().toLowerCase();
    return ["Logic", "Experience", "Utility"].map((category) => ({
      category,
      items: BLOCK_CATALOG.filter(
        (item) =>
          item.category === category &&
          !(
            onAddComponent &&
            componentTypes.has(
              item.type as "component" | "tour-component" | "survey"
            )
          ) &&
          (!query ||
            `${item.label} ${item.description}`.toLowerCase().includes(query))
      ),
    }));
  }, [componentTypes, onAddComponent, search]);
  const filteredComponents = useMemo(() => {
    const query = search.trim().toLowerCase();
    return components.filter(
      (component) =>
        !query ||
        `${component.name} ${component.key} ${component.component_type} ${String(component.schema.description ?? "")}`
          .toLowerCase()
          .includes(query)
    );
  }, [components, search]);

  return (
    <div className="grid max-h-[70vh] w-80 gap-3 overflow-y-auto p-2">
      <div className="relative">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={tr("Search blocks")}
          className="pl-9"
        />
      </div>
      {groups.map((group) =>
        group.items.length > 0 ? (
          <section key={group.category} className="grid gap-1">
            <h3 className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {tr(group.category)}
            </h3>
            {group.items.map((item) => (
              <button
                key={item.type}
                type="button"
                draggable
                className="rounded-[var(--radius-sm)] px-2 py-2 text-left hover:bg-accent focus-visible:bg-accent"
                onDragStart={(event) =>
                  event.dataTransfer.setData(FLOW_BLOCK_DRAG_TYPE, item.type)
                }
                onClick={() => onAdd(item.type)}
              >
                <span className="block text-sm font-medium">
                  {tr(item.label)}
                </span>
                <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                  {tr(item.description)}
                </span>
              </button>
            ))}
          </section>
        ) : null
      )}
      {filteredComponents.length > 0 && onAddComponent ? (
        <section className="grid gap-1">
          <h3 className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {tr("Components")}
          </h3>
          {filteredComponents.map((component) => (
            <button
              key={component.id}
              type="button"
              draggable
              className="rounded-[var(--radius-sm)] px-2 py-2 text-left hover:bg-accent focus-visible:bg-accent"
              onDragStart={(event) =>
                event.dataTransfer.setData(
                  FLOW_COMPONENT_DRAG_TYPE,
                  component.id
                )
              }
              onClick={() => onAddComponent(component)}
            >
              <span className="block text-sm font-medium">
                {component.name}
              </span>
              <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                {component.library_name ?? tr("Component library")} ·{" "}
                {tr(
                  componentBlockType(component) === "tour-component"
                    ? "Tour component"
                    : componentBlockType(component) === "survey"
                      ? "Survey"
                      : "Component"
                )}
              </span>
            </button>
          ))}
        </section>
      ) : null}
    </div>
  );
}
