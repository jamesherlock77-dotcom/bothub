// main.js additions (merge into your existing main.js)
const { registerGiveawayHandlers } = require('./giveaways');
const { registerScrimHandlers } = require('./scrims');
const { registerMetaHandlers } = require('./metaupdate');
const { refreshLeaderboardMessage } = require('./leaderboard');
const { registerInviteHandlers } = require('./invites');
const { registerTeamHandlers } = require('./teams');
const { registerTicketHandlers } = require('./ticket');

// after client created and logged in:
registerTicketHandlers(client);
registerTeamHandlers(client);
registerInviteHandlers(client);
registerGiveawayHandlers(client);
registerScrimHandlers(client);
registerMetaHandlers(client);

// Optional: call refreshLeaderboardMessage(client) after ready if you want to update the leaderboard image on startup.
