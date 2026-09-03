import { describe, expect, it, vi } from "vitest";
import {
  ensureMarkedComment,
  formatOriginalContentComment,
  issueSnapshotToken,
  originalContentMarker,
  originalContentMarkerPrefix,
  validateExistingLabelIds,
  type LinearIssueGateway,
  type LinearIssueSnapshot,
} from "./linear-client.ts";

const snapshot: LinearIssueSnapshot = {
  id: "issue-id",
  identifier: "ENG-42",
  teamId: "team-id",
  title: "Original title",
  description: "Original body",
  updatedAt: "2026-01-01T00:00:00.000Z",
  labelIds: ["existing"],
  url: "https://linear.app/issue/ENG-42",
};

function gateway(commentBodies: string[] = []): LinearIssueGateway {
  return {
    getIssue: vi.fn(async () => snapshot),
    getTeamLabels: vi.fn(async () => []),
    getIssueCommentBodies: vi.fn(async () => commentBodies),
    createIssueComment: vi.fn(async () => undefined),
    updateIssue: vi.fn(async () => undefined),
  };
}

describe("Linear publication safeguards", () => {
  it("creates a content token unaffected by comment-only timestamp changes", () => {
    const token = issueSnapshotToken(snapshot);
    expect(token).toHaveLength(64);
    expect(issueSnapshotToken({ ...snapshot, title: "Human edit" })).not.toBe(token);
    expect(issueSnapshotToken({ ...snapshot, description: "Human edit" })).not.toBe(token);
    expect(issueSnapshotToken({ ...snapshot, teamId: "other-team" })).not.toBe(token);
    expect(issueSnapshotToken({ ...snapshot, labelIds: ["other"] })).not.toBe(token);
    expect(
      issueSnapshotToken({ ...snapshot, updatedAt: "2026-01-02T00:00:00.000Z" }),
    ).toBe(token);
  });

  it("accepts only existing team label IDs and removes duplicates", () => {
    expect(
      validateExistingLabelIds(["bug", "bug"], [
        { id: "bug", name: "Bug" },
        { id: "feature", name: "Feature" },
      ]),
    ).toEqual(["bug"]);
    expect(() =>
      validateExistingLabelIds(["invented"], [{ id: "bug", name: "Bug" }]),
    ).toThrow(/Unknown or unavailable/);
  });

  it("creates a marked comment once and reuses the marker on retry", async () => {
    const marker = originalContentMarker("delivery-id");
    const first = gateway();
    await ensureMarkedComment(first, snapshot.id, marker, "Backup");
    expect(first.createIssueComment).toHaveBeenCalledWith(
      snapshot.id,
      `${marker}\nBackup`,
    );

    const retry = gateway([`${marker}\nBackup`]);
    await ensureMarkedComment(retry, snapshot.id, marker, "Backup");
    expect(retry.createIssueComment).not.toHaveBeenCalled();
  });

  it("recognizes a legacy version marker when its backed-up content is identical", async () => {
    const body = formatOriginalContentComment(snapshot);
    const legacy = originalContentMarker("delivery-id", snapshot.updatedAt);
    const retry = gateway([`${legacy}\n${body}`]);

    await ensureMarkedComment(
      retry,
      snapshot.id,
      originalContentMarker("delivery-id", issueSnapshotToken(snapshot)),
      body,
      originalContentMarkerPrefix("delivery-id"),
    );
    expect(retry.createIssueComment).not.toHaveBeenCalled();
  });

  it("preserves the complete original title and description in the backup", () => {
    const comment = formatOriginalContentComment(snapshot);
    expect(comment).toContain(snapshot.title);
    expect(comment).toContain(snapshot.description);
  });
});
