// flue-blueprint: channel/discord@1
import { REST } from '@discordjs/rest';
import {
	createDiscordChannel,
	type APIInteraction,
	type APIInteractionResponse,
	type DiscordDestinationRef,
} from '@flue/discord';
import { defineTool, dispatch } from '@flue/runtime';
import * as v from 'valibot';
import { Orchestrator } from '../agents/orchestrator.ts';
import { splitDiscordMessage } from '../shared/split-discord-message.ts';

export const client = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN!);

export const channel = createDiscordChannel({
	publicKey: process.env.DISCORD_PUBLIC_KEY!,

	// Path: /channels/discord/interactions
	async interactions({ interaction }) {
		if (interaction.type !== 2 || interaction.data.name !== 'orchestrate') {
			return {
				type: 4,
				data: { content: 'Unsupported interaction.', flags: 64 },
			} satisfies APIInteractionResponse;
		}

		const destination = destinationFromInteraction(interaction);
		if (!destination || destination.type === 'private') {
			return {
				type: 4,
				data: { content: 'This command requires a Discord channel or DM.', flags: 64 },
			} satisfies APIInteractionResponse;
		}

		const request =
			interaction.data.type === 1
				? interaction.data.options?.find((option) => option.type === 3)?.value
				: undefined;
		const channelName = interaction.channel?.name ?? undefined;

		await dispatch(Orchestrator, {
			id: channel.instanceId(destination),
			initialData: {
				channelId: destination.channelId,
				...(channelName === undefined ? {} : { channelName }),
			},
			message: {
				kind: 'signal',
				type: 'discord.command.orchestrate',
				body: request ?? JSON.stringify(interaction.data),
				attributes: {
					interactionId: interaction.id,
					commandName: interaction.data.name,
				},
			},
		});

		return {
			type: 4,
			data: { content: 'Workflow accepted. I will report back here.', flags: 64 },
		} satisfies APIInteractionResponse;
	},
});

export function postMessage(ref: { channelId: string }) {
	return defineTool({
		name: 'post_discord_message',
		description: 'Post a progress update or final report to the Discord destination bound to this orchestration.',
		input: v.object({ content: v.pipe(v.string(), v.minLength(1), v.maxLength(20_000)) }),
		async run({ data }) {
			const chunks = splitDiscordMessage(data.content);
			const messageIds: string[] = [];
			for (const content of chunks) {
				const result = (await client.post(`/channels/${ref.channelId}/messages`, {
					body: { content },
				})) as { id?: string };
				if (result.id) messageIds.push(result.id);
			}
			return { output: { messagesPosted: chunks.length, messageIds } };
		},
	});
}

function destinationFromInteraction(interaction: APIInteraction): DiscordDestinationRef | undefined {
	const channelId = interaction.channel?.id ?? interaction.channel_id;
	if (!channelId) return undefined;
	if (interaction.guild_id) {
		return { type: 'guild', guildId: interaction.guild_id, channelId };
	}
	if (interaction.context === 2 || interaction.channel?.type === 3) {
		return { type: 'private', channelId };
	}
	if (interaction.context === 1 || interaction.channel?.type === 1) {
		return { type: 'dm', channelId };
	}
	return undefined;
}
