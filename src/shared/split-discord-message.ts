const DISCORD_MESSAGE_LIMIT = 2_000;
const DEFAULT_CHUNK_SIZE = 1_900;

export function splitDiscordMessage(content: string, maxLength = DEFAULT_CHUNK_SIZE): string[] {
	if (!Number.isInteger(maxLength) || maxLength < 100 || maxLength > DISCORD_MESSAGE_LIMIT) {
		throw new Error(`Discord chunk size must be an integer between 100 and ${DISCORD_MESSAGE_LIMIT}.`);
	}

	let remaining = content.trim();
	if (!remaining) return [];

	const chunks: string[] = [];
	while (remaining.length > maxLength) {
		const window = remaining.slice(0, maxLength + 1);
		let splitAt = window.lastIndexOf('\n\n');
		if (splitAt < Math.floor(maxLength / 2)) splitAt = window.lastIndexOf('\n');
		if (splitAt < Math.floor(maxLength / 2)) splitAt = window.lastIndexOf(' ');
		if (splitAt < Math.floor(maxLength / 2)) splitAt = maxLength;

		chunks.push(remaining.slice(0, splitAt).trimEnd());
		remaining = remaining.slice(splitAt).trimStart();
	}

	if (remaining) chunks.push(remaining);
	return chunks;
}
