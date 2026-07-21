import { useEditor } from "@craftjs/core";
import { PencilRuler } from "lucide-react";

export const SettingsPanel = () => {
  const { nodes } = useEditor((state) => {
    const selectedNodeId = Array.from(state.events.selected)[0];
    return {
      selected: selectedNodeId,
      nodes: selectedNodeId ? state.nodes[selectedNodeId] : null,
    };
  });

  const Settings = nodes?.related?.settings;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <PencilRuler className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Customize
        </span>
      </div>

      {Settings ? (
        <div className="flex-1 overflow-y-auto">
          <Settings />
        </div>
      ) : (
        <p className="px-4 py-2 text-sm text-muted-foreground">
          Select a component to customize
        </p>
      )}
    </div>
  );
};
