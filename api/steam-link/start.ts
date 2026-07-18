import type { IncomingMessage, ServerResponse } from "http";
import { SupabaseStore } from "../../src/store/supabaseStore.js";
import { handleStartRequest } from "../../src/steamLink.js";

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const publicUrl = process.env.PUBLIC_URL as string;

if (!supabaseUrl || !supabaseKey || !publicUrl) {
  throw new Error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or PUBLIC_URL environment variable");
}

const store = new SupabaseStore(supabaseUrl, supabaseKey);

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "", "http://localhost");
  const token = url.searchParams.get("token") ?? undefined;
  const result = await handleStartRequest(store, token, publicUrl);

  res.statusCode = result.status;
  for (const [key, value] of Object.entries(result.headers ?? {})) {
    res.setHeader(key, value);
  }
  res.setHeader("Content-Type", "text/plain");
  res.end(result.body);
}
