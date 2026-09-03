import { describe, expect, it, vi } from "vitest";
import {
  ensureMarkedComment,
  formatOriginalContentComment,
  issueSnapshotToken,
  originalContentMarker,
  snapshotMatches,
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
  it("creates an opaque conflict token that changes with issue content", () => {
    expect(issueSnapshotToken(snapshot)).toHaveLength(64);
    expect(issueSnapshotToken({ ...snapshot, title: "Human edit" })).not.toBe(
      issueSnapshotToken(snapshot),
    );
  });

  it("matches only the exact issue snapshot", () => {
    expect(snapshotMatches(snapshot, snapshot)).toBe(true);
    expect(snapshotMatches({ ...snapshot, title: "Human edit" }, snapshot)).toBe(false);
    expect(
      snapshotMatches({ ...snapshot, updatedAt: "2026-01-02T00:00:00.000Z" }, snapshot),
    ).toBe(false);
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

  it("preserves the complete original title and description in the backup", () => {
    const comment = formatOriginalContentComment(snapshot);
    expect(comment).toContain(snapshot.title);
    expect(comment).toContain(snapshot.description);
  });
});
