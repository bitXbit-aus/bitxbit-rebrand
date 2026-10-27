"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { MIN_PASSWORD_LENGTH, validateNewPassword } from "@/lib/password-reset";

export function ResetPasswordForm({ email }: { email: string }) {
  const supabase = createClient();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const localError = validateNewPassword(password, confirmation);
    if (localError) {
      setError(localError);
      return;
    }

    setError(null);
    setLoading(true);

    // updateUser acts on the CURRENT session (the one the recovery link
    // established), so this can only ever change the signed-in user's own
    // password — it is not a path to another account.
    const { error: updateError } = await supabase.auth.updateUser({ password });

    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      toast({
        title: "Could not update password",
        description: updateError.message,
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Password updated",
      description: "You're signed in with your new password.",
    });
    router.push("/dashboard");
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold text-white">Set a new password</h1>
        <p className="text-muted-foreground">
          {email ? (
            <>
              Setting a new password for{" "}
              <span className="text-foreground">{email}</span>.
            </>
          ) : (
            "Choose a new password for your account."
          )}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm-password">Confirm new password</Label>
          <Input
            id="confirm-password"
            type="password"
            placeholder="••••••••"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Updating..." : "Update password"}
        </Button>
      </form>
    </div>
  );
}
