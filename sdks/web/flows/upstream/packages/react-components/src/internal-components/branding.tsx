import type { FC } from "react";

type Props = {
  className?: string;
  component: string;
};

/** Branding is owned by the SuperBoard host and is never injected by the SDK. */
export const Branding: FC<Props> = () => null;
