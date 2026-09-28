"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PlausibleScript } from "./plausible-script";

const CONSENT_KEY = "bxb_analytics_consent";

type ConsentState = "granted" | "denied" | null;

function getStoredConsent(): ConsentState {
  if (typeof window === "undefined") return null;
  try {
    const value = localStorage.getItem(CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

function setStoredConsent(value: ConsentState) {
  if (typeof window === "undefined") return;
  try {
    if (value === null) {
      localStorage.removeItem(CONSENT_KEY);
    } else {
      localStorage.setItem(CONSENT_KEY, value);
    }
  } catch {
    // Ignore storage errors.
  }
}

interface CookieConsentProps {
  plausibleDomain?: string;
}

export function CookieConsent({ plausibleDomain = "app.bitxbit.com.au" }: CookieConsentProps) {
  const [consent, setConsent] = useState<ConsentState>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setConsent(getStoredConsent());
  }, []);

  const handleAccept = () => {
    setStoredConsent("granted");
    setConsent("granted");
  };

  const handleDecline = () => {
    setStoredConsent("denied");
    setConsent("denied");
  };

  if (!mounted) return <PlausibleScript domain={plausibleDomain} enabled={false} />;

  const showBanner = consent === null;

  return (
    <>
      <PlausibleScript domain={plausibleDomain} enabled={consent === "granted"} />
      {showBanner && (
        <div
          role="dialog"
          aria-live="polite"
          aria-label="Cookie consent"
          className="fixed bottom-0 left-0 right-0 z-[100] border-t border-border bg-card p-4 shadow-lg animate-in slide-in-from-bottom-5"
        >
          <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <p className="text-sm text-muted-foreground">
              We use privacy-friendly analytics to understand how the app is used.
              No personal data is collected and no cookies are stored by our analytics provider.
            </p>
            <div className="flex shrink-0 gap-3">
              <Button variant="outline" size="sm" onClick={handleDecline}>
                Decline
              </Button>
              <Button size="sm" onClick={handleAccept}>
                Accept
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
