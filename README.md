# thunderhead

A [Flue](https://flueframework.com) agent project.

## Setup

```sh
npm install
```

Then add `OPENROUTER_API_KEY`, `EXA_API_KEY`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`, and `DISCORD_REPORT_CHANNEL_ID` to `.env`.

## Run the orchestrator

```sh
npx flue run src/agents/orchestrator.ts --message "Delegate a research task and summarize the result."
```

Conversations are durable — pass `--id <id>` to continue one. When the server is running, trigger a workflow over HTTP:

```sh
curl -X POST http://localhost:5173/agents/orchestrator/my-workflow \
  -H 'content-type: application/json' \
  -d '{"kind":"user","body":"Delegate a research task and summarize the result."}'
```

## Develop

```sh
npm run dev
```

The orchestrator is served at `http://localhost:5173/agents/orchestrator/:id`. Discord interactions are accepted at `http://localhost:5173/channels/discord/interactions`.

Research requests are split across parallel researcher subagents using Exa, independently audited by a fact-checker, and returned with source URLs and uncertainty labels.

## Discord setup

Create a Discord application command named `/orchestrate` with one required string option, then configure its Interactions Endpoint URL as:

```txt
https://your-host.example/channels/discord/interactions
```

The bot needs permission to send messages in the configured channels.

## Deploy

```sh
npm run build
node dist/server.mjs
```

## Learn more

- [Flue docs](https://flueframework.com/docs/) — or `npx flue docs` from the terminal.
