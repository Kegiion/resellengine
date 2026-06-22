import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ChannelType,
  Guild,
  type TextChannel,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
} from 'discord.js';
import { log } from './utils/logger.js';
import { fetchGuestCookiesOnce } from './scrapers/vintedScraper.js';
import { getWorkerStats } from './services/realtimeWorker.js';
import { isSniperRunning, setSniperRunning, getLastHandshakeAt, updateLastHandshakeAt } from './services/discordState.js';
import type { VerifiedDeal, ScrapedItem } from './types/index.js';

const MASTER_DEALS_CHANNEL_NAME = 'master-deals';
const FILTER_LOGS_CHANNEL_NAME = 'bot-filter-logs';
const ADMIN_PANEL_CHANNEL_NAME = 'admin-panel';

interface PriceEstimation {
  estimatedResellValue: number;
  sampleSize: number;
  condition: string;
  fees: number;
  shipping: number;
  netProfit: number;
}

let adminPanelMessageId: string | null = null;
let adminPanelChannelId: string | null = null;

function simulateMarketValue(deal: VerifiedDeal): PriceEstimation {
  const sampleSize = 15;
  const condition = deal.condition || 'Sehr gut';

  const estimatedResellValue = deal.estimatedResellValue;
  const fees = deal.fees;
  const shipping = deal.shipping;
  const netProfit = Math.round((estimatedResellValue - deal.price - fees - shipping) * 100) / 100;

  return {
    estimatedResellValue,
    sampleSize,
    condition,
    fees,
    shipping,
    netProfit,
  };
}

function formatPriceEstimationField(deal: VerifiedDeal, estimation: PriceEstimation): string {
  return [
    `Aktueller Preis: ${deal.price.toFixed(2)} ${deal.currency}`,
    `Geschätzter Wiederverkaufswert: ${estimation.estimatedResellValue.toFixed(2)} ${deal.currency} (basierend auf dem Durchschnitt der letzten ${estimation.sampleSize} erfolgreichen Verkäufe dieser Marke/Kategorie)`,
    `Erwarteter Profit: ~${estimation.netProfit.toFixed(2)} ${deal.currency} 🔥`,
  ].join('\n');
}

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
  await setupAdminPanel(guild);
  setupInteractionHandler(newClient);

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

async function setupAdminPanel(guild: Guild): Promise<void> {
  const channels = await guild.channels.fetch();
  let channel = channels.find((c) => c?.name === ADMIN_PANEL_CHANNEL_NAME);
  if (!channel || !channel.isTextBased()) {
    channel = await guild.channels.create({
      name: ADMIN_PANEL_CHANNEL_NAME,
      type: ChannelType.GuildText,
      reason: 'ResellEngine admin control panel',
    });
    log('info', `Created Discord channel #${ADMIN_PANEL_CHANNEL_NAME}`, { channelId: channel.id });
  }

  adminPanelChannelId = channel.id;

  const textChannel = channel as TextChannel;
  const messages = await textChannel.messages.fetch({ limit: 10 }).catch(() => new Map());
  const existing = Array.from(messages.values()).find((m) => m.author.id === client?.user?.id && m.components.length > 0);
  if (existing) {
    adminPanelMessageId = existing.id;
    await updateAdminPanel(textChannel, existing.id);
  } else {
    const embed = buildAdminPanelEmbed();
    const row = buildAdminPanelButtons();
    const sent = await textChannel.send({ embeds: [embed], components: [row] });
    adminPanelMessageId = sent.id;
    log('info', 'Posted Discord admin panel message', { messageId: sent.id });
  }
}

function buildAdminPanelEmbed(): EmbedBuilder {
  const running = isSniperRunning();
  const statusEmoji = running ? '🟢' : '🔴';
  const statusText = running ? 'AKTIV' : 'PAUSIERT';
  const handshakeAt = getLastHandshakeAt();
  const handshakeText = handshakeAt
    ? `vor ${Math.floor((Date.now() - handshakeAt.getTime()) / 60_000)} Min`
    : 'noch keiner';

  return new EmbedBuilder()
    .setTitle('ResellEngine Admin-Panel')
    .setDescription(`Steuere den Sniper und prüfe den aktuellen Systemstatus direkt von unterwegs.`)
    .setColor(running ? 0x22c55e : 0xef4444)
    .addFields(
      { name: `${statusEmoji} Sniper`, value: statusText, inline: true },
      { name: '🕒 Letzter Handshake', value: handshakeText, inline: true },
      { name: '📅 Stand', value: new Date().toLocaleString('de-DE'), inline: true }
    )
    .setFooter({ text: 'ResellEngine • Admin Control' });
}

function buildAdminPanelButtons(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('sniper-start')
      .setLabel('Sniper Start')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('sniper-stop')
      .setLabel('Sniper Stopp')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('status-stats')
      .setLabel('Status & Stats abrufen')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('force-handshake')
      .setLabel('Handshake erzwingen')
      .setStyle(ButtonStyle.Secondary)
  );
}

async function updateAdminPanel(channel: TextChannel, messageId: string): Promise<void> {
  try {
    const message = await channel.messages.fetch(messageId);
    const embed = buildAdminPanelEmbed();
    const row = buildAdminPanelButtons();
    await message.edit({ embeds: [embed], components: [row] });
  } catch (error) {
    log('warn', 'Failed to update admin panel message', { error: String(error) });
  }
}

async function refreshAdminPanel(): Promise<void> {
  if (!adminPanelChannelId || !adminPanelMessageId || !client) return;
  const channel = await client.channels.fetch(adminPanelChannelId);
  if (!channel || channel.type !== ChannelType.GuildText) return;
  await updateAdminPanel(channel as TextChannel, adminPanelMessageId);
}

function setupInteractionHandler(discordClient: Client): void {
  discordClient.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton() || interaction.channelId !== adminPanelChannelId) return;
    const button = interaction as ButtonInteraction;

    try {
      if (button.customId === 'sniper-start') {
        setSniperRunning(true);
        await refreshAdminPanel();
        await button.reply({ content: 'Sniper gestartet.', ephemeral: true });
        log('info', 'Discord admin panel: Sniper started');
        return;
      }

      if (button.customId === 'sniper-stop') {
        setSniperRunning(false);
        await refreshAdminPanel();
        await button.reply({ content: 'Sniper pausiert.', ephemeral: true });
        log('info', 'Discord admin panel: Sniper stopped');
        return;
      }

      if (button.customId === 'status-stats') {
        const stats = getWorkerStats();
        await button.reply({
          content: [
            `**Aktueller Status**`,
            `Sniper: ${isSniperRunning() ? '🟢 AKTIV' : '🔴 PAUSIERT'}`,
            `Letzter Handshake: ${getLastHandshakeAt() ? `vor ${Math.floor((Date.now() - getLastHandshakeAt()!.getTime()) / 60_000)} Min` : 'noch keiner'}`,
            ``,
            `**Scan-Statistiken**`,
            `Gescannte Artikel: ${stats.scanned}`,
            `Spam-Filter: ${stats.spamFiltered}`,
            `eBay-Checks: ${stats.ebayChecked}`,
            `Profit-Filter: ${stats.profitFiltered}`,
            `Bildanalysen: ${stats.imageAnalyses}`,
            `Alarme: ${stats.alarms}`,
          ].join('\n'),
          ephemeral: true,
        });
        return;
      }

      if (button.customId === 'force-handshake') {
        await button.reply({ content: 'Erzwinge neuen Handshake...', ephemeral: true });
        const antiBot = {
          minDelayMs: Number(process.env.MIN_DELAY_MS) || 2000,
          maxDelayMs: Number(process.env.MAX_DELAY_MS) || 5000,
          rotateUserAgents: true,
        };
        const guest = await fetchGuestCookiesOnce(antiBot);
        if (guest) {
          updateLastHandshakeAt();
          await refreshAdminPanel();
          await button.followUp({ content: 'Handshake erfolgreich.', ephemeral: true });
        } else {
          await button.followUp({ content: 'Handshake fehlgeschlagen.', ephemeral: true });
        }
        return;
      }
    } catch (error) {
      log('error', 'Discord admin panel interaction failed', { customId: button.customId, error: String(error) });
      await button.reply({ content: 'Aktion fehlgeschlagen.', ephemeral: true }).catch(() => undefined);
    }
  });
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

  const estimation = simulateMarketValue(deal);
  const marketValueField = formatPriceEstimationField(deal, estimation);
  const footerText = `Preisschätzung basiert auf einem Abgleich von ${estimation.sampleSize} ähnlichen Artikeln im Zustand '${estimation.condition}'.`;

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
      { name: 'Zustand', value: deal.condition || 'unbekannt', inline: true },
      { name: '📊 Marktwert-Analyse', value: marketValueField }
    )
    .setFooter({ text: `${footerText} • ResellEngine` })
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
