const byId = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");
const request = async (url, options) => {
  const response = await fetch(url, options);
  const value = await response.json();
  if (!response.ok) throw new Error(value.message || value.error);
  return value;
};
const post = (url, body) => request(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const routePanels = {
  home: ["home"],
  decisions: ["decisions"],
  sources: ["sources", "sourceImport"],
  relationships: ["relationships"],
  settings: ["settings"],
};

for (const [route, ids] of Object.entries(routePanels)) {
  for (const id of ids) byId(id).dataset.routePanel = route;
}

function activeRoute() {
  const value = location.hash.slice(1) || "home";
  return routePanels[value] ? value : "home";
}

function renderRoute() {
  const active = activeRoute();
  for (const [route, ids] of Object.entries(routePanels)) {
    for (const id of ids) byId(id).hidden = route !== active;
  }
  document.querySelectorAll("[data-route-link]").forEach((link) => {
    link.setAttribute("aria-current", link.dataset.routeLink === active ? "page" : "false");
  });
}

function reportOutput(candidateId, html) {
  const output = byId("report-result-" + candidateId);
  output.hidden = false;
  output.innerHTML = html;
}

function draftControls(candidateId, draft, history) {
  const events = history?.history?.events || [];
  const revokedReceiptIds = new Set((history?.history?.revocations || []).map((revocation) => revocation.receiptId));
  const receipt = (history?.history?.confirmations || []).findLast((confirmation) =>
    confirmation.draftRevision === history.history.currentRevision
      && !revokedReceiptIds.has(confirmation.receiptId));
  const lifecycle = events.length
    ? "本地记录：" + events.map((event) => escapeHtml(event.type)).join(" → ")
    : "本地草稿尚未确认。";
  const revoke = receipt
    ? "<button class=\"secondary\" onclick=\"revokeReportConfirmation('" + candidateId + "','" + receipt.receiptId + "')\">撤销本地确认</button>"
    : "";
  return "<p>本地草稿 · r" + escapeHtml(draft.revision) + " · 外部提交：NOT_IMPLEMENTED</p>"
    + "<b>" + escapeHtml(draft.issue.title) + "</b><p>" + escapeHtml(draft.issue.body) + "</p>"
    + "<p class=\"workbench-note\">" + lifecycle + "</p><p>"
    + "<button class=\"secondary\" onclick=\"readReportHistory('" + candidateId + "','" + draft.id + "')\">查看历史</button> "
    + "<button class=\"secondary\" onclick=\"refreshReport('" + candidateId + "')\">刷新回读</button> " + revoke + "</p>"
    + "<div class=\"workbench-form\"><input id=\"correct-title-" + candidateId + "\" placeholder=\"更正后的本地报告标题\">"
    + "<textarea id=\"correct-body-" + candidateId + "\" placeholder=\"更正后的本地报告正文\"></textarea>"
    + "<button onclick=\"correctReport('" + candidateId + "','" + draft.id + "'," + draft.revision + ")\">保存本地更正</button></div>";
}

function candidateCard(candidate) {
  const conflict = candidate.conflictingClaims
    ? "<p class=\"workbench-note\">冲突说法：" + candidate.conflictingClaims
      .map((claim) => escapeHtml(claim.statement) + "（" + escapeHtml(claim.sourceLabel) + "）").join("；") + "</p>"
      + "<div class=\"workbench-form\"><input id=\"conflict-event-type-" + candidate.id + "\" placeholder=\"事件类型（必填）\">"
      + "<input id=\"conflict-business-statement-" + candidate.id + "\" placeholder=\"业务事实（必填）\">"
      + "<input id=\"conflict-occurred-at-" + candidate.id + "\" placeholder=\"发生时间 ISO UTC（必填）\">"
      + "<button onclick=\"confirmConflict('" + candidate.id + "')\">确认三字段裁决</button></div>"
    : "";
  return "<article class=\"workbench-card\"><h3>" + escapeHtml(candidate.title) + "</h3><p>"
    + escapeHtml(candidate.businessChange) + "</p><p class=\"workbench-note\">判读规则："
    + escapeHtml(candidate.rule) + "<br>类型：" + escapeHtml(candidate.eventType)
    + " · 时间：" + escapeHtml(candidate.occurredAt) + " · 合成人物：" + escapeHtml(candidate.actor)
    + "<br>来源：" + escapeHtml(candidate.sourceLabel) + " · 最小依据：" + escapeHtml(candidate.minimumEvidence)
    + "<br>待判断：" + escapeHtml(candidate.userDecision) + " · 推荐：" + escapeHtml(candidate.recommendation)
    + "</p><span class=\"pill " + (candidate.lineage.accepted === 7 ? "ok" : "") + "\">候选集谱系 "
    + candidate.lineage.accepted + "/" + candidate.lineage.expected + " · " + escapeHtml(candidate.lineage.status)
    + "</span>" + conflict + "<div class=\"workbench-form\"><input id=\"report-title-" + candidate.id
    + "\" placeholder=\"本地报告标题\"><textarea id=\"report-body-" + candidate.id
    + "\" placeholder=\"本地报告正文：不要写入办公原文、人员、凭证、内部链接或本机路径。\"></textarea>"
    + "<button onclick=\"draftReport('" + candidate.id + "')\">扫描并完整预览本地草稿</button></div>"
    + "<div id=\"report-result-" + candidate.id + "\" class=\"result\" hidden></div></article>";
}

async function renderWorkbench() {
  const workbench = await request("/api/public-workbench");
  byId("workbench").innerHTML = "<p class=\"workbench-label\">候选区 · 判读区 · 冲突确认区 · 仅本地报告区</p>"
    + workbench.candidates.map(candidateCard).join("");
  await Promise.all(workbench.candidates.map((candidate) => window.refreshReport(candidate.id)));
}

window.refreshReport=async (candidateId) => {
  try {
    const result = await request("/api/public-workbench/reports/latest?candidateId=" + encodeURIComponent(candidateId));
    const history = await request("/api/public-workbench/report-history?draftId=" + encodeURIComponent(result.draft.id));
    reportOutput(candidateId, draftControls(candidateId, result.draft, history));
  } catch (error) {
    if (error.message !== "no local report exists for this synthetic candidate") {
      reportOutput(candidateId, "<p class=\"error\">" + escapeHtml(error.message) + "</p>");
    }
  }
};

window.readReportHistory=async (candidateId, draftId) => {
  try {
    const result = await request("/api/public-workbench/report-history?draftId=" + encodeURIComponent(draftId));
    const events = result.history.events.map((event) => escapeHtml(event.type)).join(" → ") || "尚无历史";
    reportOutput(candidateId, "<p>本地生命周期：" + events + "</p><p>外部提交：NOT_IMPLEMENTED</p>"
      + "<button class=\"secondary\" onclick=\"refreshReport('" + candidateId + "')\">返回草稿并刷新回读</button>");
  } catch (error) {
    reportOutput(candidateId, "<p class=\"error\">" + escapeHtml(error.message) + "</p>");
  }
};

window.draftReport=async (candidateId) => {
  try {
    const result = await post("/api/public-workbench/reports", {
      candidateId,
      title: byId("report-title-" + candidateId).value,
      body: byId("report-body-" + candidateId).value,
    });
    if (result.draft.privacy.status !== "passed") {
      reportOutput(candidateId, "<p class=\"error\">隐私门禁未通过；原始内容未被保存或返回。</p>");
      return;
    }
    reportOutput(candidateId, "<p>隐私门禁通过。完整预览：</p><b>" + escapeHtml(result.preview.title)
      + "</b><p>" + escapeHtml(result.preview.body) + "</p><button onclick=\"confirmReport('" + candidateId
      + "','" + result.draft.id + "','" + result.draft.previewDigest + "')\">我已完整检查，仅确认本地草稿</button>");
  } catch (error) {
    reportOutput(candidateId, "<p class=\"error\">" + escapeHtml(error.message) + "</p>");
  }
};

window.confirmReport=async (candidateId, draftId, previewDigest) => {
  try {
    await post("/api/public-workbench/reports/confirm", {
      draftId,
      previewDigest,
      acknowledgement: "CONFIRM_LOCAL_DRAFT",
    });
    await window.refreshReport(candidateId);
  } catch (error) {
    reportOutput(candidateId, "<p class=\"error\">" + escapeHtml(error.message) + "</p>");
  }
};

window.correctReport=async (candidateId, draftId, expectedRevision) => {
  try {
    await post("/api/public-workbench/reports/correct", {
      candidateId,
      draftId,
      expectedRevision,
      title: byId("correct-title-" + candidateId).value,
      body: byId("correct-body-" + candidateId).value,
    });
    await window.refreshReport(candidateId);
  } catch (error) {
    reportOutput(candidateId, "<p class=\"error\">" + escapeHtml(error.message) + "</p>");
  }
};

window.revokeReportConfirmation=async (candidateId, receiptId) => {
  try {
    await post("/api/public-workbench/reports/revoke", { receiptId });
    await window.refreshReport(candidateId);
  } catch (error) {
    reportOutput(candidateId, "<p class=\"error\">" + escapeHtml(error.message) + "</p>");
  }
};

window.confirmConflict=async (candidateId) => {
  try {
    await post("/api/public-workbench/conflicts", {
      candidateId,
      eventType: byId("conflict-event-type-" + candidateId).value,
      businessStatement: byId("conflict-business-statement-" + candidateId).value,
      occurredAt: byId("conflict-occurred-at-" + candidateId).value,
    });
    await renderWorkbench();
  } catch (error) {
    alert(error.message);
  }
};

async function refreshStatus() {
  const status = await request("/api/status");
  byId("status").innerHTML = "<span class=\"pill " + (status.configured ? "ok" : "") + "\">配置"
    + (status.configured ? "完成" : "缺失") + "</span><span class=\"pill "
    + (status.wpsAuthorized ? "ok" : "") + "\">WPS" + (status.wpsAuthorized ? "已授权" : "未授权")
    + "</span><span class=\"pill " + (status.importedMessages && status.importComplete ? "ok" : "") + "\">"
    + (status.importedMessages || 0) + " 条本地消息" + (status.importedMessages && !status.importComplete ? "（不完整）" : "") + "</span>";
}

byId("navToggle").onclick = () => {
  const navigation = byId("workbenchNav");
  navigation.classList.toggle("open");
  byId("navToggle").setAttribute("aria-expanded", String(navigation.classList.contains("open")));
};
document.querySelectorAll(".workbench-nav a").forEach((link) => {
  link.onclick = (event) => {
    event.preventDefault();
    location.hash = link.dataset.routeLink;
    byId("workbenchNav").classList.remove("open");
  };
});
byId("authorize").onclick = async () => {
  try {
    location.href = (await post("/oauth/wps/start", {})).url;
  } catch (error) {
    alert(error.message);
  }
};
byId("load").onclick = async () => {
  try {
    const result = await request("/api/chats");
    const chats = result.chats || [];
    byId("chats").innerHTML = chats.map((chat) => "<label class=\"chat\"><input type=\"checkbox\" value=\""
      + escapeHtml(chat.id) + "\"><span><b>" + escapeHtml(chat.name) + "</b><br><small>"
      + escapeHtml(chat.type) + "</small></span></label>").join("") || "<p>没有读取到群聊。</p>";
    byId("import").disabled = !chats.length;
  } catch (error) {
    byId("chats").innerHTML = "<p class=\"error\">" + escapeHtml(error.message) + "</p>";
  }
};
byId("import").onclick = async () => {
  const chatIds = [...document.querySelectorAll("#chats input:checked")].map((item) => item.value);
  try {
    const result = await post("/api/import", { chatIds, days: Number(byId("days").value) });
    byId("importResult").textContent = "已加密保存 " + result.messageCount + " 条本地消息。";
    await refreshStatus();
  } catch (error) {
    byId("importResult").textContent = error.message;
  }
};

addEventListener("hashchange", renderRoute);
addEventListener("popstate", renderRoute);
async function initializeWorkbench() {
  renderRoute();
  await refreshStatus();
  await renderWorkbench();
}
void initializeWorkbench();
