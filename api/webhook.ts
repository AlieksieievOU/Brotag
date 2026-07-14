import { webhookCallback } from "grammy";
import type { IncomingMessage, ServerResponse } from "http";
import { createBot } from "../src/bot.js";
import { SupabaseStore } from "../src/store/supabaseStore.js";

const token = process.env.BOT_TOKEN;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!token || !supabaseUrl || !supabaseKey) {
  throw new Error("Missing BOT_TOKEN, SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY environment variable");
}

const store = new SupabaseStore(supabaseUrl, supabaseKey);
const bot = createBot(token, store);
const handleUpdate = webhookCallback(bot, "http");

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    await handleUpdate(req, res);
  } catch (err) {
    console.error("Error handling Telegram update:", err);
    if (!res.headersSent) {
      res.statusCode = 200;
      res.end("ok");
    }
  }
}
