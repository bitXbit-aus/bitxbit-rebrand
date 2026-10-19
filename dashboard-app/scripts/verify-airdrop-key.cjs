#!/usr/bin/env node
/**
 * Verify that an airdrop private key derives to the expected wallet address.
 *
 * Prints only the derived ADDRESS. The key is never echoed and never leaves this
 * process. Read the key from stdin (or AIRDROP_KEY) rather than argv, so it does
 * not land in shell history, and so shell globbing cannot mangle it.
 *
 * Usage — expected address as the argument, key on stdin:
 *
 *   printf '%s' '<private key>' | node scripts/verify-airdrop-key.cjs <expected-address>
 *
 * or interactively (paste the key, then Ctrl-D):
 *
 *   node scripts/verify-airdrop-key.cjs <expected-address>
 *
 * or via env var:
 *
 *   AIRDROP_KEY='<private key>' node scripts/verify-airdrop-key.cjs <expected-address>
 *
 * Accepts, because key material arrives in several shapes in practice:
 *   - base58 secret key (what this app expects in AIRDROP_WALLET_PRIVATE_KEY)
 *   - a JSON array of 64 byte values (what `solana-keygen` writes to id.json)
 *   - 128 hex characters
 *
 * Understands two failure modes well enough to name them:
 *   - a Netlify secret MASK (e.g. ****************3NuP) — the real value is not
 *     readable from the UI, CLI or API once a variable is flagged secret
 *   - the PUBLIC key (address) being supplied instead of the secret
 */

const { Keypair } = require("@solana/web3.js");

let bs58;
try {
  bs58 = require("bs58");
  bs58 = bs58.default || bs58;
} catch {
  console.error("Could not load bs58. Run this from dashboard-app (npm ci first).");
  process.exit(2);
}

const expected = process.argv[2];
if (!expected) {
  console.error("Usage: node scripts/verify-airdrop-key.cjs <expected-address>  (key on stdin)");
  process.exit(2);
}

function readStdin() {
  try {
    if (process.env.AIRDROP_KEY) return process.env.AIRDROP_KEY;
    if (process.stdin.isTTY) return "";
    return require("fs").readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function fail(message, hint) {
  console.error("");
  console.error("  ✗ " + message);
  if (hint) console.error("    " + hint);
  console.error("");
  process.exit(1);
}

const raw = readStdin();
if (!raw || !raw.trim()) {
  fail(
    "No key received on stdin.",
    "Pipe the key in, or set AIRDROP_KEY. If you ran the old one-liner and got " +
      "'Non-base58 character', the pasted value probably was not the key itself — run this script instead."
  );
}

// Normalise: trim, drop surrounding quotes, remove ALL internal whitespace/newlines.
let value = raw.trim().replace(/^["']|["']$/g, "").trim();
value = value.replace(/\s+/g, "");

if (!value) {
  fail("The value received was empty after trimming.");
}

// Netlify secret mask — the single most likely cause of a confusing failure now
// that AIRDROP_WALLET_PRIVATE_KEY is flagged secret.
if (/^\*+/.test(value) || /^•+/.test(value) || /redacted/i.test(value)) {
  fail(
    "That is a masked value, not a key.",
    "Netlify does not return the real value once a variable is flagged secret — in the UI, CLI or API. " +
      "Use the key as generated. The mask's last 4 characters are all that are visible."
  );
}

// Public key (address) supplied by mistake — 32 bytes, so 43-44 base58 chars.
if (/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(value)) {
  let isAddress = false;
  try {
    const { PublicKey } = require("@solana/web3.js");
    new PublicKey(value);
    isAddress = true;
  } catch {
    isAddress = false;
  }
  if (isAddress) {
    fail(
      "That is a PUBLIC key (an address), not a secret key.",
      "An address is safe to share but cannot sign. You need the 64-byte secret key."
    );
  }
}

// Resolve to 64 secret-key bytes.
let secretBytes;
try {
  if (value.startsWith("[")) {
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch {
      fail(
        "That looks like a JSON array (solana-keygen id.json) but it does not parse.",
        "Copy the whole file contents, including the closing bracket."
      );
    }
    if (!Array.isArray(parsed) || parsed.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      fail("The JSON array is not 64 byte values (0-255).");
    }
    secretBytes = Uint8Array.from(parsed);
  } else if (/^[0-9a-fA-F]{128}$/.test(value)) {
    secretBytes = Uint8Array.from(Buffer.from(value, "hex"));
  } else {
    secretBytes = bs58.decode(value);
  }
} catch (error) {
  const message = String(error && error.message ? error.message : error);
  fail(
    "Could not decode that value: " + message,
    /non-base58/i.test(message)
      ? "The value contains characters that are not in the base58 alphabet. This usually means it is not " +
        "the raw key — check for copied whitespace, quotes, a mask, or a placeholder."
      : undefined
  );
}

if (secretBytes.length !== 64) {
  fail(
    "Decoded to " + secretBytes.length + " bytes; a Solana secret key must be exactly 64.",
    secretBytes.length === 32
      ? "32 bytes is a SEED, not a full secret key. Derive the keypair from the seed first."
      : undefined
  );
}

let derived;
try {
  derived = Keypair.fromSecretKey(secretBytes).publicKey.toBase58();
} catch (error) {
  fail("Decoded 64 bytes but Solana rejected them: " + (error && error.message ? error.message : error));
}

console.log("");
console.log("  derived address : " + derived);
console.log("  expected        : " + expected);
console.log("  MATCH           : " + (derived === expected ? "YES ✅" : "NO ❌"));
console.log("");
process.exit(derived === expected ? 0 : 1);
