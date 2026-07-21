import {
  ALL_USERS_FILTER,
  ANDROID,
  EXISTING_USERS_FILTER,
  GOOGLE,
  IOS,
  LINKEDIN,
  META,
  NEW_USERS_FILTER,
  QUICK_LINK,
  TIKTOK,
  WEB,
} from "./OptionsConstants";

export interface FilterOption {
  label: string;
  value: string;
  filterType?: string;
}

export const adsFilterList: FilterOption[] = [
  { label: "Quick Links", value: QUICK_LINK },
  { label: "Google", value: GOOGLE },
  { label: "Meta ", value: META },
  { label: "LinkedIn", value: LINKEDIN },
  { label: "TikTok", value: TIKTOK },
  { label: "All", value: "", filterType: "ads" },
] as const;

export const platformsFilterList: FilterOption[] = [
  { label: "iOS ", value: IOS },
  { label: "Android", value: ANDROID },
  { label: "Web", value: WEB },
  { label: "All", value: "", filterType: "platforms" },
] as const;

export const targetFilterList: FilterOption[] = [
  { label: "Existing users", value: EXISTING_USERS_FILTER },
  { label: "New users", value: NEW_USERS_FILTER },
  { label: "All users", value: ALL_USERS_FILTER, filterType: "users" },
] as const;
