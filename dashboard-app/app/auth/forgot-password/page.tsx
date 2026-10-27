"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import {
  buildPasswordResetRedirect,
  resolveResetRequestOutcome,
} from "@/lib/password-reset";

/**
 * Password reset request.
 *
 * The response is IDENTICAL whether or not the address has an account — see
 * `resolveResetRequestOutcome`, which collapses every non-rate-limit outcome to
 * one message so this page cannot become an account-existence oracle. Do not
 * "improve" this by surfacing `error.message`.
 *
 * The request runs through the browser client (as login and signup do) so the
 * PKCE code verifier is stored where the user's browser can reach it when they
 * click the emailed link. A server-side call would store the verifier
 * server-side and the click would fail to exchange.
 */
export default function ForgotPasswordPage() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<{ message: string } | null>(null);

  const appUrl =
    typeof window !== "undefined"
      ? (process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin)
      : process.env.NEXT_PUBLIC_APP_URL;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    let error: { status?: number; code?: string; message?: string } | null = null;
    try {
      const { error: authError } = await supabase.auth.resetPasswordForEmail(
        email,
        { redirectTo: buildPasswordResetRedirect(appUrl ?? "") }
      );
      error = authError;
    } catch (thrown) {
      // A transport failure is still an enumeration-safe outcome: say nothing
      // about the account.
      error = { message: thrown instanceof Error ? thrown.message : String(thrown) };
    }

    setLoading(false);
    setOutcome(resolveResetRequestOutcome(error));
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold text-white">Reset your password</h1>
        <p className="text-muted-foreground">
          Enter your email and we&apos;ll send you a link to set a new password.
        </p>
      </div>

      {outcome ? (
        <div
          className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {outcome.message}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Sending..." : "Send reset link"}
          </Button>
        </form>
      )}

      <p className="text-center text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link href="/auth/login" className="text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
