export const MAX_STRENGTHENED_DESCRIPTION_CHARACTERS = 5_000;
export const MAX_STRENGTHENED_DESCRIPTION_WORDS = 500;

export const ISSUE_TEMPLATE_SECTIONS = [
  "Summary",
  "Context and motivation",
  "Current behavior",
  "Desired behavior",
  "Acceptance criteria",
  "Relevant code",
  "Implementation considerations",
  "Testing requirements",
  "Open questions",
] as const;

export function issueTemplateOutline(): string {
  return ISSUE_TEMPLATE_SECTIONS.map((section) => `## ${section}`).join("\n");
}

export function validateStrengthenedDescription(description: string): void {
  if (description.length > MAX_STRENGTHENED_DESCRIPTION_CHARACTERS) {
    throw new Error(
      `The strengthened description must not exceed ${MAX_STRENGTHENED_DESCRIPTION_CHARACTERS} characters.`,
    );
  }
  const wordCount = description.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount > MAX_STRENGTHENED_DESCRIPTION_WORDS) {
    throw new Error(
      `The strengthened description must not exceed ${MAX_STRENGTHENED_DESCRIPTION_WORDS} words.`,
    );
  }

  const headings = [...description.matchAll(/^## ([^\n]+)$/gm)].map((match) => match[1]);
  if (
    headings.length !== ISSUE_TEMPLATE_SECTIONS.length ||
    headings.some((heading, index) => heading !== ISSUE_TEMPLATE_SECTIONS[index])
  ) {
    throw new Error(
      "The strengthened description must contain every required section exactly once and in order.",
    );
  }

  const acceptanceStart = description.indexOf("## Acceptance criteria");
  const relevantCodeStart = description.indexOf("## Relevant code");
  const acceptanceCriteria = description.slice(acceptanceStart, relevantCodeStart);
  if (!/^- \[ \] \S.+$/m.test(acceptanceCriteria)) {
    throw new Error("Acceptance criteria must contain at least one unchecked Markdown checkbox.");
  }
}
