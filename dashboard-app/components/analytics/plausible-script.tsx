"use client";

import Script from "next/script";

interface PlausibleScriptProps {
  domain?: string;
  enabled?: boolean;
}

export function PlausibleScript({
  domain = "app.bitxbit.com.au",
  enabled = true,
}: PlausibleScriptProps) {
  if (!enabled) return null;

  return (
    <Script
      defer
      data-domain={domain}
      src="https://plausible.io/js/script.js"
      strategy="afterInteractive"
    />
  );
}
