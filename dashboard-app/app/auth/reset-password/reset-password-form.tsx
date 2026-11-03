"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MIN_PASSWORD_LENGTH, type ResetPasswordState } from "@/lib/password-reset";
import { resetPassword } from "./actions";

/**
 * Set-new-password form.
 *
 * The password change runs in a **Server Action**, not here. It used to call
 * `supabase.auth.updateUser` from the browser, which meant the only thing between a
 * wallet session and a new email password was a page check — and a page check is
 * bypassable by posting to the auth endpoint directly, which is exactly what the
 * exploit probe did. The action verifies the recovery-intent marker server-side
 * before changing anything, so this component decides only what to *show*.
 */
export function ResetPasswordForm({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState<ResetPasswordState, FormData>(
    resetPassword,
    { error: null }
  );

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

      <form action={formAction} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="••••••••"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm-password">Confirm new password</Label>
          <Input
            id="confirm-password"
            name="confirmation"
            type="password"
            placeholder="••••••••"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
        </div>

        {state.error && (
          <p className="text-sm text-destructive" role="alert">
            {state.error}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Updating..." : "Update password"}
        </Button>
      </form>
    </div>
  );
}
