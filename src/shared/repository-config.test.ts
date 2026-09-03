import { describe, expect, it } from "vitest";
import {
  parseRepository,
  parseTeamRepositoryMap,
  repositoryStateNamespace,
} from "./repository-config.ts";

describe("repository configuration", () => {
  it("parses trusted team-to-repository mappings", () => {
    const mapping = parseTeamRepositoryMap(
      JSON.stringify({
        "team-1": "acme/product",
        "team-2": ["acme/front", "acme/backend"],
      }),
    );
    expect(mapping.get("team-1")).toEqual([{ owner: "acme", repo: "product" }]);
    expect(mapping.get("team-2")).toEqual([
      { owner: "acme", repo: "front" },
      { owner: "acme", repo: "backend" },
    ]);
  });

  it("namespaces durable repository state by normalized repository identity", () => {
    expect(repositoryStateNamespace([{ owner: "Acme", repo: "Product" }])).toBe(
      "acme%2Fproduct",
    );
    expect(repositoryStateNamespace([{ owner: "Acme", repo: "Other" }])).not.toBe(
      repositoryStateNamespace([{ owner: "Acme", repo: "Product" }]),
    );
    expect(repositoryStateNamespace([])).toBe("unmapped");
  });

  it("returns an empty mapping when configuration is absent", () => {
    expect(parseTeamRepositoryMap(undefined).size).toBe(0);
  });

  it("rejects malformed JSON and repository identities", () => {
    expect(() => parseTeamRepositoryMap("not-json")).toThrow(/valid JSON/);
    expect(() => parseTeamRepositoryMap(JSON.stringify(["acme/product"]))).toThrow(
      /JSON object/,
    );
    expect(() => parseRepository("acme/product/other")).toThrow(/Invalid GitHub/);
    expect(() => parseRepository("https://github.com/acme/product")).toThrow(
      /Invalid GitHub/,
    );
  });
});
