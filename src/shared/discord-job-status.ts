import { discordClient } from './discord-client.ts';

interface DiscordJob {
	channelId: string;
	statusMessageId: string;
}

const activeJobs = new Map<string, DiscordJob>();

export function trackDiscordJob(submissionId: string, job: DiscordJob) {
	activeJobs.set(submissionId, job);
}

export function forgetDiscordJob(submissionId: string) {
	activeJobs.delete(submissionId);
}

export async function markDiscordJobStopped(
	submissionId: string,
	outcome: 'failed' | 'aborted',
): Promise<boolean> {
	const job = activeJobs.get(submissionId);
	if (!job) return false;
	activeJobs.delete(submissionId);

	const heading = outcome === 'aborted' ? '🛑 **Research aborted**' : '❌ **Research failed**';
	await discordClient.patch(
		`/channels/${job.channelId}/messages/${job.statusMessageId}`,
		{
			body: {
				content: `${heading}\nThe workflow did not complete. Reference: \`${submissionId}\`. Check the server logs for details.`,
			},
		},
	);
	return true;
}
