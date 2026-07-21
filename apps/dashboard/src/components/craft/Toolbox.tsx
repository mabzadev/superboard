import { Element, useEditor } from "@craftjs/core";
import { TextComponent } from "./Text";
import { ButtonComponent } from "./Button";
import { ContainerComponent } from "./Container";
import { ImageComponent } from "./Image";
import {
  BoxSelect,
  CircleDotDashed,
  GripVertical,
  Logs,
  ScanFace,
  SquareDashedKanban,
} from "lucide-react";

export const Toolbox = () => {
  const { connectors } = useEditor();

  const items = [
    {
      label: "Text",
      icon: Logs,
      create: <TextComponent />,
    },
    {
      label: "Button",
      icon: CircleDotDashed,
      create: <ButtonComponent />,
    },
    {
      label: "Container",
      icon: BoxSelect,
      create: <Element is={ContainerComponent} canvas />,
    },
    {
      label: "Image",
      icon: ScanFace,
      create: <Element is={ImageComponent} canvas />,
    },
  ];

  return (
    <div className="flex flex-col p-3 gap-1">
      <div className="flex items-center gap-2 px-1 mb-1">
        <SquareDashedKanban className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Components
        </span>
      </div>

      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div
            key={item.label}
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm cursor-grab hover:bg-sidebar-accent/50 transition-colors"
            ref={(ref) => {
              if (ref) connectors.create(ref, item.create);
            }}
          >
            <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
            <span>{item.label}</span>
            <GripVertical className="ml-auto h-3 w-3 text-muted-foreground/40" />
          </div>
        );
      })}
    </div>
  );
};
