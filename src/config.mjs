const REQUIRED_SCOPES = Object.freeze([
  "kso.user_base.read",
  "delegated:kso.mcp_message.readwrite",
]);

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseScopes(value) {
  return [...new Set(text(value).split(/[\s,]+/u).filter(Boolean))];
}

export function validateLocalRedirect(redirectUri, port) {
  try {
    const url = new URL(redirectUri);
    const effectivePort = Number(url.port || (url.protocol === "http:" ? 80 : 443));
    return url.protocol === "http:"
      && url.hostname === "127.0.0.1"
      && effectivePort === port
      && url.pathname === "/oauth/wps/callback"
      && !url.username
      && !url.password
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

export function createLocalConfig(env) {
  const appId = text(env.WPS_APP_ID);
  const appKey = text(env.WPS_APP_KEY);
  const redirectUri = text(env.WPS_REDIRECT_URI);
  const scopes = parseScopes(env.WPS_SCOPES);
  const apiKey = text(env.DEEPSEEK_API_KEY || env.LLM_API_KEY);
  const model = text(env.DEEPSEEK_MODEL || env.LLM_MODEL) || "deepseek-v4-pro";
  const port = Number(env.LOCAL_PORT || 4310);
  const missing = [];
  if (!appId) missing.push("WPS_APP_ID");
  if (!appKey) missing.push("WPS_APP_KEY");
  if (!redirectUri) missing.push("WPS_REDIRECT_URI");
  for (const scope of REQUIRED_SCOPES) if (!scopes.includes(scope)) missing.push(`WPS_SCOPES:${scope}`);
  if (!apiKey) missing.push("DEEPSEEK_API_KEY");
  if (model !== "deepseek-v4-pro") missing.push("DEEPSEEK_MODEL:deepseek-v4-pro");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) missing.push("LOCAL_PORT");
  if (redirectUri && !validateLocalRedirect(redirectUri, port)) missing.push("WPS_REDIRECT_URI:exact-local-callback-required");
  return Object.freeze({
    ready: missing.length === 0,
    host: "127.0.0.1",
    port,
    missing: Object.freeze(missing),
    wps: Object.freeze({ appId, appKey, redirectUri, scopes: Object.freeze(scopes) }),
    model: Object.freeze({ apiKey, model }),
    toJSON() {
      return { ready: missing.length === 0, host: "127.0.0.1", port, missing };
    },
  });
}

export { REQUIRED_SCOPES };
