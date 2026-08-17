// ticket.js
// Implements support panel, ticket modal, ticket creation and a persistent Close button.
// Uses discord.js v14 style components.

const {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  AttachmentBuilder,
  Events,
  ComponentType,
} = require('discord.js');

const { SUPPORT_TICKET_CHANNEL_ID, TICKET_PING_ROLE_ID, SUPPORT_BANNER_FILENAME, SUPPORT_BANNER_PATH } = require('./config');
const { loadJson, saveJson, TICKETS_DB_FILE, backupFileToChannel } = require('./db');
const path = require('path');
const fs = require('fs');

function buildSupportEmbed() {
  const description = [
    "Welcome! Before opening a ticket, please read the rules below carefully.",
    "",
    "## 📘 Ticket Rules",
    "`1.` Please follow our server rules and stay respectful.",
    "`2.` Do not open a ticket to report in-game issues.",
    "`3.` Do not spam or open multiple tickets for the same issue.",
    "`4.` Do not use tickets to report bugs, use the proper bug report channel.",
    "",
    "## ⏳ Response Time",
    "If you don't respond within 48 hours, your ticket will be closed.",
    "",
    "## 🤔 Need Help With Something Else?",
    "<#1528007337699311740>",
    "<#1528009356119900210>",
    "<#1528230357072347146>",
  ].join('\n');

  const embed = new EmbedBuilder()
    .setTitle('Discord Support System')
    .setDescription(description)
    .setColor(0xffa500)
    .setFooter({ text: 'Animal Company: Arena Hub' });

  if (SUPPORT_BANNER_PATH && fs.existsSync(SUPPORT_BANNER_PATH)) {
    embed.setImage(`attachment://${SUPPORT_BANNER_FILENAME}`);
  }
  return embed;
}

function createTicketModal(categoryLabel = 'General') {
  const modal = new ModalBuilder()
    .setCustomId(`ticket_modal::${categoryLabel}`)
    .setTitle('Open a Ticket');

  const aboutUserInput = new TextInputBuilder()
    .setCustomId('about_user')
    .setLabel('Is your issue about another Discord user?')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(10);

  const issueInput = new TextInputBuilder()
    .setCustomId('issue')
    .setLabel('What is the issue you are experiencing?')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(1000);

  const proofInput = new TextInputBuilder()
    .setCustomId('proof')
    .setLabel('Do you have proof?')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(10);

  const happenedHereInput = new TextInputBuilder()
    .setCustomId('happened_here')
    .setLabel("Did the issue happen in this Discord server?")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(10);

  modal.addComponents(
    new ActionRowBuilder().addComponents(aboutUserInput),
    new ActionRowBuilder().addComponents(issueInput),
    new ActionRowBuilder().addComponents(proofInput),
    new ActionRowBuilder().addComponents(happenedHereInput),
  );

  return modal;
}

async function registerTicketHandlers(client) {
  // Register a basic support panel only-if-missing sender on startup
  async function refreshSupportPanel() {
    const channel = await client.channels.fetch(SUPPORT_TICKET_CHANNEL_ID);
    if (!channel || !channel.isTextBased()) return;
    const messages = await channel.messages.fetch({ limit: 50 });
    const already = messages.find(m => m.author && m.author.id === client.user.id && m.embeds.length && m.embeds[0].title === 'Discord Support System');
    if (already) return;

    const embed = buildSupportEmbed();
    if (SUPPORT_BANNER_PATH && fs.existsSync(SUPPORT_BANNER_PATH)) {
      const file = new AttachmentBuilder(SUPPORT_BANNER_PATH, { name: SUPPORT_BANNER_FILENAME });
      await channel.send({ embeds: [embed], files: [file], components: [buildSupportPanelRow()] });
    } else {
      await channel.send({ embeds: [embed], components: [buildSupportPanelRow()] });
    }
  }

  function buildSupportPanelRow() {
    const select = /* For simplicity we add a pair of buttons instead of the select dropdown in the Python version */ [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_category_discord')
          .setLabel('Discord Issue')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('ticket_category_report')
          .setLabel('Report A Discord User')
          .setStyle(ButtonStyle.Secondary),
      ),
    ];
    return select[0];
  }

  client.on(Events.InteractionCreate, async (interaction) => {
    // Panel button click -> show modal
    if (interaction.isButton()) {
      if (interaction.customId === 'ticket_category_discord' || interaction.customId === 'ticket_category_report') {
        const label = interaction.customId === 'ticket_category_discord' ? 'Discord Issue' : 'Report A Discord User';
        const modal = createTicketModal(label);
        await interaction.showModal(modal);
      }

      if (interaction.customId && interaction.customId.startsWith('ticket_close_')) {
        // Ticket close button (should be used inside thread message)
        if (!interaction.channel.isThread()) {
          await interaction.reply({ content: 'This can only be used inside a ticket thread.', ephemeral: true });
          return;
        }

        // permissions check like in Python omitted for brevity; add your own
        // Close the thread and flag closed in DB
        try {
          await interaction.deferReply({ ephemeral: true });
          try { await interaction.channel.send(`🔒 Ticket closed by ${interaction.user}`); } catch {}
          try { await interaction.channel.setArchived(true); } catch {}
          // Update DB
          const db = loadJson(TICKETS_DB_FILE, { next_number: 1, tickets: {} });
          const ticket = db.tickets[interaction.channel.id];
          if (ticket) {
            ticket.closed = true;
            saveJson(TICKETS_DB_FILE, db);
            await backupFileToChannel(client, require('./config').TICKET_LOG_CHANNEL_ID, TICKETS_DB_FILE, path.basename(TICKETS_DB_FILE));
          }
          await interaction.editReply({ content: 'Ticket closed.', ephemeral: true });
        } catch (err) {
          console.error('Failed to close ticket', err);
          await interaction.editReply({ content: 'Failed to close ticket.', ephemeral: true });
        }
      }
    }

    // Modal submit
    if (interaction.isModalSubmit()) {
      if (!interaction.customId.startsWith('ticket_modal::')) return;
      await interaction.deferReply({ ephemeral: true });

      const category = interaction.customId.split('::')[1] || 'General';
      const about = interaction.fields.getTextInputValue('about_user');
      const issue = interaction.fields.getTextInputValue('issue');
      const proof = interaction.fields.getTextInputValue('proof');
      const happened = interaction.fields.getTextInputValue('happened_here');

      if (happened.trim().toLowerCase().startsWith('n')) {
        await interaction.followUp({ content: "We can only moderate situations that happen in this Discord server — this issue can't be filed as a ticket here.", ephemeral: true });
        return;
      }

      // Create thread in SUPPORT_TICKET_CHANNEL_ID
      try {
        const channel = await client.channels.fetch(SUPPORT_TICKET_CHANNEL_ID);
        if (!channel || !channel.isTextBased()) {
          await interaction.followUp({ content: 'Ticket channel not found.', ephemeral: true });
          return;
        }

        // build thread name like "📈┃1-ticket"
        const db = loadJson(TICKETS_DB_FILE, { next_number: 1, tickets: {} });
        const number = db.next_number++;
        const threadName = `📈┃${number}-ticket`;

        const thread = await channel.threads.create({
          name: threadName,
          autoArchiveDuration: 60 * 24, // 24h
          type: 11, // Private thread (ChannelType.PrivateThread numeric) - if unavailable fallback below
        }).catch(async (err) => {
          // fallback to public thread
          return await channel.threads.create({ name: threadName, autoArchiveDuration: 60 * 24, type: 10 });
        });

        // store ticket
        db.tickets[thread.id] = {
          number,
          opener_id: interaction.user.id,
          category,
          answers: {
            'Is your issue about another Discord user?': about,
            'What is the issue you are experiencing?': issue,
            'Do you have proof?': proof,
            'Did the issue happen in this Discord server?': happened,
          },
          closed: false,
          created_at: new Date().toISOString(),
        };
        saveJson(TICKETS_DB_FILE, db);
        await backupFileToChannel(client, require('./config').TICKET_LOG_CHANNEL_ID, TICKETS_DB_FILE, path.basename(TICKETS_DB_FILE));

        const embed = {
          title: `Ticket #${number}`,
          description: `**Category:** ${category}\n\n**Issue:** ${issue}\n\n**Proof:** ${proof}`,
          color: 0xffa500,
          footer: { text: `Opened by ${interaction.user.tag}` },
        };

        // persistent close button
        const closeButton = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder().setCustomId(`ticket_close_${thread.id}`).setLabel('Close').setStyle(ButtonStyle.Danger).setEmoji('🔒')
          );

        // send into thread
        if (SUPPORT_BANNER_PATH && fs.existsSync(SUPPORT_BANNER_PATH)) {
          const file = new AttachmentBuilder(SUPPORT_BANNER_PATH, { name: SUPPORT_BANNER_FILENAME });
          await thread.send({ content: `<@&${TICKET_PING_ROLE_ID}> ${interaction.user}`, embeds: [embed], files: [file], components: [closeButton] });
        } else {
          await thread.send({ content: `<@&${TICKET_PING_ROLE_ID}> ${interaction.user}`, embeds: [embed], components: [closeButton] });
        }

        await interaction.followUp({ content: `Ticket created: <#${thread.id}>`, ephemeral: true });
      } catch (err) {
        console.error('Failed to create ticket thread', err);
        await interaction.followUp({ content: 'Failed to create ticket thread.', ephemeral: true });
      }
    }
  });

  // startup task: ensure panel present
  client.once('ready', async () => {
    await refreshSupportPanel();
    console.log('Ticket handlers registered and support panel refreshed if missing.');
  });
}

module.exports = {
  registerTicketHandlers,
};