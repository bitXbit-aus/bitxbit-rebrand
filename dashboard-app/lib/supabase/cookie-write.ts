/**
 * Next.js deliberately makes the request cookie store read-only while rendering
 * Server Components. Supabase may still try to refresh a session in that context;
 * middleware is responsible for persisting the refresh, so this one exact failure
 * is expected. Every other cookie-write error must propagate: in a Route Handler
 * or Server Action, swallowing it can report a successful sign-in without a
 * session cookie.
 */
export function isReadOnlyServerComponentCookieError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  return (
    error.name === "ReadonlyRequestCookiesError" ||
    error.message.includes("Cookies can only be modified in a Server Action or Route Handler")
  );
}

export function handleServerCookieWriteError(error: unknown): void {
  if (isReadOnlyServerComponentCookieError(error)) return;
  throw error;
}