import { describe, expect, it } from "vitest";
import {
  isAllowedPath,
  normalizeAndValidatePath,
  repositoryReadTools,
  validateSearchQuery,
} from "./repository-read.ts";

describe("repository read boundaries", () => {
  it("normalizes ordinary repository paths", () => {
    expect(normalizeAndValidatePath("./src/app.ts")).toBe("src/app.ts");
    expect(normalizeAndValidatePath("")).toBe("");
  });

  it("rejects traversal, absolute paths, and secret-bearing paths", () => {
    for (const path of [
      "../outside",
      "/etc/passwd",
      "src\\app.ts",
      ".env",
      "config/.env.production",
      "certs/private.key",
      ".ssh/config",
      "config/api-secrets.json",
      ".docker/config.json",
      ".kube/config",
      "keys/id_rsa",
      "config/service-account.json",
    ]) {
      expect(() => normalizeAndValidatePath(path)).toThrow(/allowed read boundary/);
    }
  });

  it("allows normal source and documentation files", () => {
    expect(isAllowedPath("src/auth/token.ts")).toBe(true);
    expect(isAllowedPath("docs/security.md")).toBe(true);
  });

  it("requires a path to be discovered before a file read", async () => {
    const tools = repositoryReadTools(
      [{ owner: "acme", repo: "product" }],
      {
        discoveredPaths: [],
        recordDiscovered: () => undefined,
        recordSuccess: () => undefined,
        recordFailure: () => undefined,
      },
    );
    await expect(
      tools[2].run({
        data: { repository: "acme/product", path: "src/app.ts" },
      } as never),
    ).rejects.toThrow(/List or search/);
  });

  it("prevents GitHub search qualifier injection", () => {
    expect(validateSearchQuery("IssueStrengthener")).toBe("IssueStrengthener");
    for (const query of ["repo:other/project", 'name \"quoted\"', "foo OR bar", "a\nrepo:x/y"]) {
      expect(() => validateSearchQuery(query)).toThrow(/literal search term/);
    }
  });
});
