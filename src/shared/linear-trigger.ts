import type { LinearWebhookPayload } from "@flue/linear";
import type { EntityWebhookPayloadWithIssueData } from "@linear/sdk/webhooks";

export function isIssueEvent(
  payload: LinearWebhookPayload,
): payload is EntityWebhookPayloadWithIssueData {
  if (payload.type !== "Issue" || !isRecord(payload.data)) return false;
  const data = payload.data as unknown as Record<string, unknown>;
  const labelIds = data.labelIds;
  const labels = data.labels;
  return (
    typeof data.id === "string" &&
    typeof data.identifier === "string" &&
    typeof data.teamId === "string" &&
    typeof data.title === "string" &&
    Array.isArray(labelIds) &&
    labelIds.every((id: unknown) => typeof id === "string") &&
    Array.isArray(labels) &&
    labels.every(
      (label: unknown) =>
        isRecord(label) && typeof label.id === "string" && typeof label.name === "string",
    )
  );
}

export function shouldTriggerIssueStrengthening(
  payload: EntityWebhookPayloadWithIssueData,
  triggerLabelName: string,
): boolean {
  const trigger = findTriggerLabel(payload, triggerLabelName);
  if (!trigger) return false;
  if (payload.action === "create") return true;
  if (payload.action !== "update") return false;

  const previousLabelIds = getPreviousLabelIds(payload.updatedFrom);
  return previousLabelIds !== undefined && !previousLabelIds.includes(trigger.id);
}

export function findTriggerLabel(
  payload: EntityWebhookPayloadWithIssueData,
  triggerLabelName: string,
) {
  return payload.data.labels.find(
    (label) => label.name.toLowerCase() === triggerLabelName.toLowerCase(),
  );
}

export function getPreviousLabelIds(updatedFrom: unknown): string[] | undefined {
  if (!updatedFrom || typeof updatedFrom !== "object") return undefined;
  const labelIds = (updatedFrom as Record<string, unknown>).labelIds;
  if (!Array.isArray(labelIds) || !labelIds.every((id) => typeof id === "string")) {
    return undefined;
  }
  return labelIds;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
