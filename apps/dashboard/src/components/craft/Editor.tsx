import { Frame } from "@craftjs/core";

import { Toolbox } from "@/components/craft/Toolbox";
import { SettingsPanel } from "@/components/craft/SettingsPanel";
import { Separator } from "../ui/separator";

export const initialEditorState = {
  ROOT: {
    type: {
      resolvedName: "RootContainer",
    },
    isCanvas: true,
    props: {
      background: "#f5f5f5",
      paddingTop: "10px",
      paddingBottom: "10px",
      paddingRight: "10px",
      paddingLeft: "10px",
      width: "100%",
      height: "100%",
      maxWidth: "1600px",
      margin: "0 auto",
      display: "flex",
      flexDirectionClass: "flex-col",
      justifyContent: "center",
      alignItems: "start",
      gap: "5px",
      gridTemplateColumns: "",
    },
    displayName: "RootContainer",
    custom: {},
    hidden: false,
    nodes: [],
    linkedNodes: {},
  },
};

export default function EditorPage({
  readOnlyMode,
}: {
  htmlMessage: string | null;
  setHtmlMessage: (html: string) => void;
  readOnlyMode?: boolean;
}) {
  return (
    <div className="flex h-full overflow-hidden">
      {/* Canvas */}
      <div className="flex flex-1 flex-col w-full min-w-0 overflow-hidden bg-muted/30">
        <div className="flex-1 overflow-auto p-4" data-craft-canvas>
          <Frame data={JSON.stringify(initialEditorState)}></Frame>
        </div>
      </div>

      {/* Right panel: Components + Customize */}
      {!readOnlyMode && (
        <div className="flex flex-col w-[260px] shrink-0 bg-sidebar text-sidebar-foreground border-l border-sidebar-border overflow-y-auto">
          <Toolbox />
          <Separator />
          <SettingsPanel />
        </div>
      )}
    </div>
  );
}
