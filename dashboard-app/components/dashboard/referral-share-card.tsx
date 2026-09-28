"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { Copy, Check, Mail, MessageCircle, Share2 } from "lucide-react";

interface ReferralShareCardProps {
  referralLink: string;
}

function ShareButton({
  href,
  label,
  icon: Icon,
  onClick,
}: {
  href?: string;
  label: string;
  icon: React.ElementType;
  onClick?: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="flex-1"
      asChild={!!href}
      onClick={onClick}
    >
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer">
          <Icon className="h-4 w-4 mr-2" />
          {label}
        </a>
      ) : (
        <>
          <Icon className="h-4 w-4 mr-2" />
          {label}
        </>
      )}
    </Button>
  );
}

export function ReferralShareCard({ referralLink }: ReferralShareCardProps) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      toast({ title: "Copied!", description: "Referral link copied to clipboard." });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "Copy failed",
        description: "Could not copy to clipboard.",
        variant: "destructive",
      });
    }
  };

  const shareText = encodeURIComponent("Join me on bitXbit — a community referral ecosystem.");
  const shareUrl = encodeURIComponent(referralLink);

  const shareLinks = [
    {
      label: "X",
      icon: Share2,
      href: `https://twitter.com/intent/tweet?text=${shareText}&url=${shareUrl}`,
    },
    {
      label: "WhatsApp",
      icon: MessageCircle,
      href: `https://wa.me/?text=${shareText}%20${shareUrl}`,
    },
    {
      label: "Email",
      icon: Mail,
      href: `mailto:?subject=${encodeURIComponent("Join me on bitXbit")}&body=${shareText}%0A%0A${shareUrl}`,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <Input value={referralLink} readOnly className="flex-1 bg-muted/30" />
        <Button
          variant="outline"
          className="shrink-0"
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="h-4 w-4 mr-2" />
          ) : (
            <Copy className="h-4 w-4 mr-2" />
          )}
          {copied ? "Copied" : "Copy Link"}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {shareLinks.map((link) => (
          <ShareButton key={link.label} {...link} />
        ))}
      </div>
    </div>
  );
}
