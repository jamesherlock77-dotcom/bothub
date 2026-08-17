// utils/interaction.js
// Robust helpers for replying to interactions without crashing the bot.

const FLAG_EPHEMERAL = 64; // numeric fallback for ephemeral responses

async function safeDeferReply(interaction) {
  if (!interaction || typeof interaction.deferReply !== 'function') return false;
  try {
    if (interaction.replied || interaction.deferred) return false;
    await interaction.deferReply({ flags: FLAG_EPHEMERAL });
    return true;
  } catch (err) {
    console.warn('safeDeferReply failed:', err && err.message ? err.message : err);
    return false;
  }
}

async function safeReply(interaction, options = {}) {
  if (!interaction) return false;
  try {
    const payload = Object.assign({}, options);
    if (payload.ephemeral) {
      delete payload.ephemeral;
      payload.flags = FLAG_EPHEMERAL;
    }
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply(payload);
    } else {
      await interaction.followUp(payload);
    }
    return true;
  } catch (err) {
    console.warn('safeReply failed:', err && err.message ? err.message : err);
    return false;
  }
}

module.exports = { safeDeferReply, safeReply, FLAG_EPHEMERAL };
