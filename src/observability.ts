import { observe, type FlueObservation } from "@flue/runtime";

type LogLevel = "info" | "warn" | "error";

function context(event: FlueObservation) {
  return {
    ...(event.agentName ? { agent: event.agentName } : {}),
    ...(event.conversationId ? { conversationId: event.conversationId } : {}),
    ...(event.submissionId ? { submissionId: event.submissionId } : {}),
    ...(event.taskId ? { taskId: event.taskId } : {}),
  };
}

function write(
  level: LogLevel,
  event: FlueObservation,
  details: Record<string, unknown> = {},
) {
  const entry = {
    timestamp: event.timestamp,
    level,
    service: "thunderhead",
    event: event.type,
    ...context(event),
    ...details,
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

observe((event) => {
  switch (event.type) {
    case "submission_queued":
      write("info", event, { kind: event.kind });
      break;
    case "submission_running":
      write("info", event, {
        kind: event.kind,
        attempt: event.attemptCount,
        maxAttempts: event.maxAttempts,
      });
      break;
    case "agent_start":
      write("info", event);
      break;
    case "agent_end":
      write("info", event, { messageCount: event.messages.length });
      break;
    case "task_start":
      write("info", event, { delegate: event.agent ?? "unknown" });
      break;
    case "task":
      write(event.isError ? "error" : "info", event, {
        delegate: event.agent ?? "unknown",
        durationMs: event.durationMs,
        outcome: event.isError ? "failed" : "completed",
        ...(event.errorInfo?.message ? { error: event.errorInfo.message } : {}),
      });
      break;
    case "tool_start":
      write("info", event, {
        tool: event.toolName,
        toolCallId: event.toolCallId,
      });
      break;
    case "tool":
      write(event.isError ? "error" : "info", event, {
        tool: event.toolName,
        toolCallId: event.toolCallId,
        durationMs: event.durationMs,
        outcome: event.isError ? "failed" : "completed",
        ...(event.errorInfo?.message ? { error: event.errorInfo.message } : {}),
      });
      break;
    case "turn": {
      const usage = event.response.usage;
      write(event.isError ? "error" : "info", event, {
        provider: event.request.providerName,
        model: event.request.requestedModel,
        purpose: event.purpose,
        durationMs: event.durationMs,
        finishReason: event.response.finishReason,
        ...(usage
          ? {
              tokens: {
                input: usage.input,
                output: usage.output,
                cacheRead: usage.cacheRead,
                total: usage.totalTokens,
              },
              estimatedCost: usage.cost.total,
            }
          : {}),
        ...(event.response.error?.message
          ? { error: event.response.error.message }
          : {}),
      });
      break;
    }
    case "log":
      write(event.level, event, {
        message: event.message,
        ...(event.attributes ? { attributes: event.attributes } : {}),
      });
      break;
    case "submission_recovery":
      write(event.outcome === "terminated" ? "error" : "warn", event, {
        operation: event.operation,
        outcome: event.outcome,
        attempt: event.attemptCount,
        maxAttempts: event.maxAttempts,
        ...(event.error?.message ? { error: event.error.message } : {}),
      });
      break;
    case "submission_settled":
      write(
        event.outcome === "completed"
          ? "info"
          : event.outcome === "aborted"
            ? "warn"
            : "error",
        event,
        {
          outcome: event.outcome,
          ...(event.error?.message ? { error: event.error.message } : {}),
        },
      );
      break;
  }
});
