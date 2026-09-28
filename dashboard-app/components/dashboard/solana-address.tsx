"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { truncateAddress } from "@/lib/utils";
import { Copy, Check, ExternalLink } from "lucide-react";

interface SolanaAddressProps {
  address: string;
  showCopy?: boolean;
  showLink?: boolean;
  truncate?: boolean;
}

export function SolanaAddress({
  address,
  showCopy = true,
  showLink = true,
  truncate = true,
}: SolanaAddressProps) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      toast({ title: "Copied", description: "Address copied to clipboard." });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed", description: "Could not copy address.", variant: "destructive" });
    }
  };

  return (
    <div className="inline-flex items-center gap-2">
      <span className="font-mono text-sm break-all">{truncate ? truncateAddress(address) : address}</span>
      {showCopy && (
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopy}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      )}
      {showLink && (
        <Button variant="ghost" size="icon" className="h-6 w-6" asChild>
          <a href={`https://solscan.io/account/${address}`} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </Button>
      )}
    </div>
  );
}
