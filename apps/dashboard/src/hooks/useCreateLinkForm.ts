import { type SetStateAction, useCallback, useMemo } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import {
  DEFAULT,
  FACEBOOK,
  FILE,
  FULL_CHECK,
  LINK,
  NO_CHECK,
  PARTIAL_CHECK,
  QUICK_LINK,
} from "@/constants/OptionsConstants";
import { createAddNewLinkDataTableColumns } from "@/components/dynamic_links/links/create_link/CreateLinkDataTableColumns";
import { deepClone } from "@/lib/utils";
import { getRedirectType } from "@/lib/redirectsHelpers";
import isURL from "validator/lib/isURL";
import { mapKeyPairValues } from "@/lib/utils";
import { isValidHttpsUrl } from "@/lib/validation";
import type { Link } from "@/types";
import type { CreateLinkFormValues } from "@/schemas/link";

/** Resolve a SetStateAction<T> against the current value */
function resolveAction<T>(action: SetStateAction<T>, current: T): T {
  return typeof action === "function"
    ? (action as (prev: T) => T)(current)
    : action;
}

const defaultValues: CreateLinkFormValues = {
  section: "details",
  linkType: QUICK_LINK,
  name: "",
  path: "",
  pathAvailable: true,
  socialMediaTitle: "",
  socialMediaSubTitle: "",
  imageFile: undefined,
  imageLink: "",
  imageType: FILE,
  imagePreview: null,
  socialMediaCardType: FACEBOOK,
  keyValuePair: [],
  tagList: [],
  iOSRedirectURL: null,
  androidRedirectURL: null,
  desktopRedirectURL: null,
  utmCampaign: "",
  utmMedium: "",
  utmSource: "",
  androidRedirectType: DEFAULT,
  iOSRedirectType: DEFAULT,
  desktopRedirectType: DEFAULT,
  showPreviewAndroid: null,
  showPreviewIOS: null,
};

export function useCreateLinkForm() {
  const form: UseFormReturn<CreateLinkFormValues> =
    useForm<CreateLinkFormValues>({
      defaultValues,
      mode: "onChange",
    });

  // --- Watch all fields for reactivity ---
  const section = form.watch("section");
  const linkType = form.watch("linkType");
  const name = form.watch("name");
  const path = form.watch("path");
  const pathAvailable = form.watch("pathAvailable");
  const socialMediaTitle = form.watch("socialMediaTitle");
  const socialMediaSubTitle = form.watch("socialMediaSubTitle");
  const imageFile = form.watch("imageFile");
  const imageLink = form.watch("imageLink");
  const imageType = form.watch("imageType");
  const imagePreview = form.watch("imagePreview");
  const socialMediaCardType = form.watch("socialMediaCardType");
  const keyValuePair = form.watch("keyValuePair");
  const tagList = form.watch("tagList");
  const iOSRedirectURL = form.watch("iOSRedirectURL");
  const androidRedirectURL = form.watch("androidRedirectURL");
  const desktopRedirectURL = form.watch("desktopRedirectURL");
  const utmCampaign = form.watch("utmCampaign");
  const utmMedium = form.watch("utmMedium");
  const utmSource = form.watch("utmSource");
  const androidRedirectType = form.watch("androidRedirectType");
  const iOSRedirectType = form.watch("iOSRedirectType");
  const desktopRedirectType = form.watch("desktopRedirectType");
  const showPreviewAndroid = form.watch("showPreviewAndroid");
  const showPreviewIOS = form.watch("showPreviewIOS");

  // --- Compatibility setters (accept SetStateAction to match Dispatch<SetStateAction<T>>) ---
  const setSection = useCallback(
    (v: SetStateAction<string>) =>
      form.setValue("section", resolveAction(v, form.getValues("section")), {
        shouldDirty: true,
      }),
    [form]
  );
  const setLinkType = useCallback(
    (v: SetStateAction<string>) =>
      form.setValue("linkType", resolveAction(v, form.getValues("linkType")), {
        shouldDirty: true,
      }),
    [form]
  );
  const setName = useCallback(
    (v: SetStateAction<string>) =>
      form.setValue("name", resolveAction(v, form.getValues("name")), {
        shouldDirty: true,
      }),
    [form]
  );
  const setPath = useCallback(
    (v: SetStateAction<string>) =>
      form.setValue("path", resolveAction(v, form.getValues("path")), {
        shouldDirty: true,
      }),
    [form]
  );
  const setPathAvailable = useCallback(
    (v: SetStateAction<boolean>) =>
      form.setValue(
        "pathAvailable",
        resolveAction(v, form.getValues("pathAvailable"))
      ),
    [form]
  );
  const setSocialMediaTitle = useCallback(
    (v: SetStateAction<string>) =>
      form.setValue(
        "socialMediaTitle",
        resolveAction(v, form.getValues("socialMediaTitle")),
        { shouldDirty: true }
      ),
    [form]
  );
  const setSocialMediaSubTitle = useCallback(
    (v: SetStateAction<string>) =>
      form.setValue(
        "socialMediaSubTitle",
        resolveAction(v, form.getValues("socialMediaSubTitle")),
        { shouldDirty: true }
      ),
    [form]
  );
  const setImageFile = useCallback(
    (v: SetStateAction<File | undefined>) =>
      form.setValue(
        "imageFile",
        resolveAction(v, form.getValues("imageFile")),
        { shouldDirty: true }
      ),
    [form]
  );
  const setImageLink = useCallback(
    (v: SetStateAction<string>) =>
      form.setValue(
        "imageLink",
        resolveAction(v, form.getValues("imageLink")),
        { shouldDirty: true }
      ),
    [form]
  );
  const setImageType = useCallback(
    (v: SetStateAction<string>) =>
      form.setValue(
        "imageType",
        resolveAction(v, form.getValues("imageType")),
        { shouldDirty: true }
      ),
    [form]
  );
  const setImagePreview = useCallback(
    (v: SetStateAction<string | null>) =>
      form.setValue(
        "imagePreview",
        resolveAction(v, form.getValues("imagePreview")),
        { shouldDirty: true }
      ),
    [form]
  );
  const setSocialMediaCardType = useCallback(
    (v: SetStateAction<string>) =>
      form.setValue(
        "socialMediaCardType",
        resolveAction(v, form.getValues("socialMediaCardType")),
        { shouldDirty: true }
      ),
    [form]
  );
  const setKeyValuePair = useCallback(
    (v: SetStateAction<{ key: string; value: string }[]>) =>
      form.setValue(
        "keyValuePair",
        resolveAction(v, form.getValues("keyValuePair")),
        { shouldDirty: true }
      ),
    [form]
  );
  const setTagList = useCallback(
    (v: SetStateAction<string[]>) =>
      form.setValue("tagList", resolveAction(v, form.getValues("tagList")), {
        shouldDirty: true,
      }),
    [form]
  );
  const setiOSRedirectURL = useCallback(
    (v: SetStateAction<CreateLinkFormValues["iOSRedirectURL"]>) =>
      form.setValue(
        "iOSRedirectURL",
        resolveAction(v, form.getValues("iOSRedirectURL")),
        { shouldDirty: true }
      ),
    [form]
  );
  const setAndroidRedirectURL = useCallback(
    (v: SetStateAction<CreateLinkFormValues["androidRedirectURL"]>) =>
      form.setValue(
        "androidRedirectURL",
        resolveAction(v, form.getValues("androidRedirectURL")),
        { shouldDirty: true }
      ),
    [form]
  );
  const setDesktopRedirectURL = useCallback(
    (v: SetStateAction<CreateLinkFormValues["desktopRedirectURL"]>) =>
      form.setValue(
        "desktopRedirectURL",
        resolveAction(v, form.getValues("desktopRedirectURL")),
        { shouldDirty: true }
      ),
    [form]
  );
  const setUtmCampaign = useCallback(
    (v: SetStateAction<string>) =>
      form.setValue(
        "utmCampaign",
        resolveAction(v, form.getValues("utmCampaign")),
        { shouldDirty: true }
      ),
    [form]
  );
  const setUtmMedium = useCallback(
    (v: SetStateAction<string>) =>
      form.setValue(
        "utmMedium",
        resolveAction(v, form.getValues("utmMedium")),
        { shouldDirty: true }
      ),
    [form]
  );
  const setUtmSource = useCallback(
    (v: SetStateAction<string>) =>
      form.setValue(
        "utmSource",
        resolveAction(v, form.getValues("utmSource")),
        { shouldDirty: true }
      ),
    [form]
  );
  const setAndroidRedirectType = useCallback(
    (v: SetStateAction<string>) =>
      form.setValue(
        "androidRedirectType",
        resolveAction(v, form.getValues("androidRedirectType")),
        { shouldDirty: true }
      ),
    [form]
  );
  const setiOSRedirectType = useCallback(
    (v: SetStateAction<string>) =>
      form.setValue(
        "iOSRedirectType",
        resolveAction(v, form.getValues("iOSRedirectType")),
        { shouldDirty: true }
      ),
    [form]
  );
  const setDesktopRedirectType = useCallback(
    (v: SetStateAction<string>) =>
      form.setValue(
        "desktopRedirectType",
        resolveAction(v, form.getValues("desktopRedirectType")),
        { shouldDirty: true }
      ),
    [form]
  );
  const setShowPreviewAndroid = useCallback(
    (v: SetStateAction<boolean | null>) =>
      form.setValue(
        "showPreviewAndroid",
        resolveAction(v, form.getValues("showPreviewAndroid")),
        { shouldDirty: true }
      ),
    [form]
  );
  const setShowPreviewIOS = useCallback(
    (v: SetStateAction<boolean | null>) =>
      form.setValue(
        "showPreviewIOS",
        resolveAction(v, form.getValues("showPreviewIOS")),
        { shouldDirty: true }
      ),
    [form]
  );

  // --- Validation helpers ---

  const socialMediaCheck = () => {
    if (imageType === LINK) {
      if (
        socialMediaTitle !== "" ||
        socialMediaSubTitle !== "" ||
        imageLink !== ""
      ) {
        return FULL_CHECK;
      } else {
        return PARTIAL_CHECK;
      }
    } else {
      if (socialMediaTitle !== "" || socialMediaSubTitle !== "" || imageFile) {
        return FULL_CHECK;
      } else {
        return PARTIAL_CHECK;
      }
    }
  };

  const redirectsCheck = () => {
    const allDefault =
      androidRedirectType === DEFAULT &&
      iOSRedirectType === DEFAULT &&
      desktopRedirectType === DEFAULT;
    if (allDefault) return PARTIAL_CHECK;

    const androidUrlValid =
      androidRedirectType === DEFAULT ||
      (!!androidRedirectURL && isValidHttpsUrl(androidRedirectURL?.url));
    const iosUrlValid =
      iOSRedirectType === DEFAULT ||
      (!!iOSRedirectURL && isValidHttpsUrl(iOSRedirectURL?.url));
    const desktopUrlValid =
      desktopRedirectType === DEFAULT ||
      (!!desktopRedirectURL && isValidHttpsUrl(desktopRedirectURL?.url));

    if (androidUrlValid && iosUrlValid && desktopUrlValid) {
      return FULL_CHECK;
    } else {
      return NO_CHECK;
    }
  };

  const sections = [
    {
      text: "Details",
      value: "details",
      checked: name.length > 2 ? FULL_CHECK : NO_CHECK,
    },
    {
      text: "Social Media Preview",
      value: "social_media_preview",
      checked: socialMediaCheck(),
    },
    {
      text: "Data",
      value: "data",
      checked: keyValuePair.length > 0 ? FULL_CHECK : PARTIAL_CHECK,
    },
    {
      text: "Redirects",
      value: "redirects",
      checked: redirectsCheck(),
    },
    {
      text: "Tracking",
      value: "tracking",
      checked:
        utmCampaign !== "" && utmMedium !== "" && utmSource !== ""
          ? FULL_CHECK
          : PARTIAL_CHECK,
    },
  ];

  // --- Actions ---

  const handleCloseWindow = useCallback(() => {
    form.reset(defaultValues);
  }, [form]);

  const initializeFromLink = useCallback(
    (link: Link) => {
      form.reset({
        section: "details",
        linkType: link.ads_platform ?? QUICK_LINK,
        path: link.path ?? "",
        pathAvailable: true,
        name: link.name ?? "",
        tagList: link.tags ?? [],
        socialMediaTitle: link.title ?? "",
        socialMediaSubTitle: link.subtitle ?? "",
        imageType: LINK,
        imageLink: link.image ?? "",
        imageFile: undefined,
        imagePreview: null,
        socialMediaCardType: FACEBOOK,
        keyValuePair: mapKeyPairValues(link.data),
        utmSource: link.tracking_source ?? "",
        utmCampaign: link.tracking_campaign ?? "",
        utmMedium: link.tracking_medium ?? "",
        showPreviewIOS: link.show_preview_ios ?? null,
        showPreviewAndroid: link.show_preview_android ?? null,
        iOSRedirectType: getRedirectType(link.ios_custom_redirect),
        androidRedirectType: getRedirectType(link.android_custom_redirect),
        desktopRedirectType: getRedirectType(link.desktop_custom_redirect),
        iOSRedirectURL: link.ios_custom_redirect ?? null,
        androidRedirectURL: link.android_custom_redirect ?? null,
        desktopRedirectURL: link.desktop_custom_redirect ?? null,
      });
    },
    [form]
  );

  const hasDuplicateKeys = (arr: { key: string; value: string }[]) => {
    const seenKeys = new Set<string>();
    return arr.some((item: { key: string; value: string }) => {
      if (item.key === "") return false;
      if (seenKeys.has(item.key)) {
        return true;
      }
      seenKeys.add(item.key);
      return false;
    });
  };

  const addKeyValuePair = useCallback(
    (newKey: string, newValue: string) => {
      const current = form.getValues("keyValuePair");
      form.setValue(
        "keyValuePair",
        [...current, { key: newKey, value: newValue }],
        { shouldDirty: true }
      );
    },
    [form]
  );

  const handleRemoveItem = useCallback(
    (index: number) => {
      const list = deepClone(form.getValues("keyValuePair"));
      list.splice(index, 1);
      form.setValue("keyValuePair", list, { shouldDirty: true });
    },
    [form]
  );

  const columns = useMemo(
    () => createAddNewLinkDataTableColumns(handleRemoveItem),
    [handleRemoveItem]
  );

  const hasChanges = () => {
    return (
      name !== "" ||
      tagList.length > 0 ||
      socialMediaTitle !== "" ||
      socialMediaSubTitle !== "" ||
      imageFile !== undefined ||
      imageLink !== "" ||
      keyValuePair.length > 0 ||
      iOSRedirectURL !== null ||
      androidRedirectURL !== null ||
      desktopRedirectURL !== null ||
      utmCampaign !== "" ||
      utmMedium !== "" ||
      utmSource !== ""
    );
  };

  const disabledCreateButton = () => {
    let validImageLink = true;

    if (imageLink) {
      validImageLink = isURL(imageLink);
    }

    const androidUrlValid =
      androidRedirectType === DEFAULT ||
      (!!androidRedirectURL && isValidHttpsUrl(androidRedirectURL?.url));
    const iosUrlValid =
      iOSRedirectType === DEFAULT ||
      (!!iOSRedirectURL && isValidHttpsUrl(iOSRedirectURL?.url));
    const desktopUrlValid =
      desktopRedirectType === DEFAULT ||
      (!!desktopRedirectURL && isValidHttpsUrl(desktopRedirectURL?.url));
    const redirectsValid = androidUrlValid && iosUrlValid && desktopUrlValid;

    if (
      name.length < 3 ||
      path.length < 3 ||
      !validImageLink ||
      !redirectsValid ||
      !pathAvailable
    ) {
      return true;
    } else {
      return false;
    }
  };

  const getFirstErrorSection = (): string => {
    if (name.length < 3 || path.length < 3 || !pathAvailable) {
      return "details";
    }

    if (imageLink && !isURL(imageLink)) {
      return "social_media_preview";
    }

    const androidUrlValid =
      androidRedirectType === DEFAULT ||
      (!!androidRedirectURL && isValidHttpsUrl(androidRedirectURL?.url));
    const iosUrlValid =
      iOSRedirectType === DEFAULT ||
      (!!iOSRedirectURL && isValidHttpsUrl(iOSRedirectURL?.url));
    const desktopUrlValid =
      desktopRedirectType === DEFAULT ||
      (!!desktopRedirectURL && isValidHttpsUrl(desktopRedirectURL?.url));

    if (!androidUrlValid || !iosUrlValid || !desktopUrlValid) {
      return "redirects";
    }

    return "details";
  };

  return {
    // RHF form object for advanced use
    form,

    // Section state
    section,
    setSection,
    sections,

    // Core fields
    name,
    setName,
    path,
    setPath,
    pathAvailable,
    setPathAvailable,
    linkType,
    setLinkType,

    // Social media
    socialMediaTitle,
    setSocialMediaTitle,
    socialMediaSubTitle,
    setSocialMediaSubTitle,
    imageFile,
    setImageFile,
    imageLink,
    setImageLink,
    imageType,
    setImageType,
    imagePreview,
    setImagePreview,
    socialMediaCardType,
    setSocialMediaCardType,

    // Data
    keyValuePair,
    setKeyValuePair,
    tagList,
    setTagList,
    addKeyValuePair,
    handleRemoveItem,
    columns,

    // Redirects
    iOSRedirectURL,
    setiOSRedirectURL,
    androidRedirectURL,
    setAndroidRedirectURL,
    desktopRedirectURL,
    setDesktopRedirectURL,
    androidRedirectType,
    setAndroidRedirectType,
    iOSRedirectType,
    setiOSRedirectType,
    desktopRedirectType,
    setDesktopRedirectType,
    showPreviewAndroid,
    setShowPreviewAndroid,
    showPreviewIOS,
    setShowPreviewIOS,

    // Tracking
    utmCampaign,
    setUtmCampaign,
    utmMedium,
    setUtmMedium,
    utmSource,
    setUtmSource,

    // Utilities
    handleCloseWindow,
    initializeFromLink,
    hasDuplicateKeys,
    hasChanges,
    disabledCreateButton,
    getFirstErrorSection,
  };
}
