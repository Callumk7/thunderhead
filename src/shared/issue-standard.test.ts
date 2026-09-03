import { describe, expect, it } from "vitest";
import {
  ISSUE_TEMPLATE_SECTIONS,
  MAX_STRENGTHENED_DESCRIPTION_CHARACTERS,
  MAX_STRENGTHENED_DESCRIPTION_WORDS,
  issueTemplateOutline,
  validateStrengthenedDescription,
} from "./issue-standard.ts";

describe("issue standard", () => {
  it("emits every required section once and in order", () => {
    const outline = issueTemplateOutline();
    expect(ISSUE_TEMPLATE_SECTIONS).toHaveLength(9);
    expect(outline.split("\n")).toEqual(
      ISSUE_TEMPLATE_SECTIONS.map((section) => `## ${section}`),
    );
  });

  it("rejects descriptions that exceed the compactness limits", () => {
    expect(() =>
      validateStrengthenedDescription(
        "x".repeat(MAX_STRENGTHENED_DESCRIPTION_CHARACTERS + 1),
      ),
    ).toThrow(/characters/);
    expect(() =>
      validateStrengthenedDescription(
        `${"word ".repeat(MAX_STRENGTHENED_DESCRIPTION_WORDS + 1)}\n${issueTemplateOutline()}`,
      ),
    ).toThrow(/words/);
  });

  it("rejects missing/reordered sections and missing acceptance checkboxes", () => {
    expect(() => validateStrengthenedDescription("## Summary\nOnly one section")).toThrow(
      /required section/,
    );
    expect(() =>
      validateStrengthenedDescription(`${issueTemplateOutline()}\nNo checkbox`),
    ).toThrow(/checkbox/);
  });
});
