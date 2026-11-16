/**
 * Device-bound key — the BROWSER half of the closure of R-021 (design §4).
 *
 * Server counterpart: `lib/wallet-device-key.ts`. Design:
 * `docs/security/wallet-step-up-design.md` §4.
 *
 * ## What this guarantees
 *
 * The private key is generated with `extractable: false` and lives in IndexedDB.
 * It can be *used* by this origin's JavaScript and cannot be *read* by any script,
 * ours included. That is the whole point: there is no form the member can read out,
 * paste, or type — so when a victim is talked into relaying a signature AND the
 * emailed code, there is no longer a second thing they are able to give away.
 *
 * ## The measured detail behind `extractable: false`
 *
 * The design's approach was believed unimplementable — the reasoning being that a
 * non-extractable keypair's public half could not be exported either, so the public
 * JWK could never be registered. **Measured in Node: that reasoning is wrong.**
 * A keypair generated with `extractable: false` reports
 * `publicKey.extractable === true` and its public JWK exports normally. The design
 * therefore works as written, and `enrolDeviceKey` follows it.
 *
 * `nonExtractablePrivateKey` below is the fallback for an engine that *does* refuse,
 * and its behaviour is measured too: the re-imported key reports
 * `extractable === false`, `exportKey` on it throws `InvalidAccessException`, and it
 * still signs. It is a fallback, not the primary path — recorded so nobody
 * re-derives a fix for a non-problem.
 *
 * ## Degrade, never throw
 *
 * Every entry point returns `null` rather than throwing. A browser with no
 * IndexedDB (private mode, locked-down profile, an embedded webview) simply cannot
 * enrol a device key: the sign-in still works and that device drafts a step-up
 * again next time. `null` is a legitimate answer here, not an error.
 *
 * Browser-only module: it must never be imported by a Server Component or a route.
 */

/** WebCrypto algorithm. P-256 because it is universally available and Node verifies it. */
const ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;

const DB_NAME = "bx-wallet-device-key";
const DB_VERSION = 1;
const STORE = "keys";
const KEY_ID = "device-key";

/** True when this browser can hold a device key at all. */
export function deviceKeySupported(): boolean {
  return (
    typeof indexedDB !== "undefined" &&
    typeof crypto !== "undefined" &&
    typeof crypto.subtle !== "undefined"
  );
}

/** base64url with no padding — matches `newDeviceId()`'s style on the server. */
function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (!deviceKeySupported()) {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    // Blocked (another tab holds an old version) or a hard failure: no keyring.
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest
): Promise<T | null> {
  return new Promise((resolve) => {
    openDatabase().then((db) => {
      if (!db) {
        resolve(null);
        return;
      }
      let request: IDBRequest;
      try {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        request = run(store);
        tx.onabort = () => resolve(null);
      } catch {
        db.close();
        resolve(null);
        return;
      }
      request.onsuccess = () => {
        const result = request.result as T;
        db.close();
        resolve(result ?? null);
      };
      request.onerror = () => {
        db.close();
        resolve(null);
      };
    });
  });
}

/**
 * Re-imports a private JWK as a NON-EXTRACTABLE key.
 *
 * Fallback path only. The exported private JWK exists transiently in memory and is
 * never persisted — what is stored is the re-imported, non-exportable handle.
 */
async function nonExtractablePrivateKey(privateJwk: JsonWebKey): Promise<CryptoKey | null> {
  try {
    return await crypto.subtle.importKey("jwk", privateJwk, ALGORITHM, false, ["sign"]);
  } catch {
    return null;
  }
}

/**
 * Enrols this browser: generates a device key and registers nothing (the caller
 * sends the returned public JWK to the step-up completion).
 *
 * Returns the **public** JWK as a compact JSON string — `{kty, crv, x, y}` — or
 * `null` when this browser cannot hold a key. The returned shape is exactly what
 * `parseDevicePublicKey` on the server accepts.
 */
export async function enrolDeviceKey(): Promise<string | null> {
  if (!deviceKeySupported()) return null;

  try {
    // 1. Generate non-extractable, per design §4.
    let pair: CryptoKeyPair;
    let privateKey: CryptoKey;
    try {
      pair = await crypto.subtle.generateKey(ALGORITHM, false, ["sign", "verify"]);
      privateKey = pair.privateKey;
    } catch {
      return null;
    }

    // 2. Export the public half. Measured: this succeeds even though the keypair was
    //    generated non-extractable. If an engine refuses, fall back to generating an
    //    extractable pair and persisting only a re-imported non-extractable private key.
    let publicJwk: JsonWebKey;
    try {
      publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    } catch {
      const fallback = await (async () => {
        try {
          const extractable = await crypto.subtle.generateKey(ALGORITHM, true, ["sign", "verify"]);
          const exported = await crypto.subtle.exportKey("jwk", extractable.privateKey);
          const reimported = await nonExtractablePrivateKey(exported);
          if (!reimported) return null;
          const publicExported = await crypto.subtle.exportKey("jwk", extractable.publicKey);
          return { privateKey: reimported, publicJwk: publicExported };
        } catch {
          return null;
        }
      })();
      if (!fallback) return null;
      privateKey = fallback.privateKey;
      publicJwk = fallback.publicJwk;
    }

    if (typeof publicJwk.x !== "string" || typeof publicJwk.y !== "string") return null;

    // 3. Persist the key handle. Storing the CryptoKey (structured clone) keeps the
    //    non-extractable property; storing a JWK would not.
    const stored = await withStore<IDBValidKey>("readwrite", (store) =>
      store.put(privateKey, KEY_ID) as unknown as IDBRequest
    );
    if (stored === null) return null;

    return JSON.stringify({
      kty: "EC",
      crv: "P-256",
      x: publicJwk.x,
      y: publicJwk.y,
    });
  } catch {
    return null;
  }
}

/** True when this browser already holds a usable device key. */
export async function hasDeviceKey(): Promise<boolean> {
  const key = await withStore<CryptoKey>("readonly", (store) => store.get(KEY_ID) as unknown as IDBRequest);
  return Boolean(key);
}

/**
 * Signs the server's challenge nonce with the stored device key.
 *
 * Returns base64url of WebCrypto's raw `r || s` (64 bytes for P-256) — the exact
 * form `verifyDeviceSignature` expects. Returns `null` when there is no key, which
 * the caller must treat as "this device cannot sign", NOT as a failure: the server
 * will ask for a step-up, which is the correct outcome for an unenrolled device.
 */
export async function signWithDeviceKey(nonce: string): Promise<string | null> {
  if (!nonce) return null;
  const key = await withStore<CryptoKey>("readonly", (store) => store.get(KEY_ID) as unknown as IDBRequest);
  if (!key) return null;
  try {
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(nonce)
    );
    return toBase64Url(signature);
  } catch {
    return null;
  }
}

/**
 * Drops this browser's device key.
 *
 * Used when the server reports the stored key no longer verifies, so the next
 * step-up enrols a fresh one instead of the browser presenting a key that can never
 * work. Note the asymmetry with the server: the server-side row is revoked as a
 * *state* (migration 029), while this is local material with no history to keep.
 */
export async function clearDeviceKey(): Promise<void> {
  await withStore<undefined>("readwrite", (store) => store.delete(KEY_ID) as unknown as IDBRequest);
}
