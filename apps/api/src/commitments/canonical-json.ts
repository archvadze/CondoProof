import { createHash } from "node:crypto";

export const CANONICALIZATION = "condoproof-jcs-v1";

function validateUnicode(value: string): void {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error("Lone Unicode surrogate");
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error("Lone Unicode surrogate");
    }
  }
}

export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  let nodes = 0;
  function serialize(input: unknown, depth: number): string {
    if (depth > 64 || ++nodes > 50000) throw new Error("Canonical JSON complexity limit exceeded");
    if (input === null) return "null";
    if (typeof input === "string") {
      validateUnicode(input);
      return JSON.stringify(input);
    }
    if (typeof input === "boolean") return input ? "true" : "false";
    if (typeof input === "number") {
      if (!Number.isFinite(input)) throw new Error("Non-finite number");
      return JSON.stringify(input);
    }
    if (typeof input !== "object") throw new Error("Unsupported JSON value");
    if (ancestors.has(input)) throw new Error("Cyclic JSON value");
    ancestors.add(input);
    try {
      if (Array.isArray(input)) {
        const items: string[] = [];
        for (let i = 0; i < input.length; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(input, String(i));
          if (!descriptor) throw new Error("Sparse arrays are unsupported");
          if (!Object.hasOwn(descriptor, "value")) throw new Error("JSON accessors are unsupported");
          items.push(serialize(descriptor.value, depth + 1));
        }
        return `[${items.join(",")}]`;
      }
      const prototype = Object.getPrototypeOf(input);
      if (prototype !== Object.prototype && prototype !== null) throw new Error("JSON object must be plain");
      if (Object.getOwnPropertySymbols(input).length > 0) throw new Error("Symbol keys are unsupported");
      const descriptors = Object.getOwnPropertyDescriptors(input);
      const fields: string[] = [];
      // Default JS sort compares UTF-16 code units, as required by JCS.
      for (const key of Object.keys(input).sort()) {
        validateUnicode(key);
        const descriptor = descriptors[key]!;
        if (!Object.hasOwn(descriptor, "value")) throw new Error("JSON accessors are unsupported");
        fields.push(`${JSON.stringify(key)}:${serialize(descriptor.value, depth + 1)}`);
      }
      return `{${fields.join(",")}}`;
    } finally {
      ancestors.delete(input);
    }
  }
  return serialize(value, 0);
}

export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
