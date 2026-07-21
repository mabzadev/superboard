import { useEditor } from "@craftjs/core";
import { ArrowUp, Move, Trash2 } from "lucide-react";
import { useCallback } from "react";

export const ComponentToolbar = ({
  label,
  nodeId,
  dragConnector,
}: {
  label: string;
  nodeId: string;
  dragConnector: (ref: HTMLElement) => void;
}) => {
  const { actions, query } = useEditor();

  const toolbarRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const scrollParent = node.closest("[data-craft-canvas]");
    if (scrollParent) {
      const scrollRect = scrollParent.getBoundingClientRect();
      const componentRect = node.parentElement?.getBoundingClientRect();
      if (componentRect && componentRect.top - scrollRect.top < 34) {
        node.style.top = "auto";
        node.style.bottom = "-29px";
      } else {
        node.style.top = "-29px";
        node.style.bottom = "auto";
      }
    }
  }, []);

  return (
    <div
      ref={toolbarRef}
      className="flex bg-blue-400 text-secondary items-center absolute -left-[1px] gap-2 p-1 z-[999] shadow-md"
    >
      <div className="text-sm">
        <label>{label}</label>
      </div>
      <button
        onClick={() => {
          const parentId = query.node(nodeId).ancestors(false)[0];
          if (parentId) actions.selectNode(parentId);
        }}
        className="flex rounded cursor-pointer"
        aria-label="Move component up"
      >
        <ArrowUp className="h-[18px] w-[18px]" />
      </button>
      <div
        ref={(ref) => {
          if (ref) dragConnector(ref);
        }}
        className="flex rounded cursor-grab"
        role="button"
        aria-label="Drag to reorder"
      >
        <Move className="h-[18px] w-[18px]" />
      </div>
      <button
        className="cursor-pointer"
        onClick={() => actions.delete(nodeId)}
        aria-label="Delete component"
      >
        <Trash2 className="h-[18px] w-[18px]" />
      </button>
    </div>
  );
};
