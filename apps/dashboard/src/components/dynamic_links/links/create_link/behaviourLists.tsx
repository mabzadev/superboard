import {
  AUTOMATIC,
  DEFAULT,
  SHOW_PREVIEWS,
} from "@/constants/OptionsConstants";

export const BEHAVIOUR_OPTIONS = [
  {
    text: "Default",
    value: DEFAULT,
  },
  {
    text: "Show app preview page",
    value: SHOW_PREVIEWS,
  },
  {
    text: "Skip app preview page",
    value: AUTOMATIC,
  },
];
