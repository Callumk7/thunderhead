import type { EntityWebhookPayloadWithIssueData } from "@linear/sdk/webhooks";
import { describe, expect, it } from "vitest";
import {
  getPreviousLabelIds,
  isIssueEvent,
  shouldTriggerIssueStrengthening,
} from "./linear-trigger.ts";

const trigger = { id: "label-trigger", name: "ai:strengthen" };

function issueEvent(options: {
  action: string;
  labels?: Array<{ id: string; name: string }>;
  previousLabelIds?: string[];
  includeUpdatedFrom?: boolean;
}) {
  const payload = {
    action: options.action,
    type: "Issue",
    organizationId: "org",
    data: {
      id: "issue",
      teamId: "team",
      labelIds: (options.labels ?? []).map(({ id }) => id),
      labels: options.labels ?? [],
    },
    ...(options.includeUpdatedFrom === false
      ? {}
      : { updatedFrom: { labelIds: options.previousLabelIds ?? [] } }),
  };
  return payload as unknown as EntityWebhookPayloadWithIssueData;
}

describe("shouldTriggerIssueStrengthening", () => {
  it("triggers when a created issue has the configured label", () => {
    expect(
      shouldTriggerIssueStrengthening(
        issueEvent({ action: "create", labels: [trigger] }),
        "ai:strengthen",
      ),
    ).toBe(true);
  });

  it("does not trigger when a created issue lacks the label", () => {
    expect(
      shouldTriggerIssueStrengthening(issueEvent({ action: "create" }), "ai:strengthen"),
    ).toBe(false);
  });

  it("triggers when the label was newly added", () => {
    expect(
      shouldTriggerIssueStrengthening(
        issueEvent({ action: "update", labels: [trigger], previousLabelIds: ["other"] }),
        "ai:strengthen",
      ),
    ).toBe(true);
  });

  it("ignores updates where the trigger label already existed", () => {
    expect(
      shouldTriggerIssueStrengthening(
        issueEvent({
          action: "update",
          labels: [trigger, { id: "new", name: "bug" }],
          previousLabelIds: [trigger.id],
        }),
        "ai:strengthen",
      ),
    ).toBe(false);
  });

  it("ignores ambiguous updates without prior label IDs", () => {
    expect(
      shouldTriggerIssueStrengthening(
        issueEvent({ action: "update", labels: [trigger], includeUpdatedFrom: false }),
        "ai:strengthen",
      ),
    ).toBe(false);
  });

  it("matches the trigger label name case-insensitively", () => {
    expect(
      shouldTriggerIssueStrengthening(
        issueEvent({ action: "create", labels: [{ ...trigger, name: "AI:Strengthen" }] }),
        "ai:strengthen",
      ),
    ).toBe(true);
  });
});

describe("isIssueEvent", () => {
  it("rejects malformed issue-shaped deliveries", () => {
    expect(
      isIssueEvent({
        type: "Issue",
        data: { id: "issue", teamId: "team", labelIds: [], labels: "not-an-array" },
      } as never),
    ).toBe(false);
  });
});

describe("getPreviousLabelIds", () => {
  it("rejects malformed prior label data", () => {
    expect(getPreviousLabelIds({ labelIds: ["ok", 4] })).toBeUndefined();
    expect(getPreviousLabelIds(null)).toBeUndefined();
  });
});
