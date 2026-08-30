"use client";

import { FC, ReactNode } from "react";
import { FlowsProvider } from "@superboard/flows-react";
import * as components from "@superboard/flows-react-components";
import * as tourComponents from "@superboard/flows-react-components/tour";
import * as surveyComponents from "@superboard/flows-react-components/survey";
import "@superboard/flows-react-components/index.css";

type Props = {
  children?: ReactNode;
};

export const Flows: FC<Props> = ({ children }) => {
  return (
    <FlowsProvider
      projectId="YOUR_PROJECT_ID"
      userId="YOUR_USER_ID"
      environment="production"
      components={{
        ...components,
      }}
      tourComponents={{
        ...tourComponents,
      }}
      surveyComponents={{
        ...surveyComponents,
      }}
    >
      {children}
    </FlowsProvider>
  );
};
