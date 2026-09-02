// flue-blueprint: channel/discord@1
import {
  createDiscordChannel,
  type APIInteraction,
  type APIInteractionResponse,
  type DiscordDestinationRef,
} from "@flue/discord";
import { defineTool, dispatch } from "@flue/runtime";
import * as v from "valibot";
import { Orchestrator } from "../agents/orchestrator.ts";
import { discordClient } from "../shared/discord-client.ts";
import { trackDiscordJob } from "../shared/discord-job-status.ts";
import { splitDiscordMessage } from "../shared/split-discord-message.ts";

export { discordClient as client };

export const channel = createDiscordChannel({
  publicKey: process.env.DISCORD_PUBLIC_KEY!,

  // Path: /channels/discord/interactions
  async interactions({ interaction }) {
    if (interaction.type !== 2 || interaction.data.name !== "orchestrate") {
      return {
        type: 4,
        data: { content: "Unsupported interaction.", flags: 64 },
      } satisfies APIInteractionResponse;
    }

    const destination = destinationFromInteraction(interaction);
    if (!destination || destination.type === "private") {
      return {
        type: 4,
        data: {
          content: "This command requires a Discord channel or DM.",
          flags: 64,
        },
      } satisfies APIInteractionResponse;
    }

    const request =
      interaction.data.type === 1
        ? interaction.data.options?.find((option) => option.type === 3)?.value
        : undefined;
    const channelName = interaction.channel?.name ?? undefined;
    const status = (await discordClient.post(
      `/channels/${destination.channelId}/messages`,
      {
        body: {
          content:
            "⏳ **Research queued**\nPlanning and assigning research tasks…",
        },
      },
    )) as { id: string };

    try {
      const receipt = await dispatch(Orchestrator, {
        id: channel.instanceId(destination),
        initialData: {
          channelId: destination.channelId,
          ...(channelName === undefined ? {} : { channelName }),
        },
        message: {
          kind: "signal",
          type: "discord.command.orchestrate",
          body: request ?? JSON.stringify(interaction.data),
          attributes: {
            interactionId: interaction.id,
            commandName: interaction.data.name,
            statusMessageId: status.id,
          },
        },
      });
      trackDiscordJob(receipt.submissionId, {
        channelId: destination.channelId,
        statusMessageId: status.id,
      });
    } catch (error) {
      await discordClient.patch(
        `/channels/${destination.channelId}/messages/${status.id}`,
        {
          body: {
            content: "❌ **Research failed to start**\nPlease try again later.",
          },
        },
      );
      throw error;
    }

    return {
      type: 4,
      data: {
        content:
          "Workflow accepted. Follow the status message in this channel.",
        flags: 64,
      },
    } satisfies APIInteractionResponse;
  },
});

export function postMessage(ref: {
  channelId: string;
  statusMessageId?: string;
}) {
  return defineTool({
    name: "post_discord_message",
    description:
      "Publish the complete final report to the Discord destination bound to this orchestration. Call exactly once after research and fact-checking finish.",
    input: v.object({
      content: v.pipe(v.string(), v.minLength(1), v.maxLength(20_000)),
    }),
    async run({ data }) {
      const chunks = splitDiscordMessage(data.content);
      const messageIds: string[] = [];
      let firstChunk = 0;

      if (ref.statusMessageId) {
        const result = (await discordClient.patch(
          `/channels/${ref.channelId}/messages/${ref.statusMessageId}`,
          { body: { content: `✅ **Research complete**\n\n${chunks[0]}` } },
        )) as { id?: string };
        if (result.id) messageIds.push(result.id);
        firstChunk = 1;
      }

      for (const content of chunks.slice(firstChunk)) {
        const result = (await discordClient.post(
          `/channels/${ref.channelId}/messages`,
          {
            body: { content },
          },
        )) as { id?: string };
        if (result.id) messageIds.push(result.id);
      }
      return { output: { messagesPosted: chunks.length, messageIds } };
    },
  });
}

const statusLabels = {
  researching:
    "🔎 **Researching**\nSpecialist researchers are gathering evidence…",
  verifying:
    "🧪 **Verifying**\nThe fact-checker is auditing claims and citations…",
  writing: "✍️ **Writing report**\nSynthesizing the verified findings…",
} as const;

export function updateStatus(ref: {
  channelId: string;
  statusMessageId: string;
}) {
  return defineTool({
    name: "update_discord_status",
    description:
      "Update the existing Discord job-status message when the workflow enters researching, verifying, or writing.",
    input: v.object({
      stage: v.picklist(["researching", "verifying", "writing"]),
      detail: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(200))),
    }),
    async run({ data }) {
      const content = `${statusLabels[data.stage]}${data.detail ? `\n${data.detail}` : ""}`;
      await discordClient.patch(
        `/channels/${ref.channelId}/messages/${ref.statusMessageId}`,
        { body: { content } },
      );
      return { output: { stage: data.stage } };
    },
  });
}

function destinationFromInteraction(
  interaction: APIInteraction,
): DiscordDestinationRef | undefined {
  const channelId = interaction.channel?.id ?? interaction.channel?.id;
  if (!channelId) return undefined;
  if (interaction.guild_id) {
    return { type: "guild", guildId: interaction.guild_id, channelId };
  }
  if (interaction.context === 2 || interaction.channel?.type === 3) {
    return { type: "private", channelId };
  }
  if (interaction.context === 1 || interaction.channel?.type === 1) {
    return { type: "dm", channelId };
  }
  return undefined;
}
