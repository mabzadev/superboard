import { css, cx } from "@superboard/flows-styled-system/css";
import { Box } from "@superboard/flows-styled-system/jsx";
import { type HTMLStyledProps } from "@superboard/flows-styled-system/types";
import * as SeparatorPrimitive from "@radix-ui/react-separator";
import type { ComponentProps, HTMLAttributes } from "react";

type Props = HTMLAttributes<HTMLDivElement> &
  HTMLStyledProps<"div"> & {
    className?: string;
    orientation?: ComponentProps<typeof SeparatorPrimitive.Root>["orientation"];
    decorative?: ComponentProps<typeof SeparatorPrimitive.Root>["decorative"];
  };

export const Separator = ({ ref, ...props }: Props) => {
  return (
    <SeparatorPrimitive.Root
      asChild
      {...props}
      className={cx(
        css({
          bg: "border.neutral",
          h: props.orientation === "vertical" ? "100%" : "1px",
          w: props.orientation === "vertical" ? "1px" : "100%",
        }),
        props.className,
      )}
      ref={ref}
    >
      <Box />
    </SeparatorPrimitive.Root>
  );
};
