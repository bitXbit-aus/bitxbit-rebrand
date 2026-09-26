"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";
import { ExternalLink, Gift } from "lucide-react";
import { trackOfferClick } from "@/lib/actions";

interface OfferCardProps {
  offer: {
    id: string;
    name: string;
    description: string | null;
    benefit_text: string | null;
    referral_url: string;
    reward_eligible: boolean;
    category?: { name: string } | null;
  };
}

export function OfferCard({ offer }: OfferCardProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleClick = async () => {
    setIsLoading(true);
    try {
      await trackOfferClick(offer.id);
      window.open(offer.referral_url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to track click",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="flex flex-col h-full hover:border-primary/30 transition-colors">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">{offer.name}</CardTitle>
            {offer.category && (
              <Badge variant="outline" className="mt-1.5 text-xs">
                {offer.category.name}
              </Badge>
            )}
          </div>
          {offer.reward_eligible && (
            <Badge variant="secondary" className="shrink-0">
              <Gift className="h-3 w-3 mr-1" />
              Reward
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col">
        {offer.description && (
          <CardDescription className="text-sm mb-3 line-clamp-3">
            {offer.description}
          </CardDescription>
        )}
        {offer.benefit_text && (
          <p className="text-sm text-primary mt-auto mb-4 font-medium">
            {offer.benefit_text}
          </p>
        )}
        <Button onClick={handleClick} disabled={isLoading} className="w-full mt-auto">
          {isLoading ? "Opening..." : "Visit Offer"}
          <ExternalLink className="h-4 w-4 ml-2" />
        </Button>
      </CardContent>
    </Card>
  );
}
