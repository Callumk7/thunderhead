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
