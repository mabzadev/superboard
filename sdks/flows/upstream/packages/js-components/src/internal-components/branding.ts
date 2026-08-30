import type { TemplateResult } from "lit";
import { html } from "lit";

type Props = {
  className?: string;
  component: string;
};

/** Branding is owned by the SuperBoard host and is never injected by the SDK. */
export const Branding = (_props: Props): TemplateResult => html``;
