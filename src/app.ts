import './observability.ts';
import { Hono } from 'hono';
import { channel as discord } from './channels/discord.ts';

const app = new Hono();

// Discord Interactions Endpoint: /channels/discord/interactions
app.route('/channels/discord', discord.route());

export default app;
