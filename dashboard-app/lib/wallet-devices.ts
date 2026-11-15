/**
 * Recognised wallet devices — the pure half (R-021, D5).
 *
 * Design: `docs/security/wallet-step-up-design.md` §3.4 (revocation and visibility).
 * Persistence: migration 029.
 *
 * ## Why this module exists
 *
 * The step-up gate (Part 1) mints a session on a device the account has already
 * proved itself on, and the R-021 detection alert tells a member to *remove* a
 * device that was not them. Until the member-facing list and revoke exist, that
 * instruction has nothing to point at — the only lever is "unlink your wallet",
 * which is a far bigger action than removing one device.
 *
 * ## Kept pure on purpose
 *
 * No `next/*`, no `server-only`, no database. The shapes and the one decision that
 * matters — is this a device handle we are willing to pass to a revoke RPC? — are
 * value transformations, so they are unit-testable and cannot hide behind a
 * framework import. `lib/actions.ts` (a `"use server"` module, which may export
 * only async functions) imports the types and helpers from here.
 */

/** Mirrors `complete_wallet_stepup` / `revoke_wallet_device` expectations. */
export interface WalletDeviceSummary {
  /** SHA-256 hex of the device cookie (see `hashDeviceId`). Opaque; carries no identity. */
  deviceHash: string;
  label: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  lastIp: string | null;
  /** Non-null means revoked — a state, never a delete (migration 029). */
  revokedAt: string | null;
}

export interface WalletDeviceList {
  devices: WalletDeviceSummary[];
  /**
   * The hash of the device making this request, so the UI can mark "this device".
   * `null` when the browser presents no handle. It is the member's OWN device, read
   * from their own session cookie — never another account's.
   */
  currentDeviceHash: string | null;
}

/** The row shape returned by the `wallet_trusted_devices` select. */
export interface WalletDeviceRow {
  device_hash: string;
  label: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  last_ip: string | null;
  revoked_at: string | null;
}

/**
 * `device_hash` is a SHA-256 hex digest — 64 lowercase hex characters
 * (`lib/wallet-stepup.ts` `hashDeviceId`). Pinned here as a pattern so a revoke
 * caller is validated before it reaches an RPC, and so a malformed value is a cheap
 * refusal rather than a parameter exception.
 */
export const DEVICE_HASH_PATTERN = /^[0-9a-f]{64}$/;

/** True only for a well-formed, lowercase device digest. */
export function isDeviceHash(value: unknown): value is string {
  return typeof value === "string" && DEVICE_HASH_PATTERN.test(value);
}

/**
 * Validates a caller-supplied device hash and returns it in canonical form, or
 * `null` for anything that is not a digest.
 *
 * The device hash arrives from the client (it is the identifier of the row to
 * revoke), so it is untrusted input. Normalising the case is safe — hex is
 * case-insensitive and the digest is always emitted lowercase — and it means a
 * caller cannot miss its own device by sending uppercase.
 *
 * NOTE: this validates the *shape*. It is NOT the authorization boundary: a
 * well-formed hash for another member's device is still rejected, because the
 * revoke RPC is scoped by the account id taken from the **session**, never from
 * this value.
 */
export function normaliseDeviceHash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return DEVICE_HASH_PATTERN.test(trimmed) ? trimmed : null;
}

/** Maps a database row to the shape the action returns. Nulls are preserved. */
export function toDeviceSummary(row: WalletDeviceRow): WalletDeviceSummary {
  return {
    deviceHash: row.device_hash,
    label: row.label ?? null,
    firstSeenAt: row.first_seen_at ?? null,
    lastSeenAt: row.last_seen_at ?? null,
    lastIp: row.last_ip ?? null,
    revokedAt: row.revoked_at ?? null,
  };
}
