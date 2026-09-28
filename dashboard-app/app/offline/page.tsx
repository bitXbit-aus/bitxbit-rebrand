import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WifiOff } from "lucide-react";

export default function OfflinePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="max-w-md w-full text-center">
        <CardHeader>
          <CardTitle className="flex items-center justify-center gap-2">
            <WifiOff className="h-5 w-5" />
            You are offline
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Some dashboard features require an internet connection. Please check your connection and try again.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
