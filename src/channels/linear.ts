// flue-blueprint: channel/linear@1
import { createLinearChannel } from "@flue/linear";
import { dispatch } from "@flue/runtime";
import { IssueStrengthener } from "../agents/issue-strengthener.ts";
import {
  findTriggerLabel,
  isIssueEvent,
  shouldTriggerIssueStrengthening,
} from "../shared/linear-trigger.ts";

export const LINEAR_TRIGGER_LABEL =
  process.env.LINEAR_TRIGGER_LABEL?.trim() || "ai:strengthen";

const organizationId = process.env.LINEAR_ORGANIZATION_ID?.trim();
const webhookId = process.env.LINEAR_WEBHOOK_ID?.trim();

export const channel = createLinearChannel({
  webhookSecret: process.env.LINEAR_WEBHOOK_SECRET!,
  ...(organizationId ? { organizationId } : {}),
  ...(webhookId ? { webhookId } : {}),

  // Path: /channels/linear/webhook
  async webhook({ payload, deliveryId }) {
    if (!isIssueEvent(payload)) return;
    if (!shouldTriggerIssueStrengthening(payload, LINEAR_TRIGGER_LABEL)) return;

    const issue = payload.data;
    const triggerLabel = findTriggerLabel(payload, LINEAR_TRIGGER_LABEL);
    if (!triggerLabel) return;
    await dispatch(IssueStrengthener, {
      id: channel.instanceId({
        type: "issue",
        organizationId: payload.organizationId,
        issueId: issue.id,
      }),
      initialData: { issueId: issue.id },
      idempotencyKey: deliveryId,
      message: {
        kind: "signal",
        type: "linear.issue.strengthen",
        body: `Strengthen Linear issue ${issue.identifier}.`,
        attributes: {
          deliveryId,
          teamId: issue.teamId,
          identifier: issue.identifier,
          triggerAction: payload.action,
          triggerLabelId: triggerLabel.id,
          ...(payload.actor ? { actorId: payload.actor.id } : {}),
        },
      },
    });
  },
});
