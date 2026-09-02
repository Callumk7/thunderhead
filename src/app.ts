import './observability.ts';
import { createAgentRouter } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { Orchestrator } from './agents/orchestrator.ts';
import { channel as discord } from './channels/discord.ts';

const app = new Hono();

// Trigger an orchestration with one POST per message:
//
//   curl -X POST http://localhost:5173/agents/orchestrator/my-workflow \
//     -H 'content-type: application/json' \
//     -d '{"kind":"user","body":"Delegate a research task and summarize the result."}'
app.route('/agents/orchestrator', createAgentRouter(Orchestrator));

// Discord Interactions Endpoint: /channels/discord/interactions
app.route('/channels/discord', discord.route());

export default app;
