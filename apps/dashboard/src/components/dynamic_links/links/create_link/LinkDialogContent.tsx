"use client";

import React from "react";
import CreateLinkSidebar from "./CreateLinkSidebar";
import CreateLinkDetailsSection from "./CreateLinkDetailsSection";
import CreateLinkSocialMediaPreview from "./CreateLinkSocialMediaPreview";
import CreateLinkDataSection from "./CreateLinkDataSection";
import CreateLinksRedirectsSection from "./CreateLinksRedirectsSection";
import CreateLinkTrackingSection from "./CreateLinkTrackingSection";
import type { useCreateLinkForm } from "@/hooks/useCreateLinkForm";

interface LinkDialogContentProps {
  sections: { text: string; value: string; checked: string }[];
  section: string;
  setSection: (section: string) => void;
  disabledActions: boolean;
  showErrors: boolean;
  form: ReturnType<typeof useCreateLinkForm>;
  domain: string;
}

const LinkDialogContent: React.FC<LinkDialogContentProps> = ({
  sections,
  section,
  setSection,
  disabledActions,
  showErrors,
  form,
  domain,
}) => {
  return (
    <div className="flex h-full w-full overflow-hidden">
      <CreateLinkSidebar
        sections={sections}
        section={section}
        setSection={setSection}
      />
      {section === "details" && (
        <CreateLinkDetailsSection
          path={form.path}
          setPath={form.setPath}
          pathAvailable={form.pathAvailable}
          name={form.name}
          setName={form.setName}
          tags={form.tagList}
          setTagList={form.setTagList}
          domain={domain}
          linkType={form.linkType}
          setLinkType={form.setLinkType}
          disabledActions={disabledActions}
          showErrors={showErrors}
        />
      )}
      {section === "social_media_preview" && (
        <CreateLinkSocialMediaPreview
          title={form.socialMediaTitle}
          setTitle={form.setSocialMediaTitle}
          subtitle={form.socialMediaSubTitle}
          setSubtitle={form.setSocialMediaSubTitle}
          imageType={form.imageType}
          setImageType={form.setImageType}
          imageFile={form.imageFile}
          setImageFile={form.setImageFile}
          imageLink={form.imageLink}
          setImageLink={form.setImageLink}
          setImagePreview={form.setImagePreview}
          imagePreview={form.imagePreview}
          disabledActions={disabledActions}
        />
      )}
      {section === "data" && (
        <CreateLinkDataSection
          addKeyValuePair={form.addKeyValuePair}
          data={form.keyValuePair}
          columns={form.columns}
          disabledActions={disabledActions}
        />
      )}
      {section === "redirects" && (
        <CreateLinksRedirectsSection
          androidRedirectURL={form.androidRedirectURL}
          setAndroidRedirectURL={form.setAndroidRedirectURL}
          androidRedirectType={form.androidRedirectType}
          setAndroidRedirectType={form.setAndroidRedirectType}
          showPreviewAndroid={form.showPreviewAndroid}
          setShowPreviewAndroid={form.setShowPreviewAndroid}
          iosRedirectURL={form.iOSRedirectURL}
          setIosRedirectURL={form.setiOSRedirectURL}
          iosRedirectType={form.iOSRedirectType}
          setIosRedirectType={form.setiOSRedirectType}
          setShowPreviewIOS={form.setShowPreviewIOS}
          showPreviewIOS={form.showPreviewIOS}
          desktopRedirectURL={form.desktopRedirectURL}
          setDesktopRedirectURL={form.setDesktopRedirectURL}
          desktopRedirectType={form.desktopRedirectType}
          setDesktopRedirectType={form.setDesktopRedirectType}
          disabledActions={disabledActions}
          showErrors={showErrors}
        />
      )}
      {section === "tracking" && (
        <CreateLinkTrackingSection
          source={form.utmSource}
          setSource={form.setUtmSource}
          medium={form.utmMedium}
          setMedium={form.setUtmMedium}
          campaignName={form.utmCampaign}
          setCampaignName={form.setUtmCampaign}
          disabledActions={disabledActions}
        />
      )}
    </div>
  );
};

export default LinkDialogContent;
