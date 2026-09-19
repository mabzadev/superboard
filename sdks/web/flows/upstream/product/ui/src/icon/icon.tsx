import { css, cx } from "@superboard/flows-styled-system/css";
import type { SystemStyleObject } from "@superboard/flows-styled-system/types";
import { type FC, forwardRef, type SVGProps } from "react";

type Props = {
  color?: SystemStyleObject["color"];
  icon: FC<SVGProps<SVGSVGElement>>;
  className?: string;
};

export const Icon = forwardRef<SVGSVGElement, Props>(function Icon(
  { icon, color, className, ...props },
  ref,
) {
  const Cmp = icon;

  return (
    <Cmp
      {...props}
      className={cx(css({ color: color ?? "fg.neutral.muted", flexShrink: 0 }), className)}
      ref={ref}
    />
  );
});
