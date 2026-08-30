import type { FC, ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { FlowsProvider, type LinkComponentType } from "@superboard/flows-react";
import * as components from "@superboard/flows-react-components";
import * as tourComponents from "@superboard/flows-react-components/tour";
import * as surveyComponents from "@superboard/flows-react-components/survey";
import "@superboard/flows-react-components/index.css";

import { Banner } from "~/components/banner";
import { TourBanner } from "~/components/tour-banner";

type Props = {
  children: ReactNode;
};

const LinkComponent: LinkComponentType = ({ href, children, className, onClick }) => (
  <Link to={href} className={className} onClick={onClick}>
    {children}
  </Link>
);

export const Flows: FC<Props> = ({ children }) => {
  return (
    <FlowsProvider
      projectId="YOUR_PROJECT_ID"
      userId="YOUR_USER_ID"
      environment="production"
      LinkComponent={LinkComponent}
      components={{
        ...components,
        Banner: Banner,
      }}
      tourComponents={{
        ...tourComponents,
        Banner: TourBanner,
      }}
      surveyComponents={{ ...surveyComponents }}
    >
      {children}
    </FlowsProvider>
  );
};
