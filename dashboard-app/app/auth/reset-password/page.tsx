import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  PASSWORD_RESET_COOKIE,
  resetMarkerKey,
  verifyResetMarker,
} from "@/lib/password-reset-marker";
import { ResetPasswordForm } from "./reset-password-form";

/**
 * Set a new password.
 *
 * TWO conditions must hold, and the second is the fix for a real defect:
 *
 * 1. A session exists — a recovery link arrives here already signed in. Arriving
 *    without one (an expired or already-used link) sends the user back to sign-in
 *    rather than rendering a form that would fail on submit.
 * 2. That session carries the **recovery-intent marker** that `/auth/callback`
 *    sets when, and only when, it is following a password reset link.
 *
 * Condition 2 exists because a session alone is not evidence of a password reset.
 * Wallet sign-in mints an ordinary session through the project's passwordless
 * plumbing, and it was measured (2026-11-03) to be the same session *class* as a
 * recovery session — `amr=[{"method":"otp"}]` — with the password change accepted
 * by the provider even with production's password-change protections enabled. So
 * "is there a session?" let a held wallet key set an email password, turning the
 * wallet into a recovery credential. The provider cannot distinguish the two
 * classes; the intent marker can.
 *
 * This is a Server Component so both checks run server-side, but the check here is
 * a UX guard, NOT the enforcement: the Server Action re-verifies the marker before
 * touching the password, because a page-level check is bypassable by calling the
 * endpoint directly.
 */
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login?error=reset_required");
  }

  const cookieStore = await cookies();
  const marker = cookieStore.get(PASSWORD_RESET_COOKIE)?.value;
  if (!verifyResetMarker(marker, user.id, resetMarkerKey())) {
    // Deliberately the same destination and error code as "no session": this page
    // should not become an oracle for "was that a recovery session?".
    redirect("/auth/login?error=reset_required");
  }

  return <ResetPasswordForm email={user.email ?? ""} />;
}
