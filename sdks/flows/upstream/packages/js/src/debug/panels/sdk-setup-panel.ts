import { type TemplateResult, html } from "lit";

interface Props {
  projectId: string;
  environment: string;
  statusItems: TemplateResult;
}

export const SdkSetupPanel = ({
  projectId,
  environment,
  statusItems,
}: Props): TemplateResult => {
  const projectText = projectId
    ? projectId
    : html`<span class="flows-debug-validation-invalid">Not set</span>`;
  const environmentText = environment
    ? environment
    : html`<span class="flows-debug-validation-invalid">Not set</span>`;
  return html`
    <p class="flows-debug-info-line">
      <strong>Project ID:</strong>
      <code class="flows-debug-inline-code">${projectText}</code>
    </p>
    <p class="flows-debug-info-line">
      <strong>Environment:</strong>
      <code class="flows-debug-inline-code">${environmentText}</code>
    </p>
    <p class="flows-debug-info-line">
      <strong>Validation:</strong>
    </p>
    ${statusItems}
  `;
};
