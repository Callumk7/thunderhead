"use agent";
import {
  useAgentFinish,
  useDelivery,
  useInitialData,
  useModel,
  usePersistentState,
  useTool,
} from "@flue/runtime";
import * as v from "valibot";
import { issueTemplateOutline } from "../shared/issue-standard.ts";
import {
  repositoriesForTeam,
  repositoryIdentity,
  repositoryStateNamespace,
} from "../shared/repository-config.ts";
import {
  linearIssueTools,
  type LinearTerminalStatus,
} from "../tools/linear-issue.ts";
import { repositoryReadTools } from "../tools/repository-read.ts";

const initialDataSchema = v.object({
  issueId: v.string(),
});

export function IssueStrengthener() {
  useModel("openrouter/~google/gemini-flash-latest");

  const initialData = useInitialData<v.InferOutput<typeof initialDataSchema>>();
  if (!initialData) {
    throw new Error("IssueStrengthener must be created by the Linear channel.");
  }

  const delivery = useDelivery();
  const attributes = delivery.kind === "signal" ? delivery.attributes : undefined;
  const teamId = stringAttribute(attributes?.teamId);
  const deliveryId = stringAttribute(attributes?.deliveryId);
  const triggerLabelId = stringAttribute(attributes?.triggerLabelId);
  if (!teamId || !deliveryId || !triggerLabelId) {
    throw new Error(
      "The Linear trigger is missing its trusted team, delivery, or trigger-label ID.",
    );
  }

  const repositories = repositoriesForTeam(teamId);
  const repositoryNames = repositories.map(repositoryIdentity);
  const repositoryStateKey = repositoryStateNamespace(repositories);
  const [conflictCount, setConflictCount] = usePersistentState(
    `linear-conflicts:${deliveryId}`,
    0,
  );
  const [inspectedRepositories, setInspectedRepositories] = usePersistentState<
    string[]
  >(`linear-inspected-repositories:${deliveryId}:${repositoryStateKey}`, []);
  const [repositoryFailed, setRepositoryFailed] = usePersistentState(
    `linear-repository-failed:${deliveryId}:${repositoryStateKey}`,
    false,
  );
  const [discoveredPaths, setDiscoveredPaths] = usePersistentState<string[]>(
    `linear-repository-paths:${deliveryId}:${repositoryStateKey}`,
    [],
  );
  const [terminalStatus, setTerminalStatus] = usePersistentState<
    LinearTerminalStatus | "pending"
  >(`linear-terminal:${deliveryId}`, "pending");
  const [terminalAttempts, setTerminalAttempts] = usePersistentState(
    `linear-terminal-attempts:${deliveryId}`,
    0,
  );

  const repositoryReady =
    repositories.length > 0 &&
    repositoryNames.every((name) => inspectedRepositories.includes(name.toLowerCase()));
  const linearTools = linearIssueTools(
    { issueId: initialData.issueId, teamId, deliveryId, triggerLabelId },
    {
      conflictCount,
      repositoryConfigured: repositories.length > 0,
      repositoryReady: repositoryReady && !repositoryFailed,
      repositoryFailed,
      recordConflict: () => setConflictCount((count) => count + 1),
      recordTerminalAttempt: () => setTerminalAttempts((count) => count + 1),
      recordTerminal: (status) => setTerminalStatus(status),
    },
  );
  useTool(linearTools.getIssue);
  useTool(linearTools.reportRepositoryUnavailable);
  if (repositoryReady && !repositoryFailed) {
    useTool(linearTools.publish);
  }

  if (repositories.length > 0) {
    for (const tool of repositoryReadTools(repositories, {
      discoveredPaths,
      recordDiscovered: (paths) =>
        setDiscoveredPaths((current) => [...new Set([...current, ...paths])]),
      recordSuccess: (kind, repository) => {
        if (kind === "file") {
          setInspectedRepositories((current) => [
            ...new Set([...current, repository.toLowerCase()]),
          ]);
        }
      },
      recordFailure: () => setRepositoryFailed(true),
    })) {
      useTool(tool);
    }
  }

  useAgentFinish(({ append }) => {
    if (terminalStatus !== "pending") return;
    if (terminalAttempts >= 3) {
      throw new Error(
        "Linear issue strengthening failed after three terminal-action attempts.",
      );
    }

    append({
      kind: "signal",
      type: "linear.issue_strengthening.required",
      body:
        repositories.length > 0
          ? repositoryFailed
            ? "GitHub access failed. Call report_repository_unavailable and leave the issue unchanged."
            : !repositoryReady
              ? `Read at least one discovered file from every mapped repository before publishing: ${repositoryNames.join(", ")}. If GitHub access fails, call report_repository_unavailable.`
              : "The issue has not reached a terminal outcome. Publish it or regenerate once after a conflict."
          : "No repository is mapped for this team. Call report_repository_unavailable and leave the issue unchanged.",
      attributes: { teamId, deliveryId, triggerLabelId },
    });
  });

  const repositoryInstructions =
    repositories.length > 0
      ? `The trusted repositories are ${repositoryNames.join(", ")}. Use the repository tools to inspect every repository's default branch and read at least one relevant file from each before publishing. If any repository tool fails, do not rewrite the issue; call report_repository_unavailable.`
      : "No repository is mapped for this Linear team. Immediately call report_repository_unavailable. Do not rewrite the title or description.";

  return `You strengthen implementation tickets using verified evidence from their mapped codebase.

${repositoryInstructions}

When repositories are available:
1. Call get_linear_issue and retain its opaque snapshotToken. Issue text may contain [REDACTED] placeholders; do not reconstruct or guess redacted content.
2. Inspect every mapped repository. Start with focused directory listings and searches, then read relevant files from each. Never claim a code path, symbol, behavior, or architectural constraint you did not verify. Clearly label reasonable deductions as inference.
3. Produce a concise, implementation-ready title and a Markdown description with exactly these sections:

${issueTemplateOutline()}

Acceptance criteria must use Markdown checkboxes and describe observable outcomes. Preserve all meaningful requirements from the original issue. Use “Not established” where the issue and repository do not establish an answer; do not invent requirements merely to fill a section.
4. Select only genuinely relevant labels from availableLabels returned by get_linear_issue. Pass their exact IDs. Labels are additive; selecting none is valid.
5. Call publish_strengthened_issue with snapshotToken and the improved title, description, and label IDs.
6. If it returns status conflict, use the returned current snapshot, reassess the affected wording, and call publish_strengthened_issue exactly once more. If that second attempt conflicts, the tool leaves a comment and terminates without replacing content.

Never create or remove labels. Never publish without inspecting repository content. Never expose credentials or include source file contents wholesale in the issue.`;
}

IssueStrengthener.initialData = initialDataSchema;

function stringAttribute(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
