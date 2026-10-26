"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { WalletSignInButton } from "@/components/auth/wallet-signin-button";
import Link from "next/link";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const supabase = createClient();

  // Surface the reason a redirect landed here rather than swallowing it. A
  // dropped recovery session is the common case: the user followed a reset link
  // that had already been used or expired.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("error");
    if (code === "reset_required") {
      setNotice(
        "That password reset link has expired or was already used. Request a new one below."
      );
    }
  }, []);

  const appUrl = typeof window !== "undefined"
    ? (process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin)
    : process.env.NEXT_PUBLIC_APP_URL;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Signed in", description: "Redirecting to dashboard..." });
      window.location.href = "/dashboard";
    }
  };

  const handleOAuth = async (provider: "google" | "github") => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${appUrl}/auth/callback`,
      },
    });
    setLoading(false);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold text-white">Welcome to bitXbit</h1>
        <p className="text-muted-foreground">Sign in to access the dashboard.</p>
      </div>

      {notice && (
        <div
          className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground"
          role="status"
        >
          {notice}
        </div>
      )}

      <form onSubmit={handleLogin} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              href="/auth/forgot-password"
              className="text-sm text-primary hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Signing in..." : "Sign in"}
        </Button>
      </form>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Button variant="outline" onClick={() => handleOAuth("google")} disabled={loading}>
          Google
        </Button>
        <Button variant="outline" onClick={() => handleOAuth("github")} disabled={loading}>
          GitHub
        </Button>
      </div>

      {/* Wallet sign-in is deliberately NOT part of the "Or continue with" group
          above. That group promises a method anyone can use, and this one is not:
          it works only for a member who has ALREADY linked and verified a wallet.
          Sitting there it read as "sign up with your wallet", which the link-only
          model does not support — so it gets its own labelled block and an explicit
          route for someone who arrives without an account.
          The wallet provider is mounted in the root layout, so none is needed here. */}
      <div className="space-y-3 rounded-lg border border-border p-4">
        <WalletSignInButton />
        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          Wallet sign-in is for existing members whose wallet is already linked and
          verified. There is no wallet-only sign-up:{" "}
          <Link href="/auth/signup" className="text-primary hover:underline">
            create an account with email
          </Link>{" "}
          first, then link your wallet from Dashboard → Wallet.
        </p>
      </div>

      <p className="text-center text-sm text-muted-foreground">
        No account?{" "}
        <Link href="/auth/signup" className="text-primary hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
