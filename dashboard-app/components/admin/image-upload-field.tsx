"use client";

import { useState, useId } from "react";
import {
  ASSET_ACCEPT_ATTRIBUTE,
  MAX_ASSET_BYTES,
  formatBytes,
  validateAsset,
} from "@/lib/asset-policy";

interface ImageUploadFieldProps {
  name: string;
  urlName?: string;
  defaultUrl?: string | null;
  label: string;
  accept?: string;
}

export function ImageUploadField({
  name,
  urlName = `${name}Url`,
  defaultUrl,
  label,
  accept = ASSET_ACCEPT_ATTRIBUTE,
}: ImageUploadFieldProps) {
  const [preview, setPreview] = useState<string | null>(defaultUrl ?? null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // R-006: the same rule the server enforces (lib/asset-policy.ts), applied here
    // so the operator finds out before the upload starts instead of after a failed
    // submit. A courtesy, not a control — the server re-checks the received file.
    const validation = validateAsset(file);
    if (!validation.ok) {
      setError(validation.error);
      setFileName(null);
      // Clear the input so a file the server will refuse is never submitted.
      e.target.value = "";
      return;
    }

    setError(null);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPreview(e.target.value || null);
    setFileName(null);
    setError(null);
  };

  return (
    <div className="space-y-2">
      <label className="text-xs text-muted-foreground">{label}</label>

      {preview && (
        <div className="relative w-fit max-w-full">
          <img
            src={preview}
            alt={label}
            className="h-24 w-auto rounded-md border border-border object-cover"
          />
        </div>
      )}

      <input
        type="url"
        name={urlName}
        defaultValue={defaultUrl ?? ""}
        placeholder={`${label} URL (or upload below)`}
        className="input w-full"
        onChange={handleUrlChange}
      />

      <div className="flex items-center gap-3">
        <input
          id={id}
          type="file"
          name={name}
          accept={accept}
          className="hidden"
          onChange={handleChange}
        />
        <label
          htmlFor={id}
          className="inline-flex cursor-pointer items-center justify-center rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
        >
          {fileName ? "Change file" : "Upload file"}
        </label>
        {fileName && (
          <span className="text-xs text-muted-foreground truncate max-w-[200px]">
            {fileName}
          </span>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          PNG, JPEG, WebP, GIF or SVG — up to {formatBytes(MAX_ASSET_BYTES)}.
        </p>
      )}
    </div>
  );
}
