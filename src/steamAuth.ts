const STEAM_OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";
const CLAIMED_ID_PATTERN = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/;

export function buildSteamLoginUrl(returnToUrl: string, realm: string): string {
  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": returnToUrl,
    "openid.realm": realm,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
  });
  return `${STEAM_OPENID_ENDPOINT}?${params.toString()}`;
}

// Steam's OpenID 2.0 provider doesn't sign responses in a way we can verify
// locally; instead we must echo the whole response back to Steam with
// openid.mode=check_authentication and trust its is_valid:true/false verdict.
export async function verifySteamOpenId(
  query: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<string | undefined> {
  const claimedId = query["openid.claimed_id"];
  if (!claimedId) return undefined;
  const match = CLAIMED_ID_PATTERN.exec(claimedId);
  if (!match) return undefined;

  const verifyParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key.startsWith("openid.")) verifyParams.set(key, value);
  }
  verifyParams.set("openid.mode", "check_authentication");

  const response = await fetchImpl(STEAM_OPENID_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: verifyParams.toString(),
  });
  const text = await response.text();
  if (!/is_valid\s*:\s*true/.test(text)) return undefined;

  return match[1];
}
