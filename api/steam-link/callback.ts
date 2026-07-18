import type { IncomingMessage, ServerResponse } from "http";
import { SupabaseStore } from "../../src/store/supabaseStore.js";
import { handleCallbackRequest } from "../../src/steamLink.js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable");
}

const store = new SupabaseStore(supabaseUrl, supabaseKey);

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const url = new URL(req.url ?? "", "http://localhost");
    const query: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });

    const result = await handleCallbackRequest(store, query);

    res.statusCode = result.status;
    res.setHeader("Content-Type", "text/plain");
    res.end(result.body);
  } catch (err) {
    console.error("Error handling steam-link callback:", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain");
      res.end("Something went wrong. Go back to Telegram and run /linksteam again.");
    }
  }
}
