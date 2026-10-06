import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalHash, canonicalJson } from "./canonical-json.js";

describe("canonical JSON", () => {
  it("recursively sorts object keys without changing array order", () => {
    expect(canonicalJson({ z: [3, 1, { b: 2, a: 1 }], a: true }))
      .toBe('{"a":true,"z":[3,1,{"a":1,"b":2}]}');
  });
  it("gives reordered object keys the same hash", () => {
    expect(canonicalHash({ b: { d: 4, c: 3 }, a: 1 }))
      .toBe(canonicalHash({ a: 1, b: { c: 3, d: 4 } }));
  });
  it("changes the hash when one monetary field changes", () => {
    expect(canonicalHash({ amountMinor: 10000 })).not.toBe(canonicalHash({ amountMinor: 10001 }));
  });
  it("hashes UTF-8 bytes with SHA-256", () => {
    const text = '{"name":"თბილისი"}';
    expect(canonicalHash({ name: "თბილისი" }))
      .toBe(createHash("sha256").update(text, "utf8").digest("hex"));
  });
  it("uses ECMAScript numeric serialization including negative zero", () => {
    expect(canonicalJson([333333333.3333333, 1e30, 4.5, 0.002, 1e-27, -0]))
      .toBe('[333333333.3333333,1e+30,4.5,0.002,1e-27,0]');
  });
  it("sorts keys by UTF-16 rather than locale or Unicode code points", () => {
    expect(canonicalJson({ "\ufffd": 2, "\ud83d\ude00": 1 }))
      .toBe('{"😀":1,"�":2}');
  });
  it("preserves Unicode normalization differences", () => {
    expect(canonicalHash({ text: "é" })).not.toBe(canonicalHash({ text: "e\u0301" }));
  });
  it("rejects lone surrogates in values and keys", () => {
    expect(() => canonicalJson({ text: "\ud800" })).toThrow("surrogate");
    expect(() => canonicalJson({ ["\udfff"]: 1 })).toThrow("surrogate");
  });
  it("rejects values that JSON would silently drop or coerce", () => {
    for (const value of [undefined, NaN, Infinity, 1n, new Date(), { x: undefined }]) {
      expect(() => canonicalJson(value)).toThrow();
    }
  });
  it("rejects cycles and sparse arrays", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => canonicalJson(cycle)).toThrow("Cyclic");
    expect(() => canonicalJson(new Array(2))).toThrow("Sparse");
  });
  it("allows repeated references that are not cycles", () => {
    const shared = { a: 1 };
    expect(canonicalJson([shared, shared])).toBe('[{"a":1},{"a":1}]');
  });
  it("rejects accessors without invoking them", () => {
    const value = Object.defineProperty({}, "x", { enumerable: true, get: () => { throw new Error("invoked"); } });
    expect(() => canonicalJson(value)).toThrow("accessors");
  });
  it("rejects excessive nesting", () => {
    let value: unknown = null;
    for (let i = 0; i < 70; i++) value = { value };
    expect(() => canonicalJson(value)).toThrow("complexity");
  });
  it("rejects array accessors without invoking them", () => {
    const value = Object.defineProperty([], "0", { get: () => { throw new Error("invoked"); } });
    expect(() => canonicalJson(value)).toThrow("accessors");
  });
});
