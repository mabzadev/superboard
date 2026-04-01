import { useEditor, useNode } from "@craftjs/core";
import clsx from "clsx";
import { ComponentToolbar } from "./ComponentToolbar";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import type { ButtonCraftProps } from "@/types";

export const ButtonComponent = ({
  text = "Click me",
  background,
  borderRadius,
  paddingTop,
  paddingBottom,
  paddingRight,
  paddingLeft,
  marginTop,
  marginBottom,
  marginRight,
  marginLeft,
  margin: _margin,
  textSize = "text-base",
  textColor,
  textAlign,
  href,
  styleType,
  borderSize,
}: ButtonCraftProps) => {
  const {
    id,
    selected,
    connectors: { connect, drag },
    actions: { setProp },
  } = useNode((node) => ({
    selected: node.events.selected,
  }));
  const { enabled } = useEditor((state) => ({
    enabled: state.options.enabled,
  }));

  const [editing, setEditing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

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

  const handleBlur = () => {
    setEditing(false);
    if (contentRef.current) {
      const newText = contentRef.current.innerText;
      setProp((props: Record<string, string>) => (props.text = newText));
    }
  };

  useEffect(() => {
    setEditing(selected);
  }, [selected]);

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={clsx(
        "relative",
        "transition-all duration-150",
        selected && "outline-2 outline-blue-500",
        enabled &&
          !selected &&
          "hover:outline-blue-500 hover:outline-1 hover:outline-dashed"
      )}
      style={{ width: "100%" }}
      ref={(ref) => {
        if (ref) connect(ref);
      }}
    >
      {enabled && (selected || isHovered) && (
        <ComponentToolbar label="Button" nodeId={id} dragConnector={drag} />
      )}

      {/* Main button wrapper (connect) */}
      <div
        style={{
          boxSizing: "border-box",
          marginTop,
          marginBottom,
          marginRight,
          marginLeft,
        }}
      >
        <a
          href={href}
          style={{ boxSizing: "border-box", display: "block", width: "100%" }}
          target="_blank"
          onClick={(e) => {
            if (selected) {
              e.preventDefault();
            }
          }}
        >
          <button
            style={{
              width: "100%",
              background: styleType === "outlined" ? "transparent" : background,
              color: textColor,
              border:
                styleType === "outlined"
                  ? `${borderSize} solid ${background}`
                  : "none",
              borderRadius,
              boxSizing: "border-box",
              paddingTop,
              paddingBottom,
              paddingRight,
              paddingLeft,

              cursor: "pointer",
            }}
          >
            <p
              ref={contentRef}
              contentEditable={enabled && editing}
              suppressContentEditableWarning
              onBlur={handleBlur}
              style={{
                color: textColor,
                fontSize:
                  textSize === "text-sm"
                    ? "14px"
                    : textSize === "text-lg"
                      ? "18px"
                      : "16px",
                textAlign: (textAlign === "text-center"
                  ? "center"
                  : textAlign === "text-right"
                    ? "right"
                    : "left") as React.CSSProperties["textAlign"],
                margin: 0,
              }}
            >
              {text}
            </p>
          </button>
        </a>
      </div>
    </div>
  );
};

export const ButtonSettings = () => {
  const {
    actions: { setProp },
    props,
  } = useNode((node) => ({
    props: node.data.props,
  }));

  return (
    <div className="flex flex-col gap-3 px-3 py-2">
      {[
        { label: "Background", prop: "background" },
        { label: "Text Color", prop: "textColor" },
      ].map((item) => (
        <div key={item.prop} className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">{item.label}</Label>
          <div className="flex items-center gap-1.5">
            <Input
              value={props[item.prop]}
              onChange={(e) =>
                setProp(
                  (p: Record<string, string>) => (p[item.prop] = e.target.value)
                )
              }
              className="h-7 w-20 font-mono text-xs px-2"
            />
            <div className="w-7 h-7 rounded-md border border-input overflow-hidden relative cursor-pointer shrink-0">
              <input
                value={props[item.prop]}
                onChange={(e) =>
                  setProp(
                    (p: Record<string, string>) =>
                      (p[item.prop] = e.target.value)
                  )
                }
                type="color"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <div
                className="w-full h-full"
                style={{ backgroundColor: props[item.prop] }}
              />
            </div>
          </div>
        </div>
      ))}

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Link URL</Label>
        <Input
          className="h-8"
          value={props.href}
          placeholder="https://"
          onChange={(e) =>
            setProp((p: Record<string, string>) => (p.href = e.target.value))
          }
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Border Radius</Label>
        <Input
          className="h-8"
          value={props.borderRadius}
          placeholder="4px"
          onChange={(e) =>
            setProp(
              (p: Record<string, string>) => (p.borderRadius = e.target.value)
            )
          }
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Style</Label>
        <Select
          value={props.styleType}
          onValueChange={(v) =>
            setProp((p: Record<string, string>) => (p.styleType = v))
          }
        >
          <SelectTrigger className="h-8 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="full">Filled</SelectItem>
            <SelectItem value="outlined">Outlined</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};

ButtonComponent.craft = {
  displayName: "Button",
  props: {
    href: "",
    text: "Click me",
    background: `#171717`,
    textColor: `#fafafa`,
    textAlign: "text-center",
    borderRadius: "4px",
    borderSize: "1.5px",

    paddingTop: "8px",
    paddingBottom: "8px",
    paddingRight: "16px",
    paddingLeft: "16px",
    marginTop: "",
    marginBottom: "",
    marginRight: "",
    marginLeft: "",
    margin: "5px",
    styleType: "full",
  },
  related: {
    settings: ButtonSettings,
  },
};
