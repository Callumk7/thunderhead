# thunderhead

A [Flue](https://flueframework.com) agent project.

## Setup

```sh
npm install
```

Then copy `.env.example` to `.env` and set `OPENROUTER_API_KEY`, `EXA_API_KEY`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`, and `DISCORD_REPORT_CHANNEL_ID`. Keep `.env` private; it is gitignored. `DISCORD_REPORT_CHANNEL_ID` is reserved as the default destination for future workflows triggered outside Discord.

The orchestrator is dispatch-only and accepts work exclusively from verified Discord interactions.

## Develop

```sh
npm run dev
```

Discord interactions are accepted at `http://localhost:8000/channels/discord/interactions`. There is no directly accessible agent route.

Research requests are split across parallel researcher subagents using Exa, independently audited by a fact-checker, and returned with source URLs and uncertainty labels. Discord displays one live job-status message as work moves through researching, verifying, writing, and completion; terminal failures update the same message.

## Discord setup

Create a Discord application command named `/orchestrate` with one required string option, then configure its Interactions Endpoint URL as:

```txt
https://your-host.example/channels/discord/interactions
```

The bot needs permission to send messages in the configured channels.

## Deploy

```sh
npm run build
sudo systemctl restart thunderhead
```

The included `thunderhead.service` loads secrets from `/home/exedev/thunderhead/.env` and serves on port 8000.
The server writes content-safe, one-line JSON lifecycle logs to stdout/stderr. With systemd, follow them using:

```sh
journalctl -u <service-name> -f -o cat
```

Logs include submissions, model turns, Exa searches, subagent tasks, tools, failures, token usage, and estimated model cost. Prompts, tool arguments, research results, and secrets are intentionally omitted.

## Learn more

- [Flue docs](https://flueframework.com/docs/) — or `npx flue docs` from the terminal.
