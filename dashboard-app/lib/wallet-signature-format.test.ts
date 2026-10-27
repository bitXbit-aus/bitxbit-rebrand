import { describe, it } from "node:test";
import assert from "node:assert";
import { toSignatureBytes } from "./wallet-signature-format";

describe("wallet signature format normalisation", () => {
  it("passes through a raw Uint8Array (wallet-standard shape)", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    assert.strictEqual(toSignatureBytes(bytes), bytes);
  });

  it("unwraps a { signature } wrapper (some Phantom versions)", () => {
    const bytes = new Uint8Array([4, 5, 6]);
    assert.strictEqual(toSignatureBytes({ signature: bytes }), bytes);
  });

  it("rejects anything it cannot read, rather than encoding garbage", () => {
    // The failure this guards: bs58.encode() on a wrapper throws client-side, so
    // the server never learns the attempt happened. Failing here with a clear
    // message is what makes the next occurrence diagnosable.
    assert.throws(() => toSignatureBytes(undefined), /unrecognised format/);
    assert.throws(() => toSignatureBytes(null), /unrecognised format/);
    assert.throws(() => toSignatureBytes("0xdeadbeef"), /unrecognised format/);
    assert.throws(() => toSignatureBytes({ signature: "not-bytes" }), /unrecognised format/);
    assert.throws(() => toSignatureBytes({ sig: bytes() }), /unrecognised format/);
  });

  it("does not accept an ArrayBuffer masquerading as bytes", () => {
    // An ArrayBuffer is tempting to accept, but bs58.encode would silently treat
    // it differently from a Uint8Array — better to refuse than to encode wrongly.
    assert.throws(() => toSignatureBytes(new ArrayBuffer(8)), /unrecognised format/);
  });
});

function bytes() {
  return new Uint8Array([7, 8, 9]);
}
