import { Api } from "grammy";
import type { IncomingMessage, ServerResponse } from "http";
import { SupabaseStore } from "../src/store/supabaseStore.js";
import { runMatchPoll } from "../src/matchPoll.js";

const botToken = process.env.BOT_TOKEN;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const steamApiKey = process.env.STEAM_API_KEY;
const pollSecret = process.env.POLL_SECRET;

if (!botToken || !supabaseUrl || !supabaseKey || !steamApiKey || !pollSecret) {
  throw new Error(
    "Missing BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STEAM_API_KEY, or POLL_SECRET environment variable",
  );
}

const store = new SupabaseStore(supabaseUrl, supabaseKey);
const api = new Api(botToken);
const notify = async (chatId: number, text: string) => {
  await api.sendMessage(chatId, text);
};

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end();
  }
  if (req.headers.authorization !== `Bearer ${pollSecret as string}`) {
    res.statusCode = 401;
    return res.end();
  }

  try {
    const summary = await runMatchPoll(store, steamApiKey as string, fetch, notify);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(summary));
  } catch (err) {
    console.error("Error running match poll:", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "poll failed" }));
    }
  }
}
