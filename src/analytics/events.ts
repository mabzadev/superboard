export const EVENTS = {
  // Auth
  SIGN_UP: "sign_up",
  LOGIN: "login",
  LOGOUT: "logout",

  // Core actions
  LINK_CREATED: "link_created",
  SDK_INTEGRATED: "sdk_integrated",
  REDIRECT_RULES_CREATED: "redirect_rules_created",
  PROJECT_CREATED: "project_created",
  TEAM_MEMBER_INVITED: "team_member_invited",

  // Conversion
  PURCHASE: "purchase",

  // Performance
  WEB_VITALS: "web_vitals",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

// Events that should be sent to GTM for ad conversion tracking
export const AD_CONVERSION_EVENTS: EventName[] = [
  EVENTS.SIGN_UP,
  EVENTS.SDK_INTEGRATED,
  EVENTS.LINK_CREATED,
  EVENTS.REDIRECT_RULES_CREATED,
  EVENTS.PROJECT_CREATED,
  EVENTS.TEAM_MEMBER_INVITED,
  EVENTS.PURCHASE,
];
