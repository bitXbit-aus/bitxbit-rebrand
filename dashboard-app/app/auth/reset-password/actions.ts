"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  PASSWORD_RESET_COOKIE,
  RESET_PASSWORD_PATH,
  resetMarkerKey,
  verifyResetMarker,
} from "@/lib/password-reset-marker";
import { validateNewPassword, RESET_NOT_AUTHORISED_MESSAGE } from "@/lib/password-reset";
import type { ResetPasswordState } from "@/lib/password-reset";

/**
 * The password change, server-side.
 *
 * Why a Server Action rather than the browser client the form used to use: the
 * guard has to be somewhere the caller cannot skip. A check that lives in the page
 * or the client component only decides whether to *render* a form — anyone holding
 * a session can post to `PUT /auth/v1/user` directly, which is exactly what the
 * measured probe did. So the marker is verified here, on the server, immediately
 * before the password is changed.
 *
 * The two checks the page also performs are repeated rather than trusted: this
 * action is its own entry point.
 *
 * This module may export ONLY the async action — a `"use server"` file cannot
 * export a constant or a type without failing the build, which is why the refusal
 * copy and the state shape live in `lib/password-reset.ts`.
 */
export async function resetPassword(
  _previous: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login?error=reset_required");
  }

  // ENFORCEMENT. A wallet session — or any session that did not arrive through a
  // reset link — stops here, before any password is touched.
  const cookieStore = await cookies();
  const marker = cookieStore.get(PASSWORD_RESET_COOKIE)?.value;
  if (!verifyResetMarker(marker, user.id, resetMarkerKey())) {
    return { error: RESET_NOT_AUTHORISED_MESSAGE };
  }

  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");

  const localError = validateNewPassword(password, confirmation);
  if (localError) {
    return { error: localError };
  }

  // Acts on the CURRENT session, so it can only ever change the signed-in user's
  // own password.
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return { error: error.message };
  }

  // Single-use: the marker authorised one password change, and it is spent.
  // The path must match the one the cookie was written with, or this deletes
  // nothing — a cookie scoped to /auth/reset-password is not removed by a delete
  // aimed at "/".
  cookieStore.delete({ name: PASSWORD_RESET_COOKIE, path: RESET_PASSWORD_PATH });

  redirect("/dashboard");
}
