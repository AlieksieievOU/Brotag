import { Bot } from "grammy";

const token = process.env.BOT_TOKEN;
const webhookUrl = process.env.WEBHOOK_URL;

if (!token || !webhookUrl) {
  throw new Error("Missing BOT_TOKEN or WEBHOOK_URL environment variable");
}

const bot = new Bot(token);

async function main() {
  // "chat_member" (join/leave) updates are not delivered by default; listing
  // allowed_updates overrides the default set, so "message" must stay listed.
  await bot.api.setWebhook(webhookUrl!, {
    allowed_updates: ["message", "chat_member"],
  });
  console.log(`Webhook set to ${webhookUrl} (updates: message, chat_member)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
