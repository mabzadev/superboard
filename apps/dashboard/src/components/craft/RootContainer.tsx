import { useNode } from "@craftjs/core";
import clsx from "clsx";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

import type { RootContainerCraftProps } from "@/types";

export const RootContainer = ({ children }: RootContainerCraftProps) => {
  const {
    connectors: { connect },
    selected,
    props: {
      maxWidth,
      background,
      paddingTop,
      paddingBottom,
      paddingRight,
      paddingLeft,
      display,
      justifyContent,
      alignItems,
      flexDirectionClass,
      gap,
      margin,
      gridTemplateColumns,
    },
  } = useNode((node) => ({
    selected: node.events.selected,
    props: node.data.props,
  }));

  const flexDirection = flexDirectionClass === "flex-row" ? "row" : "column";

  const layoutStyles =
    display === "flex"
      ? {
          display: "flex" as const,
          flexDirection: flexDirection as React.CSSProperties["flexDirection"],
          justifyContent,
          alignItems,
          gap,
        }
      : display === "grid"
        ? {
            display: "grid" as const,
            gap,
            gridTemplateColumns,
          }
        : {
            display: "block" as const,
          };

  return (
    <div
      ref={(ref) => {
        if (ref) connect(ref);
      }}
      style={{
        background,
        display: "flex",
        width: "100%",
        minHeight: "100%",
        position: "relative",
      }}
      className={clsx(selected && "outline outline-2 outline-blue-500")}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          boxSizing: "border-box",
          maxWidth: maxWidth,
          margin: margin,
          paddingTop,
          paddingBottom,
          paddingRight,
          paddingLeft,
          ...layoutStyles,
        }}
      >
        {children}
      </div>
    </div>
  );
};

export const RootContainerSettings = () => {
  const {
    actions: { setProp },
    props,
  } = useNode((node) => ({
    props: node.data.props,
  }));

  return (
    <div className="flex flex-col gap-3 px-3 py-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">Background</Label>
        <div className="flex items-center gap-1.5">
          <Input
            value={props.background}
            onChange={(e) =>
              setProp(
                (p: Record<string, string>) => (p.background = e.target.value)
              )
            }
            className="h-7 w-20 font-mono text-xs px-2"
          />
          <div className="w-7 h-7 rounded-md border border-input overflow-hidden relative cursor-pointer shrink-0">
            <input
              value={props.background}
              onChange={(e) =>
                setProp(
                  (p: Record<string, string>) => (p.background = e.target.value)
                )
              }
              type="color"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <div
              className="w-full h-full"
              style={{ backgroundColor: props.background }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

RootContainer.craft = {
  displayName: "RootContainer",
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
    justifyContent: "flex-start",
    alignItems: "start",
    gap: "10px",
    gridTemplateColumns: "",
  },

  rules: {
    canDrag: () => false, // prevent dragging the root
    canMoveIn: () => true,
  },
  related: {
    settings: RootContainerSettings,
  },
};
