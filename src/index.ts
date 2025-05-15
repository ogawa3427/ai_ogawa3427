import { Client, Events, GatewayIntentBits } from 'discord.js';
import * as config from '../config.json';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, c => {
  console.log(`Ready! Logged in as ${c.user.tag}`);
});

client.login(config.token);
