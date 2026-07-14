import { Bot } from "grammy";

const token = process.env.BOT_TOKEN;
const webhookUrl = process.env.WEBHOOK_URL;

if (!token || !webhookUrl) {
  throw new Error("Missing BOT_TOKEN or WEBHOOK_URL environment variable");
}

const bot = new Bot(token);

async function main() {
  await bot.api.setWebhook(webhookUrl!);
  console.log(`Webhook set to ${webhookUrl}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
