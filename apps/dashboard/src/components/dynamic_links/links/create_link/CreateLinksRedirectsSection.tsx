import React, { useEffect, useState } from "react";
import type { RedirectURL } from "@/types";

import CreateLinkAndroidRedirect from "./CreateLinkAndroidRedirect";
import {
  APP_OR_FALLBACK,
  AUTOMATIC,
  DEFAULT,
  SHOW_PREVIEWS,
} from "@/constants/OptionsConstants";
import { Separator } from "@/components/ui/separator";
import CreateLinkIosRedirect from "./CreateLinkIosRedirect";
import CreateLinkComputersRedirect from "./CreateLinkComputersRedirect";

const CreateLinksRedirectsSection = React.memo(
  function CreateLinksRedirectsSection({
    androidRedirectURL,
    setAndroidRedirectURL,
    androidRedirectType,
    setAndroidRedirectType,
    showPreviewAndroid,
    setShowPreviewAndroid,

    iosRedirectURL,
    setIosRedirectURL,

    iosRedirectType,
    setIosRedirectType,
    setShowPreviewIOS,
    showPreviewIOS,

    desktopRedirectURL,
    setDesktopRedirectURL,
    desktopRedirectType,
    setDesktopRedirectType,

    disabledActions,
    showErrors,
  }: {
    androidRedirectURL: RedirectURL | null;
    androidRedirectType: string;
    showPreviewAndroid: boolean | null;
    setAndroidRedirectURL: React.Dispatch<
      React.SetStateAction<RedirectURL | null>
    >;
    setAndroidRedirectType: (value: string) => void;
    setShowPreviewAndroid: (value: boolean | null) => void;

    iosRedirectURL: RedirectURL | null;
    iosRedirectType: string;
    showPreviewIOS: boolean | null;
    setIosRedirectURL: React.Dispatch<React.SetStateAction<RedirectURL | null>>;
    setIosRedirectType: (value: string) => void;
    setShowPreviewIOS: (value: boolean | null) => void;

    desktopRedirectURL: RedirectURL | null;
    desktopRedirectType: string;
    setDesktopRedirectURL: React.Dispatch<
      React.SetStateAction<RedirectURL | null>
    >;
    setDesktopRedirectType: (value: string) => void;

    disabledActions?: boolean;
    showErrors?: boolean;
  }) {
    const [androidLinkBehaviour, setAndroidLinkBehaviour] = useState<string>(
      () => {
        if (showPreviewAndroid === undefined || showPreviewAndroid === null) {
          return DEFAULT;
        }
        return showPreviewAndroid ? SHOW_PREVIEWS : AUTOMATIC;
      }
    );

    const [iosLinkBehaviour, setIosLinkBehaviour] = useState<string>(() => {
      if (showPreviewIOS === undefined || showPreviewIOS === null) {
        return DEFAULT;
      }
      return showPreviewIOS ? SHOW_PREVIEWS : AUTOMATIC;
    });

    useEffect(() => {
      if (androidRedirectType === DEFAULT) {
        setAndroidRedirectURL(null);
        return;
      }

      setAndroidRedirectURL((prev: RedirectURL | null) => ({
        url: prev?.url ?? "",
        open_app_if_installed: androidRedirectType === APP_OR_FALLBACK,
      }));
    }, [androidRedirectType, setAndroidRedirectURL]);

    useEffect(() => {
      if (iosRedirectType === DEFAULT) {
        setIosRedirectURL(null);
        return;
      }

      setIosRedirectURL((prev: RedirectURL | null) => ({
        url: prev?.url ?? "",
        open_app_if_installed: iosRedirectType === APP_OR_FALLBACK,
      }));
    }, [iosRedirectType, setIosRedirectURL]);

    useEffect(() => {
      if (desktopRedirectType === DEFAULT) {
        setDesktopRedirectURL(null);
        return;
      }
      setDesktopRedirectURL((prev: RedirectURL | null) => ({
        url: prev?.url ?? "",
        open_app_if_installed: false,
      }));
    }, [desktopRedirectType, setDesktopRedirectURL]);

    return (
      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col gap-2 overflow-auto">
          <div className="flex flex-col gap-5 px-6 py-5">
            <CreateLinkAndroidRedirect
              androidRedirectURL={androidRedirectURL}
              setAndroidRedirectURL={setAndroidRedirectURL}
              androidRedirectType={androidRedirectType}
              setAndroidRedirectType={setAndroidRedirectType}
              androidLinkBehaviour={androidLinkBehaviour}
              setAndroidLinkBehaviour={setAndroidLinkBehaviour}
              setShowPreviewAndroid={setShowPreviewAndroid}
              disabledActions={disabledActions}
              showErrors={showErrors}
            />

            <Separator className="max-w-[460px]" />

            <CreateLinkIosRedirect
              iosRedirectURL={iosRedirectURL}
              setIosRedirectURL={setIosRedirectURL}
              iosRedirectType={iosRedirectType}
              setIosRedirectType={setIosRedirectType}
              iosLinkBehaviour={iosLinkBehaviour}
              setIosLinkBehaviour={setIosLinkBehaviour}
              setShowPreviewIOS={setShowPreviewIOS}
              disabledActions={disabledActions}
              showErrors={showErrors}
            />

            <Separator className="max-w-[460px]" />

            <CreateLinkComputersRedirect
              desktopRedirectType={desktopRedirectType}
              setDesktopRedirectType={setDesktopRedirectType}
              desktopRedirectURL={desktopRedirectURL}
              setDesktopRedirectURL={setDesktopRedirectURL}
              disabledActions={disabledActions}
              showErrors={showErrors}
            />
          </div>
        </div>
      </div>
    );
  }
);

export default CreateLinksRedirectsSection;
