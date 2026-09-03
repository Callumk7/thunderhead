import { describe, expect, it } from "vitest";
import { redactPotentialSecrets } from "./secret-redaction.ts";

describe("secret redaction", () => {
  it("redacts common committed credential formats before model exposure", () => {
    for (const content of [
      "const token = 'github_pat_abcdefghijklmnopqrstuvwxyz123456';",
      "api_key=abcdefghijklmnop",
      "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----",
      "-----BEGIN ENCRYPTED PRIVATE KEY-----\nabc123\n-----END ENCRYPTED PRIVATE KEY-----",
      "AKIAABCDEFGHIJKLMNOP",
    ]) {
      const result = redactPotentialSecrets(content);
      expect(result.redacted).toBe(true);
      expect(result.content).toContain("[REDACTED]");
    }
  });

  it("does not redact ordinary source text", () => {
    expect(redactPotentialSecrets("export function getTokenName() {}"))
      .toEqual({ content: "export function getTokenName() {}", redacted: false });
  });
});
