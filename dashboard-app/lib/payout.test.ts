import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { amountToRaw, parseRawTokenAmount, rawToAmount } from "./payout";

describe("payout token unit conversion", () => {
  it("converts display amount to raw integer using configured decimals", () => {
    assert.equal(amountToRaw(1.5, 9), 1500000000n);
    assert.equal(amountToRaw(0.001, 9), 1000000n);
    assert.equal(amountToRaw(1, 6), 1000000n);
  });

  it("converts raw integer back to display amount", () => {
    assert.equal(rawToAmount(1500000000n, 9), 1.5);
    assert.equal(rawToAmount(1000000n, 9), 0.001);
    assert.equal(rawToAmount(1000000n, 6), 1);
  });

  it("round-trips small fractional amounts", () => {
    const display = 0.000000123;
    const raw = amountToRaw(display, 9);
    assert.equal(raw, 123n);
    assert.equal(rawToAmount(raw, 9), display);
  });

  it("parses exact raw amounts without a JavaScript number boundary", () => {
    assert.equal(parseRawTokenAmount("1500000"), 1500000n);
    assert.equal(parseRawTokenAmount("9007199254740993"), 9007199254740993n);
  });

  it("rejects numbers and non-canonical raw amount strings", () => {
    assert.throws(() => parseRawTokenAmount(1500000));
    assert.throws(() => parseRawTokenAmount("01"));
    assert.throws(() => parseRawTokenAmount("1.5"));
    assert.throws(() => parseRawTokenAmount("-1"));
  });

  it("uses 9 decimals by default", () => {
    assert.equal(amountToRaw(1), 1000000000n);
    assert.equal(rawToAmount(1000000000n), 1);
  });
});
