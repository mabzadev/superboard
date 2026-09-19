import {
  type SurveyComponentProps,
  type ComponentProps,
  type TourComponentProps,
} from "@superboard/flows-shared";
import { type FC } from "react";

export type Component = FC<ComponentProps>;
export type Components = Record<string, Component>;

export type TourComponent = FC<TourComponentProps>;
export type TourComponents = Record<string, TourComponent>;

export type SurveyComponent = FC<SurveyComponentProps>;
export type SurveyComponents = Record<string, SurveyComponent>;
