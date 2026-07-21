"use client";

import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AlertCircle, Check, Upload } from "lucide-react";

interface FileUploadProps {
  /** Ref to the hidden file input */
  fileInputRef?: React.RefObject<HTMLInputElement | null>;
  /** Currently selected file (not yet saved) */
  selectedFile: File | null;
  /** Previously uploaded filename (already saved on server) */
  uploadedFilename?: string | null;
  /** Change handler for file selection */
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Whether to show validation error (no file selected) */
  showError?: boolean;
  /** Error message when no file is selected */
  errorMessage?: string;
  /** Accepted file types (e.g. ".p8,.pem" or ".json") */
  accept?: string;
  /** External error message (e.g. from a 422 API response) */
  serverError?: string | null;
}

export function FileUpload({
  fileInputRef,
  selectedFile,
  uploadedFilename,
  onChange,
  showError = false,
  errorMessage,
  accept,
  serverError,
}: FileUploadProps) {
  const internalRef = useRef<HTMLInputElement>(null);
  const inputRef = fileInputRef ?? internalRef;
  const [formatError, setFormatError] = useState<string | null>(null);

  const handleClick = () => {
    inputRef.current?.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    if (file && accept) {
      const extensions = accept
        .split(",")
        .map((ext) => ext.trim().toLowerCase());
      const fileName = file.name.toLowerCase();
      const matches = extensions.some((ext) => fileName.endsWith(ext));
      if (!matches) {
        setFormatError(`Invalid file type. Accepted: ${extensions.join(", ")}`);
        // Reset the input so the user can re-select
        if (inputRef.current) inputRef.current.value = "";
        return;
      }
    }
    setFormatError(null);
    onChange(e);
  };

  const hasFile = !!selectedFile || !!uploadedFilename;
  const displayName = selectedFile?.name ?? uploadedFilename;
  const activeError = formatError ?? serverError;

  return (
    <div className="flex flex-col gap-2">
      {/* Hidden native file input */}
      <input
        type="file"
        ref={inputRef as React.Ref<HTMLInputElement>}
        className="hidden"
        onChange={handleChange}
        accept={accept}
      />

      {/* Upload area */}
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg border border-dashed px-4 py-3 transition-colors",
          activeError
            ? "border-destructive/50 bg-destructive/5"
            : showError && !hasFile
              ? "border-destructive/50 bg-destructive/5"
              : "border-border bg-muted/30"
        )}
      >
        {hasFile && !activeError ? (
          <>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
              <Check className="h-4 w-4 text-primary" />
            </div>
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-sm font-medium truncate">
                {displayName}
              </span>
              <span className="text-xs text-muted-foreground">
                {selectedFile ? "Ready to upload" : "Currently uploaded"}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto shrink-0"
              onClick={handleClick}
            >
              Replace
            </Button>
          </>
        ) : (
          <>
            <div
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
                activeError ? "bg-destructive/10" : "bg-muted"
              )}
            >
              {activeError ? (
                <AlertCircle className="h-4 w-4 text-destructive" />
              ) : (
                <Upload className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
            <span
              className={cn(
                "text-sm",
                activeError ? "text-destructive" : "text-muted-foreground"
              )}
            >
              {activeError ?? "No file selected"}
            </span>
            <Button
              variant="default"
              size="sm"
              className="ml-auto shrink-0"
              onClick={handleClick}
            >
              {activeError ? "Try again" : "Choose file"}
            </Button>
          </>
        )}
      </div>

      {/* Validation error (no file selected) */}
      {showError && !hasFile && !activeError && errorMessage && (
        <Badge variant="destructive" className="w-fit gap-1.5 py-1 px-2.5">
          <AlertCircle className="h-3 w-3" />
          {errorMessage}
        </Badge>
      )}
    </div>
  );
}
