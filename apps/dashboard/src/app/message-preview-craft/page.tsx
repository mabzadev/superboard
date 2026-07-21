"use client";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MOBILE, WEB } from "@/constants/OptionsConstants";
import LocalStorage from "@/lib/LocalStorage";
import { useEffect, useState } from "react";

const MessagePreviewCraft = () => {
  const [htmlPage, setHtmlPage] = useState<string | null>(null);

  useEffect(() => {
    const saved = LocalStorage.getCraftPreview();

    if (saved) {
      setHtmlPage(saved);
    }
  }, []);

  if (!htmlPage)
    return (
      <div className="flex items-center justify-center h-dvh">
        <Skeleton className="h-8 w-32" />
      </div>
    );

  return (
    <div className="flex flex-col items-center w-full h-dvh p-4 ">
      <Tabs
        defaultValue={WEB}
        className="flex flex-col gap-4 h-full overflow-hidden items-center w-full"
      >
        <TabsList>
          <TabsTrigger value={MOBILE}>Mobile</TabsTrigger>
          <TabsTrigger value={WEB}>Web</TabsTrigger>
        </TabsList>

        <TabsContent
          value={MOBILE}
          className="flex justify-center items-center w-full h-full overflow-hidden"
        >
          <iframe
            srcDoc={htmlPage}
            className="rounded border shadow-md max-w-[390px] max-h-[844px] w-full h-full "
          />
        </TabsContent>

        <TabsContent value={WEB} className="w-full h-full overflow-hidden flex">
          <iframe
            srcDoc={htmlPage}
            className="rounded border shadow-md w-full h-full"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default MessagePreviewCraft;
