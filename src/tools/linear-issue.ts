import { defineTool, type JsonValue } from "@flue/runtime";
import * as v from "valibot";
import { validateStrengthenedDescription } from "../shared/issue-standard.ts";
import {
  conflictMarker,
  ensureMarkedComment,
  formatOriginalContentComment,
  issueSnapshotToken,
  linearIssueGateway,
  originalContentMarker,
  originalContentMarkerPrefix,
  repositoryUnavailableMarker,
  validateExistingLabelIds,
  type LinearIssueGateway,
  type LinearIssueSnapshot,
} from "../shared/linear-client.ts";
import { redactPotentialSecrets } from "../shared/secret-redaction.ts";

export type LinearTerminalStatus =
  | "published"
  | "repository_unavailable"
  | "aborted_conflict"
  | "cancelled_trigger_removed";

export interface LinearIssueToolRef {
  issueId: string;
  teamId: string;
  deliveryId: string;
  triggerLabelId: string;
}

interface LinearIssueToolOptions {
  conflictCount: number;
  repositoryConfigured: boolean;
  repositoryReady: boolean;
  repositoryFailed: boolean;
  recordConflict(): void;
  recordTerminalAttempt(): void;
  recordTerminal(status: LinearTerminalStatus): void;
  gateway?: LinearIssueGateway;
}

export function linearIssueTools(
  ref: LinearIssueToolRef,
  options: LinearIssueToolOptions,
) {
  const gateway = options.gateway ?? linearIssueGateway;

  const getIssue = defineTool({
    name: "get_linear_issue",
    description:
      "Fetch the current Linear issue snapshot and every existing label for its team. Call before repository research and use the exact snapshot fields when publishing.",
    async run(): Promise<{ output: JsonValue }> {
      const issue = await gateway.getIssue(ref.issueId);
      if (issue.teamId !== ref.teamId) {
        return {
          output: {
            status: "team_changed",
            issue: issueOutput(issue),
            snapshotToken: issueSnapshotToken(issue),
            availableLabels: [],
          },
        };
      }
      const labels = await gateway.getTeamLabels(issue.teamId);
      return {
        output: {
          status: "ready",
          issue: issueOutput(issue),
          snapshotToken: issueSnapshotToken(issue),
          availableLabels: labels.map(({ id, name }) => ({ id, name })),
        },
      };
    },
  });

  const publish = defineTool({
    name: "publish_strengthened_issue",
    description:
      "Replace the bound Linear issue's title and structured Markdown description, back up the exact prior content in a comment, and add selected existing team labels. This call is rejected until a mapped repository file has been read successfully and no repository request has failed.",
    input: v.object({
      snapshotToken: v.pipe(v.string(), v.length(64)),
      title: v.pipe(v.string(), v.minLength(1), v.maxLength(500)),
      description: v.pipe(v.string(), v.minLength(1), v.maxLength(50_000)),
      labelIds: v.optional(v.array(v.string()), []),
    }),
    durable: true,
    async run({ data, step }): Promise<{
      output: JsonValue;
      terminate?: boolean;
    }> {
      options.recordTerminalAttempt();
      if (!options.repositoryReady || options.repositoryFailed) {
        throw new Error(
          "Publishing requires a successful mapped-repository file read and no GitHub failures.",
        );
      }
      validateStrengthenedDescription(data.description);
      if (
        redactPotentialSecrets(data.title).redacted ||
        redactPotentialSecrets(data.description).redacted
      ) {
        throw new Error("The proposed Linear content appears to contain a credential or secret.");
      }
      if (data.labelIds.includes(ref.triggerLabelId)) {
        throw new Error("Do not select the workflow trigger label as an added label.");
      }

      const conflictOutcome = async (
        latest: LinearIssueSnapshot,
      ): Promise<{ output: JsonValue; terminate?: boolean }> => {
        if (options.conflictCount === 0) {
          options.recordConflict();
          const availableLabels = await gateway.getTeamLabels(latest.teamId);
          return {
            output: {
              status: "conflict",
              message: "The issue changed during analysis. Regenerate once from this snapshot.",
              issue: issueOutput(latest),
              snapshotToken: issueSnapshotToken(latest),
              availableLabels: availableLabels.map(({ id, name }) => ({ id, name })),
            },
          };
        }

        await step.do("report-second-conflict", () =>
          ensureMarkedComment(
            gateway,
            ref.issueId,
            conflictMarker(ref.deliveryId),
            "Thunderhead did not replace this issue because it changed again while the strengthened version was being regenerated. Please review the latest edits and re-add `ai:strengthen` when it is ready for another pass.",
          ),
        );
        options.recordTerminal("aborted_conflict");
        return {
          output: {
            status: "aborted_conflict",
            message: "The issue changed twice; no title or description was replaced.",
          },
          terminate: true,
        };
      };

      const current = await gateway.getIssue(ref.issueId);
      if (current.teamId !== ref.teamId) {
        await step.do("report-team-change", () =>
          ensureMarkedComment(
            gateway,
            ref.issueId,
            repositoryUnavailableMarker(ref.deliveryId),
            "Thunderhead did not strengthen this issue because its Linear team changed during analysis and no verified repository is available for the new team. The title and description were left unchanged.",
          ),
        );
        options.recordTerminal("repository_unavailable");
        return {
          output: { status: "repository_unavailable", issueId: ref.issueId },
          terminate: true,
        };
      }
      if (!current.labelIds.includes(ref.triggerLabelId)) {
        options.recordTerminal("cancelled_trigger_removed");
        return {
          output: {
            status: "cancelled_trigger_removed",
            message: "The trigger label was removed; the issue was left unchanged.",
          },
          terminate: true,
        };
      }
      if (issueSnapshotToken(current) !== data.snapshotToken) {
        return conflictOutcome(current);
      }

      const availableLabels = await gateway.getTeamLabels(current.teamId);
      const selectedIds = validateExistingLabelIds(data.labelIds, availableLabels);
      const addedLabelIds = selectedIds.filter((id) => !current.labelIds.includes(id));

      const beforeBackup = await gateway.getIssue(ref.issueId);
      if (issueSnapshotToken(beforeBackup) !== issueSnapshotToken(current)) {
        return conflictOutcome(beforeBackup);
      }

      await step.do("backup-original-content", () =>
        ensureMarkedComment(
          gateway,
          ref.issueId,
          originalContentMarker(ref.deliveryId, issueSnapshotToken(current)),
          formatOriginalContentComment(current),
          originalContentMarkerPrefix(ref.deliveryId),
        ),
      );

      const beforeUpdate = await gateway.getIssue(ref.issueId);
      if (issueSnapshotToken(beforeUpdate) !== issueSnapshotToken(current)) {
        return conflictOutcome(beforeUpdate);
      }

      await step.do("update-strengthened-issue", async () => {
        await gateway.updateIssue(ref.issueId, {
          title: data.title,
          description: data.description,
          addedLabelIds,
        });
        return { updated: true };
      });
      options.recordTerminal("published");

      return {
        output: {
          status: "published",
          issueId: current.id,
          identifier: current.identifier,
          addedLabelIds,
        },
        terminate: true,
      };
    },
  });

  const reportRepositoryUnavailable = defineTool({
    name: "report_repository_unavailable",
    description:
      "Leave the bound Linear issue unchanged and comment that no repository is available. This call is accepted only when no mapping exists or a GitHub request failed.",
    durable: true,
    async run({ step }) {
      options.recordTerminalAttempt();
      if (options.repositoryConfigured && !options.repositoryFailed) {
        throw new Error(
          "The mapped repository has not failed. Inspect a repository file before choosing an outcome.",
        );
      }
      await step.do("report-repository-unavailable", () =>
        ensureMarkedComment(
          gateway,
          ref.issueId,
          repositoryUnavailableMarker(ref.deliveryId),
          "Thunderhead could not strengthen this issue because no repository is currently available for its Linear team. The title and description were left unchanged.",
        ),
      );
      options.recordTerminal("repository_unavailable");
      return {
        output: { status: "repository_unavailable", issueId: ref.issueId },
        terminate: true,
      };
    },
  });

  return { getIssue, publish, reportRepositoryUnavailable };
}

function issueOutput(issue: LinearIssueSnapshot) {
  const title = redactPotentialSecrets(issue.title);
  const description = issue.description
    ? redactPotentialSecrets(issue.description)
    : { content: null, redacted: false };
  return {
    id: issue.id,
    identifier: issue.identifier,
    teamId: issue.teamId,
    title: title.content,
    description: description.content,
    contentRedacted: title.redacted || description.redacted,
    updatedAt: issue.updatedAt,
    labelIds: issue.labelIds,
    url: issue.url,
  };
}
