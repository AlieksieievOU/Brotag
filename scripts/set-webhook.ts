import { Bot } from "grammy";

const token = process.env.BOT_TOKEN;
const webhookUrl = process.env.WEBHOOK_URL;

if (!token || !webhookUrl) {
  throw new Error("Missing BOT_TOKEN or WEBHOOK_URL environment variable");
}

const bot = new Bot(token);

async function main() {
  // "chat_member" (join/leave) updates are not delivered by default; listing
  // allowed_updates overrides Telegram's default set entirely, so every
  // update type the bot relies on must be listed explicitly, including
  // "callback_query" (inline-keyboard button taps) and "message".
  const allowedUpdates = ["message", "chat_member", "callback_query"] as const;
  await bot.api.setWebhook(webhookUrl!, { allowed_updates: allowedUpdates });
  console.log(`Webhook set to ${webhookUrl} (updates: ${allowedUpdates.join(", ")})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
