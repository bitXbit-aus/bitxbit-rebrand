/**
 * Normalise a Solana wallet's `signMessage` return value to raw bytes.
 *
 * WHY THIS EXISTS. Adapters are not uniform here. The wallet-standard
 * `signMessage` resolves to a `Uint8Array`, but some providers — notably several
 * Phantom versions — resolve to `{ signature: Uint8Array }` instead. Calling
 * `bs58.encode()` on that wrapper throws, and because it throws CLIENT-SIDE the
 * server never hears about it: the user sees a failure and the audit log stays
 * completely empty. That is precisely how an earlier failure of this exact kind
 * left no trace to diagnose.
 *
 * Deliberately dependency-free and client-safe (no `server-only` import, no
 * web3.js) so both the wallet page and the sign-in button can share one
 * implementation rather than each guessing at the shape.
 */
export function toSignatureBytes(result: unknown): Uint8Array {
  if (result instanceof Uint8Array) {
    return result;
  }

  if (result && typeof result === "object" && "signature" in result) {
    const inner = (result as { signature?: unknown }).signature;
    if (inner instanceof Uint8Array) {
      return inner;
    }
  }

  throw new Error("Wallet returned a signature in an unrecognised format.");
}
