import { useEditor, useNode } from "@craftjs/core";
import clsx from "clsx";
import { ComponentToolbar } from "./ComponentToolbar";
import { useRef, useState } from "react";

import { Input } from "../ui/input";
import { Label } from "../ui/label";
import type { ImageCraftProps } from "@/types";

export const ImageComponent = ({
  marginTop,
  marginBottom,
  marginRight,
  marginLeft,
  src,
  alt,
  minWidth,
  minHeight,
  maxHeight,
  maxWidth,
}: ImageCraftProps) => {
  const {
    id,
    connectors: { connect, drag },
    selected,
  } = useNode((node) => ({
    selected: node.events.selected,
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
    }, 100); // Delay hiding by 200ms
    setIsHovered(false);
  };

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
        minWidth,
        minHeight,
      }}
      className={clsx(
        "relative transition-all duration-150  ",
        selected && "outline-2 outline-blue-500",
        enabled &&
          !selected &&
          " hover:outline-blue-500 hover:outline-1 hover:outline-dashed "
      )}
    >
      {enabled && (selected || isHovered) && (
        <ComponentToolbar label="Image" nodeId={id} dragConnector={drag} />
      )}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        style={{
          margin: 0,
          width: "100%",
          height: "100%",
          minHeight: "50px",
          minWidth: "50px",
          objectFit: "contain",
          maxHeight,
          maxWidth,
        }}
      />
    </div>
  );
};

export const ImageSettings = () => {
  const {
    actions: { setProp },
    props,
  } = useNode((node) => ({
    props: node.data.props,
  }));

  return (
    <div className="flex flex-col gap-3 px-3 py-2">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Image URL</Label>
        <Input
          className="h-8"
          value={props.src}
          placeholder="https://"
          onChange={(e) =>
            setProp((p: Record<string, string>) => (p.src = e.target.value))
          }
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Alt Text</Label>
        <Input
          className="h-8"
          value={props.alt}
          placeholder="Description"
          onChange={(e) =>
            setProp((p: Record<string, string>) => (p.alt = e.target.value))
          }
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Max Width</Label>
          <Input
            className="h-8"
            value={props.maxWidth}
            placeholder="100%"
            onChange={(e) =>
              setProp(
                (p: Record<string, string>) => (p.maxWidth = e.target.value)
              )
            }
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Max Height</Label>
          <Input
            className="h-8"
            value={props.maxHeight}
            placeholder="100%"
            onChange={(e) =>
              setProp(
                (p: Record<string, string>) => (p.maxHeight = e.target.value)
              )
            }
          />
        </div>
      </div>
    </div>
  );
};

ImageComponent.craft = {
  displayName: "Text",
  props: {
    marginTop: "0px",
    marginBottom: "0px",
    marginRight: "0px",
    marginLeft: "0px",
    minWidth: "50px",
    minHeight: "50px",
    maxHeight: "100%",
    maxWidth: "100%",
  },
  related: {
    settings: ImageSettings,
  },
};
