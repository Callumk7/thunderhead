import './observability.ts';
import { Hono } from 'hono';
import { channel as discord } from './channels/discord.ts';
import { channel as linear } from './channels/linear.ts';

const app = new Hono();

// Discord Interactions Endpoint: /channels/discord/interactions
app.route('/channels/discord', discord.route());

// Linear webhook endpoint: /channels/linear/webhook
app.route('/channels/linear', linear.route());

export default app;
