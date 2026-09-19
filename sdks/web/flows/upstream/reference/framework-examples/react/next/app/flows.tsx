"use client";

import { FC, ReactNode } from "react";
import Link from "next/link";
import { FlowsProvider } from "@superboard/flows-react";
import * as components from "@superboard/flows-react-components";
import * as tourComponents from "@superboard/flows-react-components/tour";
import * as surveyComponents from "@superboard/flows-react-components/survey";
import "@superboard/flows-react-components/index.css";

import { Banner } from "@/components/banner";
import { TourBanner } from "@/components/tour-banner";

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
        Banner: Banner,
      }}
      tourComponents={{
        ...tourComponents,
        Banner: TourBanner,
      }}
      surveyComponents={{ ...surveyComponents }}
      LinkComponent={Link}
    >
      {children}
    </FlowsProvider>
  );
};
