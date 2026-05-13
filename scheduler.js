const cron = require('node-cron');
const { runAgent } = require('./InventoryAgent');

console.log("🕰️  Scheduler Started: Monitoring SuperMarketDB...");

// Run immediately on startup to test
runAgent();

// Schedule to run at minute 0 of every hour
cron.schedule('0 * * * *', () => {
    console.log(`\n⏰ Scheduled Run: ${new Date().toLocaleTimeString()}`);
    runAgent();
});