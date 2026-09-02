"use agent";
import {
  useAgentFinish,
  useDelivery,
  useInitialData,
  useModel,
  useSubagent,
  useTool,
} from "@flue/runtime";
import * as v from "valibot";
import { postMessage, updateStatus } from "../channels/discord.ts";
import { factChecker } from "../subagents/fact-checker.ts";
import { researcher } from "../subagents/researcher.ts";

const initialDataSchema = v.object({
  channelId: v.string(),
  channelName: v.optional(v.string()),
});

export function Orchestrator() {
  useModel("openrouter/~google/gemini-flash-latest");
  useSubagent(researcher);
  useSubagent(factChecker);

  const data = useInitialData<v.InferOutput<typeof initialDataSchema>>();
  const delivery = useDelivery();
  const statusMessageId =
    delivery.kind === "signal" &&
    delivery.type === "discord.command.orchestrate"
      ? delivery.attributes?.statusMessageId
      : undefined;
  const reportChannelId = data.channelId;

  useTool(postMessage({ channelId: reportChannelId, statusMessageId }));
  if (statusMessageId) {
    useTool(updateStatus({ channelId: reportChannelId, statusMessageId }));
  }
  useAgentFinish(({ response, append }) => {
    const reportCalls = response.toolCalls.filter(
      ({ tool }) => tool === "post_discord_message",
    );
    if (reportCalls.some(({ isError }) => !isError)) return;
    if (reportCalls.length >= 2) return;
    append({
      kind: "signal",
      type: "discord.report.required",
      body:
        reportCalls.length === 0
          ? "You have not published the final Discord report. Complete the workflow and call post_discord_message exactly once before finishing."
          : "Publishing the Discord report failed. Retry post_discord_message once with the complete final report.",
    });
  });

  const destination = data.channelName
    ? `#${data.channelName}`
    : "the Discord channel bound to this conversation";
  return `You are Thunderhead, an evidence-first research orchestration agent.

For requests requiring web research, follow this workflow:
1. Decompose the request into two to four independent, self-contained research questions.
2. If update_discord_status is available, set the stage to researching. Then delegate those questions to the researcher subagent. Launch independent tasks together in one parallel tool batch when possible. Each task brief must contain all context the delegate needs.
3. Review the returned evidence packets and identify the consequential claims you may include.
4. If update_discord_status is available, set the stage to verifying. Then delegate a complete list of those claims, evidence, and citations to the fact_checker subagent. Do not write the final report before receiving its audit.
5. If update_discord_status is available, set the stage to writing. Synthesize only claims supported by the evidence. Narrow or omit disputed and unsupported claims.

Final report format:
## Summary
## Key findings
## Evidence and sources
## Uncertainties or disagreements
## Recommended next steps

Cite source URLs immediately after the claims they support. Never invent a citation or imply that a source supports stronger wording than its evidence. Clearly label inference and uncertainty. Keep the report concise enough for Discord.

When post_discord_message is available, post the final report to ${destination}. It replaces the job-status message and automatically splits long reports, so call it once with the complete report. Use update_discord_status only at the three workflow milestones above, not for routine chatter. If research tools fail, publish a short failure report explaining what could not be verified.`;
}

Orchestrator.initialData = initialDataSchema;
