"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NPM } from "@/constants/OptionsConstants";
import { SectionHeader } from "@/components/developers/SetupShared";
import { handleCopyText } from "@/lib/copyTextHelper";
import { Copy, ExternalLink, Package } from "lucide-react";

const Step1AddSDK = () => {
  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        icon={Package}
        title="Add the SDK"
        subtitle="Install the opengrow SDK using NPM."
      />

      <Tabs defaultValue={NPM} className="gap-4">
        <TabsList>
          <TabsTrigger value={NPM}>NPM</TabsTrigger>
        </TabsList>
        <TabsContent value={NPM}>
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <Input
                value={"npm install opengrow"}
                readOnly
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                className="pl-3 pr-4 shrink-0 h-9"
                onClick={() => handleCopyText("npm install opengrow")}
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </Button>
            </div>
            <span className="text-xs text-muted-foreground">
              To add a new npm package, simply include its dependency in your
              package.json file, then run npm install to integrate it into your
              project.
            </span>
            <a
              target="_blank"
              href={`${process.env.NEXT_PUBLIC_DOCS_URL}/docs/how-to-guides/web/npm`}
              className="inline-flex items-center gap-1 text-xs text-[var(--chart-users)] hover:text-[var(--chart-users-hover)] transition-colors w-fit"
            >
              Show me how to integrate an NPM package
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Step1AddSDK;
