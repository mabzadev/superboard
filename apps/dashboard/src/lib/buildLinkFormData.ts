import { FILE, LINK } from "@/constants/OptionsConstants";
import type { RedirectURL } from "@/types";

export interface BuildFormDataParams {
  name: string;
  path: string;
  linkType: string;
  socialMediaTitle: string;
  socialMediaSubTitle: string;
  imageType: string;
  imageFile: File | null | undefined;
  imageLink: string;
  tagList: string[];
  iOSRedirectURL: RedirectURL | null;
  androidRedirectURL: RedirectURL | null;
  desktopRedirectURL: RedirectURL | null;
  showPreviewIOS: boolean | null;
  showPreviewAndroid: boolean | null;
  keyValuePair: { key: string; value: string }[];
  utmCampaign: string;
  utmMedium: string;
  utmSource: string;
  mode: "create" | "edit";
  campaignID?: string;
  selectedLinkImage?: string;
}

export function buildLinkFormData(params: BuildFormDataParams): FormData {
  const formData = new FormData();
  formData.append("name", params.name);
  formData.append("path", params.path);
  formData.append("ads_platform", params.linkType);

  if (params.socialMediaTitle !== "")
    formData.append("title", params.socialMediaTitle);
  if (params.socialMediaSubTitle !== "")
    formData.append("subtitle", params.socialMediaSubTitle);

  if (params.imageType === FILE) {
    if (params.imageFile) formData.append("image", params.imageFile);
  } else if (params.imageType === LINK) {
    if (params.mode === "edit") {
      if (params.imageLink !== (params.selectedLinkImage ?? ""))
        formData.append("image_url", params.imageLink);
    } else {
      if (params.imageLink) formData.append("image_url", params.imageLink);
    }
  }

  if (params.tagList.length > 0)
    formData.append("tags", JSON.stringify(params.tagList));

  if (params.iOSRedirectURL)
    formData.append(
      "ios_custom_redirect",
      JSON.stringify(params.iOSRedirectURL)
    );
  if (params.androidRedirectURL)
    formData.append(
      "android_custom_redirect",
      JSON.stringify(params.androidRedirectURL)
    );
  if (params.showPreviewIOS != null)
    formData.append("show_preview_ios", String(params.showPreviewIOS));
  if (params.showPreviewAndroid != null)
    formData.append("show_preview_android", String(params.showPreviewAndroid));
  if (params.desktopRedirectURL)
    formData.append(
      "desktop_custom_redirect",
      JSON.stringify(params.desktopRedirectURL)
    );

  if (params.keyValuePair.length > 0) {
    const dict: Record<string, string> = {};
    params.keyValuePair.forEach((item) => {
      if (item.value !== "" && item.key !== "") {
        dict[item.key] = item.value;
      }
    });
    if (Object.keys(dict).length > 0)
      formData.append("data", JSON.stringify(dict));
  }

  if (params.mode === "create") {
    const cid = params.campaignID;
    if (cid != null && cid !== "") formData.append("campaign_id", cid);
  }

  if (params.utmCampaign?.length > 0)
    formData.append("tracking_campaign", params.utmCampaign);
  if (params.utmMedium?.length > 0)
    formData.append("tracking_medium", params.utmMedium);
  if (params.utmSource?.length > 0)
    formData.append("tracking_source", params.utmSource);

  return formData;
}
