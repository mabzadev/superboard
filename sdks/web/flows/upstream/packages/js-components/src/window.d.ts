import { type OnNavigate } from "@superboard/flows-shared";

declare global {
  interface Window {
    __flows_onNavigate?: OnNavigate;
  }
}
