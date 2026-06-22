import { Client, GatewayIntentBits, EmbedBuilder, ChannelType, Guild, type TextChannel } from 'discord.js';
import { log } from './utils/logger.js';
import type { VerifiedDeal, ScrapedItem } from './types/index.js';

const MASTER_DEALS_CHANNEL_NAME = 'master-deals';
const FILTER_LOGS_CHANNEL_NAME = 'bot-filter-logs';

let client: Client | null = null;
let masterDealsChannelId: string | null = null;
let filterLogsChannelId: string | null = null;
let botReady = false;

export function isDiscordBotReady(): boolean {
  return botReady && client !== null;
}

export async function initDiscordBot(): Promise<Client | null> {
  if (client) return client;

  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!token || !guildId) {
    log('warn', 'Discord bot not configured; set DISCORD_BOT_TOKEN and DISCORD_GUILD_ID.');
    return null;
  }

  const newClient = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Discord bot login timeout')), 30000);

    newClient.once('ready', () => {
      clearTimeout(timeout);
      log('info', `Discord bot logged in as ${newClient.user?.tag}`);
      resolve();
    });

    newClient.once('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    newClient.login(token).catch((err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  const guild = await newClient.guilds.fetch(guildId);
  await setupChannels(guild);

  botReady = true;
  client = newClient;
  return client;
}

async function setupChannels(guild: Guild): Promise<void> {
  const channels = await guild.channels.fetch();

  const masterChannel = channels.find((c) => c?.name === MASTER_DEALS_CHANNEL_NAME);
  if (masterChannel && masterChannel.isTextBased()) {
    masterDealsChannelId = masterChannel.id;
    log('info', `Found Discord channel #${MASTER_DEALS_CHANNEL_NAME}`, { channelId: masterChannel.id });
  } else {
    const created = await guild.channels.create({
      name: MASTER_DEALS_CHANNEL_NAME,
      type: ChannelType.GuildText,
      reason: 'ResellEngine master deals channel',
    });
    masterDealsChannelId = created.id;
    log('info', `Created Discord channel #${MASTER_DEALS_CHANNEL_NAME}`, { channelId: created.id });
  }

  const filterChannel = channels.find((c) => c?.name === FILTER_LOGS_CHANNEL_NAME);
  if (filterChannel && filterChannel.isTextBased()) {
    filterLogsChannelId = filterChannel.id;
    log('info', `Found Discord channel #${FILTER_LOGS_CHANNEL_NAME}`, { channelId: filterChannel.id });
  } else {
    const created = await guild.channels.create({
      name: FILTER_LOGS_CHANNEL_NAME,
      type: ChannelType.GuildText,
      reason: 'ResellEngine filter logs channel',
    });
    filterLogsChannelId = created.id;
    log('info', `Created Discord channel #${FILTER_LOGS_CHANNEL_NAME}`, { channelId: created.id });
  }
}

async function getChannel(channelId: string | null): Promise<TextChannel | null> {
  if (!client || !channelId) return null;
  const channel = await client.channels.fetch(channelId);
  if (!channel || channel.type !== ChannelType.GuildText) return null;
  return channel as TextChannel;
}

export async function sendMasterDealEmbed(deal: VerifiedDeal): Promise<void> {
  if (!isDiscordBotReady()) {
    throw new Error('Discord bot is not ready');
  }

  const channel = await getChannel(masterDealsChannelId);
  if (!channel) {
    throw new Error('Master deals channel not accessible');
  }

  const embed = new EmbedBuilder()
    .setTitle(deal.title)
    .setURL(deal.url)
    .setColor(0x00ff00)
    .addFields(
      { name: 'Plattform', value: deal.platform, inline: true },
      { name: 'Einkaufspreis', value: `${deal.price.toFixed(2)} ${deal.currency}`, inline: true },
      { name: 'Geschätzter Resell-Wert', value: `${deal.estimatedResellValue.toFixed(2)} ${deal.currency}`, inline: true },
      { name: 'Netto-Profit', value: `${deal.netProfit.toFixed(2)} ${deal.currency}`, inline: true },
      { name: 'ROI', value: `${deal.roiPercent.toFixed(1)}%`, inline: true },
      { name: 'Zustand', value: deal.condition || 'unbekannt', inline: true }
    )
    .setFooter({ text: 'ResellEngine • Master Deal' })
    .setTimestamp(new Date(deal.createdAt));

  if (deal.imageUrl) {
    embed.setImage(deal.imageUrl);
  }

  await channel.send({ embeds: [embed] });
  log('info', 'Discord master deal sent via bot', { dealId: deal.id });
}

export async function sendFilterLogEmbed(item: ScrapedItem, stage: number, reason: string): Promise<void> {
  if (!isDiscordBotReady()) {
    throw new Error('Discord bot is not ready');
  }

  const channel = await getChannel(filterLogsChannelId);
  if (!channel) {
    throw new Error('Filter logs channel not accessible');
  }

  const embed = new EmbedBuilder()
    .setTitle(`Gefiltert: ${item.title}`)
    .setURL(item.url)
    .setColor(0xe85d04)
    .addFields(
      { name: 'Plattform', value: item.platform, inline: true },
      { name: 'Preis', value: `${item.price.toFixed(2)} ${item.currency}`, inline: true },
      { name: 'Stage', value: String(stage), inline: true },
      { name: 'Begründung', value: reason }
    )
    .setFooter({ text: 'ResellEngine • Filter-Log' })
    .setTimestamp(new Date());

  if (item.imageUrl) {
    embed.setImage(item.imageUrl);
  }

  await channel.send({ embeds: [embed] });
  log('info', 'Discord filter log sent via bot', { itemId: item.id, stage });
}
