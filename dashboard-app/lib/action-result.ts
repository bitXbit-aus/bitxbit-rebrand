/**
 * Shared result contract between server actions and the admin UI.
 *
 * A server action can refuse to do something, or hit an expected failure the
 * operator needs to read, in two ways:
 *
 *   throw new Error(...)      -> HTTP 500, message REDACTED by Next.js in a
 *                               production build. The browser sees a generic
 *                               failure and the operator cannot tell a deliberate
 *                               safety gate from a server fault.
 *   return { error: "..." }   -> the text reaches the browser intact and the UI
 *                               presents it.
 *
 * The second form is required for conditions that are part of normal operation —
 * a validation refusal, or a safety guard holding a feature closed.
 *
 * Returning nothing (undefined) remains "success", which is what every action
 * in this codebase did before this contract existed, so adopting it is additive
 * rather than a breaking change.
 */
export type ActionResult = { error?: unknown; success?: boolean } | void

/**
 * Extract an operator-facing error from a server action's return value.
 * Returns null when the action succeeded, or returned nothing.
 */
export function actionError(result: unknown): string | null {
  if (
    result === null ||
    result === undefined ||
    typeof result !== "object" ||
    !("error" in result)
  ) {
    return null
  }
  const value = (result as { error?: unknown }).error
  if (!value) {
    return null
  }
  return String(value)
}
