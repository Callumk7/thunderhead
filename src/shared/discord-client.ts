import { REST } from '@discordjs/rest';

export const discordClient = new REST({ version: '10' }).setToken(
	process.env.DISCORD_BOT_TOKEN!,
);
