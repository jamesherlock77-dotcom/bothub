// ticket.js - simplified, robust ticket modal + create + close handlers

const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle, Events } = require('discord.js');
const { loadJson, saveJson, backupFileToChannel, TICKETS_DB_FILE } = require('./db');
const { safeDeferReply, safeReply } = require('./utils/interaction');
const config = require('./config');
const path = require('path');

function createTicketModal(category = 'General') {
  const modal = new ModalBuilder()
    .setCustomId(`ticket_modal::${category}`)
    .setTitle('Open a Ticket');

  const about = new TextInputBuilder().setCustomId('about_user').setLabel('Is your issue about another Discord user?').setStyle(TextInputStyle.Short);
  const issue = new TextInputBuilder().setCustomId('issue').setLabel('What is the issue?').setStyle(TextInputStyle.Paragraph);
  const proof = new TextInputBuilder().setCustomId('proof').setLabel('Do you have proof?').setStyle(TextInputStyle.Short);
  const happened = new TextInputBuilder().setCustomId('happened_here').setLabel('Did this happen in this server?').setStyle(TextInputStyle.Short);

  modal.addComponents(
    new ActionRowBuilder().addComponents(about),
    new ActionRowBuilder().addComponents(issue),
    new ActionRowBuilder().addComponents(proof),
    new ActionRowBuilder().addComponents(happened),
  );
  return modal;
}

function registerTicketHandlers(client) {
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isButton && interaction.isButton()) {
        if (interaction.customId === 'ticket_open_button') {
          const modal = createTicketModal('General');
          await interaction.showModal(modal).catch(() => {});
          return;
        }
        if (interaction.customId && interaction.customId.startsWith('ticket_close_')) {
          try {
            await safeDeferReply(interaction);
            const thread = interaction.channel;
            if (!thread || !thread.isThread()) {
              await safeReply(interaction, { content: 'This button works in ticket threads only.', ephemeral: true });
              return;
            }
            await thread.setArchived(true).catch(() => {});
            await safeReply(interaction, { content: 'Ticket closed.', ephemeral: true });
          } catch (err) {
            console.error('ticket close error:', err && err.stack ? err.stack : err);
          }
          return;
        }
      }

      if (interaction.isModalSubmit && interaction.isModalSubmit()) {
        if (!interaction.customId.startsWith('ticket_modal::')) return;
        await safeDeferReply(interaction);
        const category = interaction.customId.split('::')[1] || 'General';
        const about = interaction.fields.getTextInputValue('about_user') || '';
        const issue = interaction.fields.getTextInputValue('issue') || '';
        const proof = interaction.fields.getTextInputValue('proof') || '';
        const happened = interaction.fields.getTextInputValue('happened_here') || '';

        if (happened.trim().toLowerCase().startsWith('n')) {
          await safeReply(interaction, { content: "We can only moderate issues that happened in this server.", ephemeral: true });
          return;
        }

        // Create thread in support channel
        const supportChannel = await client.channels.fetch(config.SUPPORT_TICKET_CHANNEL_ID).catch(() => null);
        if (!supportChannel || !supportChannel.isTextBased()) {
          await safeReply(interaction, { content: 'Ticket channel not found.', ephemeral: true });
          return;
        }

        const db = loadJson(TICKETS_DB_FILE, { next_number: 1, tickets: {} });
        const number = db.next_number++;
        const threadName = `ticket-${number}`;
        saveJson(TICKETS_DB_FILE, db);
        await backupFileToChannel(client, TICKETS_DB_FILE, path.basename(TICKETS_DB_FILE), client.user?.tag).catch(() => {});

        let thread;
        try {
          thread = await supportChannel.threads.create({ name: threadName, autoArchiveDuration: 1440 });
        } catch (err) {
          console.error('failed create thread:', err && err.stack ? err.stack : err);
          await safeReply(interaction, { content: 'Failed to open ticket.', ephemeral: true });
          return;
        }

        db.tickets[thread.id] = { number, opener_id: interaction.user.id, category, answers: { about, issue, proof, happened }, closed: false, created_at: new Date().toISOString() };
        saveJson(TICKETS_DB_FILE, db);
        await backupFileToChannel(client, TICKETS_DB_FILE, path.basename(TICKETS_DB_FILE), client.user?.tag).catch(() => {});

        try { await thread.send({ content: `<@&${config.TICKET_PING_ROLE_ID}> Ticket #${number} created by ${interaction.user}` }); } catch {}
        await safeReply(interaction, { content: `Ticket created: ${threadName}`, ephemeral: true });
        return;
      }
    } catch (err) {
      console.error('ticket handler error:', err && err.stack ? err.stack : err);
    }
  });

  client.once('ready', () => {
    console.log('Ticket handlers registered and support panel refreshed if missing.');
  });
}

module.exports = { registerTicketHandlers, createTicketModal };
