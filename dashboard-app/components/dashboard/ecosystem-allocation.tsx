"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const allocations = [
  { label: "Community Rewards", value: 40, color: "bg-blue-500" },
  { label: "Liquidity", value: 25, color: "bg-emerald-500" },
  { label: "Buybacks", value: 15, color: "bg-purple-500" },
  { label: "Projects", value: 10, color: "bg-amber-500" },
  { label: "Operations", value: 10, color: "bg-slate-500" },
];

export function EcosystemAllocation() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ecosystem Flow</CardTitle>
        <CardDescription>How referral income supports the community.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {allocations.map((item) => (
            <div key={item.label} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span>{item.label}</span>
                <span className="text-muted-foreground">{item.value}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full ${item.color} rounded-full transition-all duration-1000 ease-out`}
                  style={{ width: `${item.value}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
