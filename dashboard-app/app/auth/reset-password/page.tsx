import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./reset-password-form";

/**
 * Set a new password.
 *
 * Requires the session established by `/auth/callback` exchanging the recovery
 * code — a recovery link arrives here already signed in. Arriving without a
 * session (an expired or already-used link) sends the user back to sign-in
 * rather than rendering a form that would fail on submit.
 *
 * This is a Server Component so the session check happens server-side; the form
 * itself is a client component because `updateUser` runs against the browser's
 * session cookies.
 */
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login?error=reset_required");
  }

  return <ResetPasswordForm email={user.email ?? ""} />;
}
