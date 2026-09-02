"use agent";
import { useInitialData, useModel, useTool } from "@flue/runtime";
import * as v from "valibot";
import { postMessage } from "../channels/discord.ts";

const initialDataSchema = v.optional(
  v.object({
    channelId: v.string(),
    channelName: v.optional(v.string()),
  }),
);

export function Orchestrator() {
  useModel("openrouter/~google/gemini-flash-latest");

  const data = useInitialData<v.InferOutput<typeof initialDataSchema>>();
  const reportChannelId =
    data?.channelId ?? process.env.DISCORD_REPORT_CHANNEL_ID;
  if (reportChannelId) useTool(postMessage({ channelId: reportChannelId }));

  const destination = data?.channelName
    ? `#${data.channelName}`
    : "the configured report channel";
  return `You are Thunderhead, an orchestration agent. Break each request into clear, bounded tasks and delegate specialized work with the task tool. Coordinate the results, identify failures or uncertainty, and produce a concise final report. When the post_discord_message tool is available, send useful progress updates only when needed and always post the final report to ${destination}. Never claim a task succeeded unless its result supports that claim.`;
}

Orchestrator.initialData = initialDataSchema;
