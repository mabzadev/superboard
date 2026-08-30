import { type ReactNode } from "react";

interface Props {
  projectId: string;
  environment: string;
  statusItems: ReactNode;
}

export const SdkSetupPanel = ({ projectId, environment, statusItems }: Props): ReactNode => {
  const projectText = projectId ? (
    projectId
  ) : (
    <span className="flows-debug-validation-invalid">Not set</span>
  );
  const environmentText = environment ? (
    environment
  ) : (
    <span className="flows-debug-validation-invalid">Not set</span>
  );
  return (
    <>
      <p className="flows-debug-info-line">
        <strong>Project ID:</strong>{" "}
        <code className="flows-debug-inline-code">{projectText}</code>
      </p>
      <p className="flows-debug-info-line">
        <strong>Environment:</strong>{" "}
        <code className="flows-debug-inline-code">{environmentText}</code>
      </p>
      <p className="flows-debug-info-line">
        <strong>Validation:</strong>
      </p>
      {statusItems}
    </>
  );
};
