import { createHash } from "node:crypto";
import { LinearClient } from "@linear/sdk";

export interface LinearIssueSnapshot {
  id: string;
  identifier: string;
  teamId: string;
  title: string;
  description: string | null;
  updatedAt: string;
  labelIds: string[];
  url: string;
}

export interface LinearLabelOption {
  id: string;
  name: string;
}

export interface LinearIssueGateway {
  getIssue(issueId: string): Promise<LinearIssueSnapshot>;
  getTeamLabels(teamId: string): Promise<LinearLabelOption[]>;
  getIssueCommentBodies(issueId: string): Promise<string[]>;
  createIssueComment(issueId: string, body: string): Promise<void>;
  updateIssue(
    issueId: string,
    input: { title: string; description: string; addedLabelIds: string[] },
  ): Promise<void>;
}

let cachedLinearClient: LinearClient | undefined;

export function getLinearClient(): LinearClient {
  if (cachedLinearClient) return cachedLinearClient;
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) throw new Error("LINEAR_API_KEY is not configured.");
  cachedLinearClient = new LinearClient({ apiKey });
  return cachedLinearClient;
}

export const linearIssueGateway: LinearIssueGateway = {
  async getIssue(issueId) {
    const issue = await getLinearClient().issue(issueId);
    if (!issue.teamId) throw new Error(`Linear issue ${issueId} has no team.`);
    return {
      id: issue.id,
      identifier: issue.identifier,
      teamId: issue.teamId,
      title: issue.title,
      description: issue.description ?? null,
      updatedAt: issue.updatedAt.toISOString(),
      labelIds: issue.labelIds,
      url: issue.url,
    };
  },

  async getTeamLabels(teamId) {
    const team = await getLinearClient().team(teamId);
    const connection = await team.labels({ first: 250 });
    while (connection.pageInfo.hasNextPage) await connection.fetchNext();
    return connection.nodes.map((label) => ({ id: label.id, name: label.name }));
  },

  async getIssueCommentBodies(issueId) {
    const issue = await getLinearClient().issue(issueId);
    const connection = await issue.comments({ last: 250 });
    while (connection.pageInfo.hasPreviousPage) await connection.fetchPrevious();
    return connection.nodes.map((comment) => comment.body);
  },

  async createIssueComment(issueId, body) {
    const result = await getLinearClient().createComment({ issueId, body });
    if (!result.success) throw new Error("Linear did not create the issue comment.");
  },

  async updateIssue(issueId, input) {
    const result = await getLinearClient().updateIssue(issueId, input);
    if (!result.success) throw new Error("Linear did not update the issue.");
  },
};

export function issueSnapshotToken(issue: LinearIssueSnapshot): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: issue.id,
        teamId: issue.teamId,
        title: issue.title,
        description: issue.description,
        labelIds: [...issue.labelIds].sort(),
      }),
    )
    .digest("hex");
}

export function validateExistingLabelIds(
  requestedIds: readonly string[],
  available: readonly LinearLabelOption[],
): string[] {
  const availableIds = new Set(available.map(({ id }) => id));
  const unique = [...new Set(requestedIds)];
  const unknown = unique.filter((id) => !availableIds.has(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown or unavailable Linear label IDs: ${unknown.join(", ")}`);
  }
  return unique;
}

export function originalContentMarkerPrefix(deliveryId: string): string {
  return `<!-- thunderhead:original:${deliveryId}`;
}

export function originalContentMarker(
  deliveryId: string,
  issueVersion?: string,
): string {
  const version = issueVersion ? `:${encodeURIComponent(issueVersion)}` : "";
  return `${originalContentMarkerPrefix(deliveryId)}${version} -->`;
}

export function repositoryUnavailableMarker(deliveryId: string): string {
  return `<!-- thunderhead:repository-unavailable:${deliveryId} -->`;
}

export function conflictMarker(deliveryId: string): string {
  return `<!-- thunderhead:conflict:${deliveryId} -->`;
}

export async function ensureMarkedComment(
  gateway: LinearIssueGateway,
  issueId: string,
  marker: string,
  body: string,
  equivalentMarkerPrefix?: string,
): Promise<{ created: boolean }> {
  const comments = await gateway.getIssueCommentBodies(issueId);
  if (
    comments.some(
      (comment) =>
        comment.includes(marker) ||
        (equivalentMarkerPrefix !== undefined &&
          comment.includes(equivalentMarkerPrefix) &&
          comment.endsWith(body)),
    )
  ) {
    return { created: false };
  }
  await gateway.createIssueComment(issueId, `${marker}\n${body}`);
  return { created: true };
}

export function formatOriginalContentComment(
  original: Pick<LinearIssueSnapshot, "title" | "description">,
): string {
  return [
    "## Original issue content",
    "",
    "Thunderhead saved this content immediately before attempting the strengthened update.",
    "",
    "### Title",
    "",
    original.title,
    "",
    "### Description",
    "",
    original.description ?? "_No description was provided._",
  ].join("\n");
}
