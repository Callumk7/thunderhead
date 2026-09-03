import { describe, expect, it, vi } from "vitest";
import {
  issueSnapshotToken,
  type LinearIssueGateway,
  type LinearIssueSnapshot,
} from "../shared/linear-client.ts";
import {
  linearIssueTools,
  type LinearTerminalStatus,
} from "./linear-issue.ts";

const original: LinearIssueSnapshot = {
  id: "issue",
  identifier: "ENG-1",
  teamId: "team",
  title: "Original",
  description: "Original body",
  updatedAt: "2026-01-01T00:00:00.000Z",
  labelIds: ["trigger"],
  url: "https://linear.app/issue/ENG-1",
};

function gateway(current = original): LinearIssueGateway {
  return {
    getIssue: vi.fn(async () => current),
    getTeamLabels: vi.fn(async () => [
      { id: "trigger", name: "ai:strengthen" },
      { id: "bug", name: "Bug" },
    ]),
    getIssueCommentBodies: vi.fn(async () => []),
    createIssueComment: vi.fn(async () => undefined),
    updateIssue: vi.fn(async () => undefined),
  };
}

const strengthenedDescription = `## Summary
A stronger issue.
## Context and motivation
Context.
## Current behavior
Current.
## Desired behavior
Desired.
## Acceptance criteria
- [ ] The observable behavior works.
## Relevant code
- src/app.ts
## Implementation considerations
Considerations.
## Testing requirements
Tests.
## Open questions
Not established`;

const input = {
  snapshotToken: issueSnapshotToken(original),
  title: "Strengthened title",
  description: strengthenedDescription,
  labelIds: ["bug"],
};

function context(data: typeof input) {
  return {
    data,
    step: {
      do: async (_name: string, operation: () => unknown) => {
        const value = await operation();
        if (value === undefined) {
          throw new Error("Durable step returned undefined");
        }
        return value;
      },
    },
  } as never;
}

function tools(
  api: LinearIssueGateway,
  overrides: Partial<{
    conflictCount: number;
    repositoryConfigured: boolean;
    repositoryReady: boolean;
    repositoryFailed: boolean;
  }> = {},
) {
  const terminal: LinearTerminalStatus[] = [];
  const result = linearIssueTools(
    {
      issueId: original.id,
      teamId: original.teamId,
      deliveryId: "delivery",
      triggerLabelId: "trigger",
    },
    {
      conflictCount: overrides.conflictCount ?? 0,
      repositoryConfigured: overrides.repositoryConfigured ?? true,
      repositoryReady: overrides.repositoryReady ?? true,
      repositoryFailed: overrides.repositoryFailed ?? false,
      recordConflict: vi.fn(),
      recordTerminalAttempt: vi.fn(),
      recordTerminal: (status) => terminal.push(status),
      gateway: api,
    },
  );
  return { ...result, terminal };
}

describe("Linear issue tools", () => {
  it("redacts secrets from model-facing Linear issue content", async () => {
    const api = gateway({
      ...original,
      title: "Rotate api_key=abcdefghijklmnop",
      description: "Token github_pat_abcdefghijklmnopqrstuvwxyz123456",
    });
    const bound = tools(api);
    const result = (await bound.getIssue.run({} as never)) as {
      output: { issue: { title: string; description: string; contentRedacted: boolean } };
    };
    expect(result.output.issue.title).toContain("[REDACTED]");
    expect(result.output.issue.description).toContain("[REDACTED]");
    expect(result.output.issue.contentRedacted).toBe(true);
  });

  it("backs up original content before publishing additive existing labels", async () => {
    const api = gateway();
    const bound = tools(api);

    const result = await bound.publish.run(context(input));
    expect(api.createIssueComment).toHaveBeenCalledOnce();
    expect(api.createIssueComment).toHaveBeenCalledWith(
      original.id,
      expect.stringContaining("Original body"),
    );
    expect(api.updateIssue).toHaveBeenCalledWith(original.id, {
      title: input.title,
      description: input.description,
      addedLabelIds: ["bug"],
    });
    expect(bound.terminal).toEqual(["published"]);
    expect(result).toMatchObject({ output: { status: "published" }, terminate: true });
  });

  it("reuses the backup marker after a crash instead of duplicating the comment", async () => {
    let current = original;
    const comments: string[] = [];
    const api = gateway();
    vi.mocked(api.getIssue).mockImplementation(async () => current);
    vi.mocked(api.getIssueCommentBodies).mockImplementation(async () => comments);
    vi.mocked(api.createIssueComment).mockImplementation(async (_issueId, body) => {
      comments.push(body);
      current = { ...current, updatedAt: "after-backup-comment" };
    });
    const bound = tools(api);
    let crashOnce = true;

    await expect(
      bound.publish.run({
        data: input,
        step: {
          do: async (name: string, operation: () => unknown) => {
            const value = await operation();
            if (name === "backup-original-content" && crashOnce) {
              crashOnce = false;
              throw new Error("simulated crash after comment creation");
            }
            return value;
          },
        },
      } as never),
    ).rejects.toThrow(/simulated crash/);

    const result = await bound.publish.run(context(input));
    expect(api.createIssueComment).toHaveBeenCalledOnce();
    expect(api.updateIssue).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ output: { status: "published" }, terminate: true });
  });

  it("does not treat the backup comment's updatedAt change as a conflict", async () => {
    let current = original;
    const api = gateway();
    vi.mocked(api.getIssue).mockImplementation(async () => current);
    vi.mocked(api.createIssueComment).mockImplementation(async () => {
      current = { ...current, updatedAt: "after-backup-comment" };
    });
    const bound = tools(api);

    const result = await bound.publish.run(context(input));
    expect(api.createIssueComment).toHaveBeenCalledOnce();
    expect(api.updateIssue).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ output: { status: "published" }, terminate: true });
  });

  it("rejects publishing without a successful repository file read", async () => {
    const api = gateway();
    const bound = tools(api, { repositoryReady: false });
    await expect(bound.publish.run(context(input))).rejects.toThrow(/file read/);
    expect(api.updateIssue).not.toHaveBeenCalled();
  });

  it("validates the required issue structure at the write boundary", async () => {
    const api = gateway();
    const bound = tools(api);
    await expect(
      bound.publish.run(context({ ...input, description: "## Summary\nIncomplete" })),
    ).rejects.toThrow(/required section/);
    expect(api.updateIssue).not.toHaveBeenCalled();
  });

  it("returns the latest snapshot without writing on the first conflict", async () => {
    const changed = { ...original, title: "Human edit", updatedAt: "later" };
    const api = gateway(changed);
    const bound = tools(api);

    const result = await bound.publish.run(context(input));
    expect(api.createIssueComment).not.toHaveBeenCalled();
    expect(api.updateIssue).not.toHaveBeenCalled();
    expect(result).toMatchObject({ output: { status: "conflict" } });
  });

  it("rechecks after the backup and does not overwrite a late human edit", async () => {
    const changed = { ...original, title: "Late human edit", updatedAt: "later" };
    const api = gateway();
    vi.mocked(api.getIssue)
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(changed);
    const bound = tools(api);

    const result = await bound.publish.run(context(input));
    expect(api.createIssueComment).toHaveBeenCalledOnce();
    expect(api.updateIssue).not.toHaveBeenCalled();
    expect(result).toMatchObject({ output: { status: "conflict" } });
  });

  it("comments and leaves content unchanged after a second conflict", async () => {
    const api = gateway({ ...original, title: "Second human edit", updatedAt: "later" });
    const bound = tools(api, { conflictCount: 1 });

    const result = await bound.publish.run(context(input));
    expect(api.createIssueComment).toHaveBeenCalledWith(
      original.id,
      expect.stringContaining("changed again"),
    );
    expect(api.updateIssue).not.toHaveBeenCalled();
    expect(bound.terminal).toEqual(["aborted_conflict"]);
    expect(result).toMatchObject({
      output: { status: "aborted_conflict" },
      terminate: true,
    });
  });

  it("cancels without mutation when the trigger label was removed", async () => {
    const api = gateway({ ...original, labelIds: [] });
    const bound = tools(api);
    const result = await bound.publish.run(context(input));
    expect(api.createIssueComment).not.toHaveBeenCalled();
    expect(api.updateIssue).not.toHaveBeenCalled();
    expect(bound.terminal).toEqual(["cancelled_trigger_removed"]);
    expect(result).toMatchObject({ output: { status: "cancelled_trigger_removed" } });
  });

  it("reports an unavailable repository without changing the issue", async () => {
    const api = gateway();
    const bound = tools(api, {
      repositoryConfigured: false,
      repositoryReady: false,
    });

    const result = await bound.reportRepositoryUnavailable.run({
      step: {
        do: async (_name: string, operation: () => unknown) => {
          const value = await operation();
          if (value === undefined) throw new Error("Durable step returned undefined");
          return value;
        },
      },
    } as never);
    expect(api.createIssueComment).toHaveBeenCalledWith(
      original.id,
      expect.stringContaining("no repository is currently available"),
    );
    expect(api.updateIssue).not.toHaveBeenCalled();
    expect(bound.terminal).toEqual(["repository_unavailable"]);
    expect(result).toMatchObject({
      output: { status: "repository_unavailable" },
      terminate: true,
    });
  });
});
