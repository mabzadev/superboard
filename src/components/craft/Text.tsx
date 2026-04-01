import { useEditor, useNode } from "@craftjs/core";
import clsx from "clsx";
import { ComponentToolbar } from "./ComponentToolbar";
import { useEffect, useRef, useState } from "react";

import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import type { TextCraftProps } from "@/types";

const TEXT_SIZE_MAP: Record<string, string> = {
  "text-sm": "14px",
  "text-base": "16px",
  "text-lg": "18px",
  "text-xl": "20px",
  "text-2xl": "24px",
};

const TEXT_ALIGN_MAP: Record<string, string> = {
  "text-left": "left",
  "text-center": "center",
  "text-right": "right",
};

const FONT_WEIGHT_MAP: Record<string, string> = {
  "font-light": "300",
  "font-normal": "400",
  "font-semibold": "600",
  "font-bold": "700",
};

export const TextComponent = ({
  text = "Edit me",
  textSize = "text-base",
  textColor,
  textAlign = "text-left",
  fontWeight = "font-normal",
  marginTop,
  marginBottom,
  marginRight,
  marginLeft,
}: TextCraftProps) => {
  const {
    id,
    connectors: { connect, drag },
    selected,
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

  const handleBlur = () => {
    setEditing(false);
    if (contentRef.current) {
      const newText = contentRef.current.innerText;
      setProp((props: Record<string, string>) => (props.text = newText));
    }
  };

  const handleMouseEnter = () => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    hoverTimeout.current = setTimeout(() => {
      setIsHovered(false);
    }, 100); // Delay hiding by 200ms
    setIsHovered(false);
  };

  useEffect(() => {
    setEditing(selected);
  }, [selected]);

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      ref={(ref) => {
        if (ref) connect(ref);
      }}
      style={{
        marginTop,
        marginBottom,
        marginRight,
        marginLeft,
        width: "100%",
      }}
      className={clsx(
        "relative transition-all duration-150",
        selected && "outline-2 outline-blue-500",
        enabled &&
          !selected &&
          "hover:outline-blue-500 hover:outline-1 hover:outline-dashed"
      )}
    >
      {enabled && (selected || isHovered) && (
        <ComponentToolbar label="Text" nodeId={id} dragConnector={drag} />
      )}

      <p
        ref={contentRef}
        contentEditable={enabled && editing}
        suppressContentEditableWarning
        onBlur={handleBlur}
        style={{
          color: textColor,
          fontSize: TEXT_SIZE_MAP[textSize] ?? "16px",
          textAlign: (TEXT_ALIGN_MAP[textAlign] ??
            "left") as React.CSSProperties["textAlign"],
          fontWeight: FONT_WEIGHT_MAP[fontWeight] ?? "400",
          margin: 0,
          minHeight: "20px",
        }}
      >
        {text}
      </p>
    </div>
  );
};

export const TextSettings = () => {
  const {
    actions: { setProp },
    props,
  } = useNode((node) => ({
    props: node.data.props,
  }));

  return (
    <div className="flex flex-col gap-3 px-3 py-2">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Size</Label>
        <Select
          value={props.textSize}
          onValueChange={(v) =>
            setProp((p: Record<string, string>) => (p.textSize = v))
          }
        >
          <SelectTrigger className="h-8 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="text-sm">Small</SelectItem>
            <SelectItem value="text-base">Base</SelectItem>
            <SelectItem value="text-lg">Large</SelectItem>
            <SelectItem value="text-xl">XL</SelectItem>
            <SelectItem value="text-2xl">2XL</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Align</Label>
        <RadioGroup className="flex gap-3">
          {[
            { value: "text-left", label: "Left", id: "t1" },
            { value: "text-center", label: "Center", id: "t2" },
            { value: "text-right", label: "Right", id: "t3" },
          ].map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-1.5"
              onClick={() =>
                setProp(
                  (p: Record<string, string>) => (p.textAlign = item.value)
                )
              }
            >
              <RadioGroupItem
                value={item.value}
                id={item.id}
                checked={props.textAlign === item.value}
              />
              <Label htmlFor={item.id} className="text-xs">
                {item.label}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Weight</Label>
        <RadioGroup className="grid grid-cols-2 gap-2">
          {[
            { value: "font-light", label: "Light", id: "f1" },
            { value: "font-normal", label: "Normal", id: "f2" },
            { value: "font-semibold", label: "Semi Bold", id: "f3" },
            { value: "font-bold", label: "Bold", id: "f4" },
          ].map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-1.5"
              onClick={() =>
                setProp(
                  (p: Record<string, string>) => (p.fontWeight = item.value)
                )
              }
            >
              <RadioGroupItem
                value={item.value}
                id={item.id}
                checked={props.fontWeight === item.value}
              />
              <Label htmlFor={item.id} className="text-xs">
                {item.label}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>

      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">Color</Label>
        <div className="flex items-center gap-1.5">
          <Input
            value={props.textColor}
            onChange={(e) =>
              setProp(
                (p: Record<string, string>) => (p.textColor = e.target.value)
              )
            }
            className="h-7 w-20 font-mono text-xs px-2"
          />
          <div className="w-7 h-7 rounded-md border border-input overflow-hidden relative cursor-pointer shrink-0">
            <input
              value={props.textColor}
              onChange={(e) =>
                setProp(
                  (p: Record<string, string>) => (p.textColor = e.target.value)
                )
              }
              type="color"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <div
              className="w-full h-full"
              style={{ backgroundColor: props.textColor }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

TextComponent.craft = {
  displayName: "Text",
  props: {
    text: "Edit me",
    textSize: "text-base",
    textColor: "#171717", // ✅ hex color
    textAlign: "text-left",
    fontWeight: "font-normal",
    marginTop: "0px",
    marginBottom: "0px",
    marginRight: "0px",
    marginLeft: "0px",
  },
  related: {
    settings: TextSettings,
  },
};
