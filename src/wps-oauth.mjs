import { randomBytes } from "node:crypto";

const AUTH_URL = "https://openapi.wps.cn/oauth2/auth";
const TOKEN_URL = "https://openapi.wps.cn/oauth2/token";

function oauthScope(scope) {
  const value = String(scope || "").trim();
  if (value.startsWith("app:")) throw new Error("应用权限不能通过用户 OAuth 申请");
  return value.replace(/^delegated:/u, "");
}

export function buildWpsAuthorizationUrl({ appId, redirectUri, scopes, state }) {
  const stateValue = state || randomBytes(24).toString("base64url");
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: appId,
    redirect_uri: redirectUri,
    scope: [...new Set(scopes.map(oauthScope))].join(","),
    state: stateValue,
  }).toString();
  return Object.freeze({ url: url.toString(), state: stateValue });
}

export async function exchangeWpsAuthorizationCode({
  appId,
  appKey,
  code,
  redirectUri,
  fetchImpl = fetch,
  now = () => Date.now(),
}) {
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: appId,
      client_secret: appKey,
      code,
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  let payload;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok || typeof payload?.access_token !== "string") {
    const error = new Error("WPS OAuth 换取令牌失败");
    error.code = "wps_oauth_exchange_failed";
    throw error;
  }
  return Object.freeze({
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: new Date(now() + Number(payload.expires_in || 7200) * 1000).toISOString(),
  });
}
