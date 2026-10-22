/**
 * R-006 — the asset-upload boundary, in one place.
 *
 * ## Why this module exists
 *
 * The boundary was implicit and incoherent. `lib/storage.ts` declared a 5 MB
 * ceiling, but the transport below it enforced something else entirely, and the
 * two disagreed.
 *
 * **Measured 2026-10-22** (local production build, Next 14.2.35, temporary probe):
 * Next's Server Action `bodySizeLimit` **does not bound file uploads at all**. It
 * is passed to busboy as `fieldSize`, which applies to *non-file* fields, and the
 * plain-form multipart path does not apply it at all — a **5 MB** file was
 * received intact with the 1 MB default in force. Only the non-multipart (JSON)
 * action path enforces `bodySizeLimit`, and it fails with an internal 413 that the
 * browser sees as an opaque 500.
 *
 * So this app-level check is the **only** guard on upload size. It must therefore
 * be both *reachable* and *legible*, which is why it sits below the platform
 * ceiling rather than above it:
 *
 * ```
 * platform   Netlify buffered request payload 6 MB; binary payloads are
 *            base64-encoded (~30% overhead), so the effective binary ceiling is
 *            ~4.5 MB.  DOCUMENTED, NOT MEASURED — confirm in a deployed probe.
 * app        3 MB.  Below that ceiling with headroom for the multipart envelope
 *            and the remaining form fields, so the operator reads a message
 *            instead of a platform rejection.
 * ```
 *
 * The previous 5 MB sat **above** the platform ceiling, so for a file in that band
 * the legible refusal could never fire — the platform rejected first.
 *
 * ## Client-safe on purpose
 *
 * Pure module, no server-only imports, so `components/admin/image-upload-field.tsx`
 * applies the *same* rule and can tell the operator before the upload starts.
 * The server check remains authoritative: a client check is a courtesy, never a
 * control.
 */

/** 3 MB. See the platform/app budget above before changing this. */
export const MAX_ASSET_BYTES = 3 * 1024 * 1024;

export const ALLOWED_ASSET_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
] as const;

/** For an `<input type="file" accept=...>` attribute. */
export const ASSET_ACCEPT_ATTRIBUTE = ALLOWED_ASSET_TYPES.join(",");

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

/** The parts of a `File` this policy needs — kept structural so it is testable. */
export interface AssetCandidate {
  size: number;
  type: string;
}

export type AssetValidation = { ok: true } | { ok: false; error: string };

/**
 * Validate one candidate upload. Returns a legible, operator-facing message on
 * refusal — never throws, so the caller can return it to the UI intact.
 */
export function validateAsset(candidate: AssetCandidate | null | undefined): AssetValidation {
  if (
    !candidate ||
    typeof candidate.size !== "number" ||
    // NaN and Infinity are `typeof "number"` and pass both comparisons below, so
    // they must be rejected explicitly — a non-finite size is not a size.
    !Number.isFinite(candidate.size) ||
    candidate.size <= 0
  ) {
    return { ok: false, error: "No file provided" };
  }

  if (candidate.size > MAX_ASSET_BYTES) {
    return {
      ok: false,
      error: `File must be smaller than ${formatBytes(MAX_ASSET_BYTES)}. This file is ${formatBytes(candidate.size)}.`,
    };
  }

  if (!(ALLOWED_ASSET_TYPES as readonly string[]).includes(candidate.type)) {
    return { ok: false, error: `File type not allowed: ${candidate.type}` };
  }

  return { ok: true };
}