function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeWpsScopes(value) {
  return [...new Set(text(value)
    .split(/[\s,]+/u)
    .filter(Boolean)
    .map((scope) => scope.replace(/^delegated:/u, "")))];
}

export function validModelEndpoint(value) {
  try {
    const url = new URL(value);
    const loopback = url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
    return (url.protocol === "https:" || loopback)
      && !url.username
      && !url.password
      && !url.hash;
  } catch {
    return false;
  }
}

export function resolveModelConfiguration(environment = {}) {
  const hasGenericField = [
    environment.LLM_PROVIDER,
    environment.LLM_BASE_URL,
    environment.LLM_MODEL,
    environment.LLM_API_KEY,
  ].some((value) => text(value).length > 0);
  const usedLegacyDeepSeek = !hasGenericField
    && text(environment.DEEPSEEK_API_KEY).length > 0
    && text(environment.DEEPSEEK_MODEL).length > 0;

  return Object.freeze({
    provider: usedLegacyDeepSeek ? "deepseek" : text(environment.LLM_PROVIDER),
    baseUrl: usedLegacyDeepSeek
      ? "https://api.deepseek.com/chat/completions"
      : text(environment.LLM_BASE_URL),
    model: usedLegacyDeepSeek ? text(environment.DEEPSEEK_MODEL) : text(environment.LLM_MODEL),
    apiKey: usedLegacyDeepSeek ? text(environment.DEEPSEEK_API_KEY) : text(environment.LLM_API_KEY),
    usedLegacyDeepSeek,
  });
}
