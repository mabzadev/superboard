import { type LinkComponentType } from "@superboard/flows-shared";

declare global {
  interface Window {
    __flows_LinkComponent?: LinkComponentType;
  }
}
