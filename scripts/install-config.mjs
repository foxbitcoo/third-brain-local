import { validateLocalRedirect } from "../src/config.mjs";

const REQUIRED_WPS_SCOPES = Object.freeze([
  "kso.user_base.read",
  "delegated:kso.mcp_message.readwrite",
]);

const REQUIRED_FIELDS = Object.freeze([
  ["WPS_APP_ID", "WPS 开放平台应用 App ID"],
  ["WPS_APP_KEY", "WPS 开放平台应用 App Key"],
  ["WPS_REDIRECT_URI", "WPS OAuth 回调地址"],
  ["WPS_SCOPES", "WPS 授权范围"],
  ["DEEPSEEK_MODEL", "DeepSeek 模型名称"],
  ["DEEPSEEK_API_KEY", "DeepSeek API Key"],
]);

function present(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function parseScopes(value) {
  if (!present(value)) return [];
  return [...new Set(value.split(/[\s,]+/u).map((item) => item.trim()).filter(Boolean))];
}

export function assessInstallConfig(environment = {}) {
  const missing = REQUIRED_FIELDS
    .filter(([key]) => !present(environment[key]))
    .map(([key, label]) => ({ key, label }));
  const scopes = parseScopes(environment.WPS_SCOPES);
  const localPort = Number(environment.LOCAL_PORT || 4310);
  const missingScopes = present(environment.WPS_SCOPES)
    ? REQUIRED_WPS_SCOPES.filter((scope) => !scopes.includes(scope))
    : [];
  const blockers = [];

  if (present(environment.WPS_SID)) {
    blockers.push({
      code: "unsupported_wps_sid",
      message: "检测到 WPS_SID。公开版本不支持浏览器会话认证，请删除该值并改用官方 OAuth。",
    });
  }

  if (present(environment.WPS_REDIRECT_URI)
    && !validateLocalRedirect(environment.WPS_REDIRECT_URI, localPort)) {
    blockers.push({
      code: "invalid_redirect_uri",
      message: "WPS_REDIRECT_URI 必须精确为 http://127.0.0.1:<LOCAL_PORT>/oauth/wps/callback。",
    });
  }

  if (present(environment.DEEPSEEK_MODEL) && environment.DEEPSEEK_MODEL !== "deepseek-v4-pro") {
    blockers.push({
      code: "unsupported_llm_provider",
      message: "当前本地试用固定使用 DeepSeek V4 Pro；其他模型适配器尚未验证。",
    });
  }

  if (missingScopes.length > 0) {
    blockers.push({
      code: "missing_required_scope",
      message: `WPS_SCOPES 还缺少 ${missingScopes.length} 项首期权限。`,
    });
  }

  const wpsReady = !missing.some((item) => item.key.startsWith("WPS_"))
    && missingScopes.length === 0
    && !blockers.some((item) => item.code.startsWith("invalid_redirect") || item.code.includes("wps") || item.code.includes("scope"));
  const llmReady = !missing.some((item) => item.key.startsWith("DEEPSEEK_"))
    && !blockers.some((item) => item.code === "unsupported_llm_provider");

  const configurationReady = missing.length === 0 && blockers.length === 0;

  return Object.freeze({
    ready: false,
    configurationReady,
    productRuntimeReady: false,
    publicPreviewRunnable: true,
    productRuntimeIncluded: true,
    wpsReady: false,
    wpsConfigured: wpsReady,
    llmReady: false,
    llmConfigured: llmReady,
    missing,
    missingScopes,
    blockers,
    nextAction: "复制 .env.example 为 .env.local，填写你自己的 WPS 应用和模型服务配置，再运行 npm run preflight。",
    notes: [
      "WPS_SID 不支持，也不应从浏览器复制；必须使用 WPS 开放平台 App ID、App Key 和用户 OAuth。",
      "每个企业或安装者使用自己的 WPS 应用、数据范围、审批和 OAuth，不复用维护者环境。",
      "预检只能确认字段和权限名称是否齐全，不能证明应用已审批发布、用户 OAuth 已完成或模型服务可连接。",
      "本地试用包含 WPS OAuth、只读会话消息导入和 DeepSeek 分析；机器人发送与公网后端不包含。",
    ],
  });
}

export function formatInstallReport(assessment) {
  const lines = [
    "第三大脑 · 安装预检",
    "",
    `WPS 应用配置：${assessment.wpsConfigured ? "已填写，待验证审批发布与用户 OAuth" : "待配置"}`,
    `大模型配置：${assessment.llmConfigured ? "已填写，待验证连接" : "待配置"}`,
    "本地试用运行时已包含；WPS 审批、用户 OAuth 与模型连接仍需安装者真实验证。",
  ];

  if (assessment.missing.length > 0) {
    lines.push("", "请补充：", ...assessment.missing.map((item) => `- ${item.label}（${item.key}）`));
  }
  if (assessment.missingScopes.length > 0) {
    lines.push("", "首期缺少的 WPS 权限：", ...assessment.missingScopes.map((scope) => `- ${scope}`));
  }
  if (assessment.blockers.length > 0) {
    lines.push("", "需要处理：", ...assessment.blockers.map((item) => `- ${item.message}`));
  }

  lines.push("", assessment.nextAction, "", ...assessment.notes.map((note) => `说明：${note}`));
  return `${lines.join("\n")}\n`;
}

export { REQUIRED_WPS_SCOPES };
