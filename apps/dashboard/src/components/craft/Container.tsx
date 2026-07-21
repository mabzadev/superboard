import { useEditor, useNode } from "@craftjs/core";
import clsx from "clsx";
import { ComponentToolbar } from "./ComponentToolbar";
import { useRef, useState } from "react";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import type { ContainerCraftProps } from "@/types";

export const ContainerComponent = ({ children }: ContainerCraftProps) => {
  const {
    connectors: { connect, drag },
    selected,
    id,
    props: {
      background,
      paddingTop,
      paddingBottom,
      paddingRight,
      paddingLeft,
      borderRadius,
      display,
      justifyContent,
      alignItems,
      gap,
      width,
      height,
      gridTemplateColumns,
      flexDirectionClass,
      marginTop,
      marginBottom,
      marginRight,
      marginLeft,
    },
  } = useNode((node) => ({
    selected: node.events.selected,
    props: node.data.props,
  }));

  const { enabled } = useEditor((state) => ({
    enabled: state.options.enabled,
  }));

  const [isHovered, setIsHovered] = useState(false);
  const hoverTimeout = useRef<NodeJS.Timeout | null>(null);
  const handleMouseEnter = () => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    hoverTimeout.current = setTimeout(() => {
      setIsHovered(false);
    }, 100);
    setIsHovered(false);
  };

  const flexDirection = flexDirectionClass === "flex-row" ? "row" : "column";

  const layoutStyles =
    display === "flex"
      ? {
          display: "flex" as const,
          flexDirection: flexDirection as React.CSSProperties["flexDirection"],
          justifyContent,
          alignItems,
          paddingTop,
          paddingBottom,
          paddingRight,
          paddingLeft,
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

  const hasNoChildren =
    !children || (Array.isArray(children) && children.length === 0);

  return (
    <div
      ref={(ref) => {
        if (ref) connect(ref);
      }}
      onMouseOver={handleMouseEnter}
      onMouseOut={handleMouseLeave}
      className={clsx(
        "relative",
        "transition-all duration-150",
        selected && "outline-2 outline-blue-500",
        enabled &&
          !selected &&
          "hover:outline hover:outline-1 hover:outline-dashed hover:outline-blue-500",
        hasNoChildren && "border border-dashed border-gray-300"
      )}
      style={{
        boxSizing: "border-box",
        background,
        width,
        height,
        borderRadius,
        marginTop,
        marginBottom,
        marginRight,
        marginLeft,
        ...layoutStyles,
      }}
    >
      {enabled && (selected || isHovered) && (
        <ComponentToolbar label="Container" nodeId={id} dragConnector={drag} />
      )}

      {children}
    </div>
  );
};

export const ContainerSettings = () => {
  const {
    actions: { setProp },
    props,
  } = useNode((node) => ({
    props: node.data.props,
  }));

  return (
    <div className="flex flex-col gap-3 px-3 py-2">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Width</Label>
          <Input
            className="h-8"
            value={props.width}
            placeholder="100%"
            onChange={(e) =>
              setProp((p: Record<string, string>) => (p.width = e.target.value))
            }
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Height</Label>
          <Input
            className="h-8"
            value={props.height}
            placeholder="auto"
            onChange={(e) =>
              setProp(
                (p: Record<string, string>) => (p.height = e.target.value)
              )
            }
          />
        </div>
      </div>

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

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Border Radius</Label>
        <Input
          className="h-8"
          value={props.borderRadius}
          placeholder="0px"
          onChange={(e) =>
            setProp(
              (p: Record<string, string>) => (p.borderRadius = e.target.value)
            )
          }
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Direction</Label>
        <RadioGroup className="flex gap-4">
          {[
            { value: "flex-col", label: "Vertical", id: "c-dir-col" },
            { value: "flex-row", label: "Horizontal", id: "c-dir-row" },
          ].map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-1.5"
              onClick={() =>
                setProp(
                  (p: Record<string, string>) =>
                    (p.flexDirectionClass = item.value)
                )
              }
            >
              <RadioGroupItem
                value={item.value}
                id={item.id}
                checked={props.flexDirectionClass === item.value}
              />
              <Label htmlFor={item.id} className="text-xs">
                {item.label}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Spacing</Label>
        <Input
          className="h-8"
          placeholder="10px"
          value={props.gap}
          onChange={(e) =>
            setProp((p: Record<string, string>) => (p.gap = e.target.value))
          }
        />
      </div>
    </div>
  );
};

ContainerComponent.craft = {
  displayName: "Container",

  props: {
    background: "#a3a3a3",
    paddingTop: "20px",
    paddingBottom: "20px",
    paddingRight: "20px",
    paddingLeft: "20px",
    marginTop: "",
    marginBottom: "",
    marginRight: "",
    marginLeft: "",
    borderRadius: "0px",
    width: "100%",
    height: "300px",
    display: "flex",
    flexDirectionClass: "flex-col",
    justifyContent: "center",
    alignItems: "center",
    gap: "10px",
    gridTemplateColumns: "",
  },

  rules: {
    canMoveIn: () => true,
  },
  related: {
    settings: ContainerSettings,
  },
};
