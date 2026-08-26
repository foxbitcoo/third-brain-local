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
  decisions: ["analysisPanel", "decisions"],
  history: ["history"],
  sources: ["sources", "sourceImport"],
  relationships: ["relationships"],
  settings: ["settings"],
  report: ["report"],
};

let currentWorkspace = null;
let currentReport = null;

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
  requestAnimationFrame(() => byId(active)?.scrollIntoView({ block: "start" }));
}

function decisionFor(candidateId) {
  return (currentWorkspace?.analysis?.decisions || []).find((item) => item.candidateId === candidateId);
}

function ownershipFor(candidateId) {
  return (currentWorkspace?.analysis?.ownershipDrafts || []).find((item) => item.candidateId === candidateId);
}

function renderEvidence(evidence) {
  if (!evidence?.length) return "<div class=\"error\">没有可回查 Evidence，请不要确认。</div>";
  return "<div class=\"evidence-list\">" + evidence.map((item) => (
    "<div class=\"evidence\"><b>" + escapeHtml(item.display?.sourceName || "已选择来源")
    + "</b> · " + escapeHtml(item.occurredAt) + "<br>"
    + escapeHtml(item.display?.senderName || "身份待映射") + "："
    + escapeHtml(item.excerpt) + "</div>"
  )).join("") + "</div>";
}

function candidateCard(candidate) {
  const decision = decisionFor(candidate.candidateId);
  const ownership = ownershipFor(candidate.candidateId);
  const threadChoices = (currentWorkspace.workThreads || []).map((thread) => (
    "<label class=\"choice\"><input type=\"radio\" name=\"ownership-" + candidate.candidateId
    + "\" value=\"existing_work_thread\" data-thread-id=\"" + escapeHtml(thread.threadId) + "\""
    + (ownership?.kind === "existing_work_thread" && ownership.threadId === thread.threadId ? " checked" : "")
    + "><span><b>并入现有工作</b>" + escapeHtml(thread.title) + "</span></label>"
  )).join("");
  const status = decision ? "已判断" : ownership ? "已确认归属，待判断重要性" : "需要你判断";
  return "<article class=\"candidate-card " + (decision ? "" : "pending") + "\" data-candidate-id=\""
    + escapeHtml(candidate.candidateId) + "\"><div class=\"candidate-meta\"><span class=\"pill "
    + (decision ? "ok" : "pending") + "\">" + status + "</span><span class=\"pill\">"
    + escapeHtml((candidate.strategies || []).join(" + ")) + " 路径</span><span class=\"pill\">"
    + escapeHtml(candidate.latestOccurredAt) + "</span></div><h3>" + escapeHtml(candidate.title)
    + "</h3><p class=\"latest\">" + escapeHtml(candidate.latestChange) + "</p>"
    + "<div class=\"candidate-section\"><b>背景与上下文</b><span>" + escapeHtml(candidate.background) + "</span></div>"
    + "<div class=\"candidate-section\"><b>AI 无法确定的点</b><span>" + escapeHtml(candidate.uncertainty) + "</span></div>"
    + "<div class=\"candidate-section\"><b>需要你判断</b><span>" + escapeHtml(candidate.userDecision) + "</span></div>"
    + "<details class=\"candidate-section\"><summary><b>查看最少必要原文</b></summary>" + renderEvidence(candidate.evidence) + "</details>"
    + "<fieldset><legend>第一步 · 工作归属</legend><div class=\"choice-grid\">" + threadChoices
    + "<label class=\"choice\"><input type=\"radio\" name=\"ownership-" + candidate.candidateId
    + "\" value=\"new_work_thread\"" + (ownership?.kind === "new_work_thread" ? " checked" : "")
    + "><span><b>建立新工作</b><input data-new-thread-title=\"" + candidate.candidateId + "\" maxlength=\"120\" placeholder=\"工作标题\" value=\""
    + escapeHtml(ownership?.kind === "new_work_thread" ? ownership.threadTitle : candidate.title) + "\"></span></label>"
    + "<label class=\"choice\"><input type=\"radio\" name=\"ownership-" + candidate.candidateId
    + "\" value=\"not_current_work\"" + (ownership?.kind === "not_current_work" ? " checked" : "")
    + "><span><b>不纳入当前工作</b>仍保留判断记录</span></label></div>"
    + "<div class=\"decision-actions\"><button class=\"secondary\" data-save-ownership=\"" + candidate.candidateId + "\">保存工作归属</button></div></fieldset>"
    + "<fieldset><legend>第二步 · 业务重要性</legend><div class=\"decision-actions\">"
    + [["current_important", "作为重要事项跟进"], ["related", "相关，但暂不作为重点"], ["uncertain", "继续观察"], ["noise", "噪声"]]
      .map(([key, label]) => "<button class=\"" + (key === "current_important" ? "blue" : "secondary")
        + "\" data-save-importance=\"" + candidate.candidateId + "\" data-importance=\"" + key + "\""
        + (!ownership ? " disabled" : "") + ">" + label + "</button>").join("")
    + "</div>" + (decision ? "<p class=\"workbench-note\">已保存：" + escapeHtml(decision.importance)
      + (decision.ripple?.currentStateChanged ? " · 已更新本机当前状态" : " · 未改变当前状态") + "</p>" : "")
    + "</fieldset></article>";
}

function sortedCandidates() {
  return [...(currentWorkspace?.analysis?.candidates || [])].sort((left, right) => {
    const leftResolved = decisionFor(left.candidateId) ? 1 : 0;
    const rightResolved = decisionFor(right.candidateId) ? 1 : 0;
    return leftResolved - rightResolved
      || right.latestOccurredAt.localeCompare(left.latestOccurredAt)
      || left.candidateId.localeCompare(right.candidateId);
  });
}

function renderHistory() {
  const threads = new Map((currentWorkspace?.workThreads || []).map((item) => [item.threadId, item]));
  const states = new Map((currentWorkspace?.currentStates || []).map((item) => [item.sourceWorkEventId, item]));
  const events = [...(currentWorkspace?.workEvents || [])]
    .filter((event) => event?.eventType === "user_confirmed_change" && states.has(event.workEventId))
    .toSorted((left, right) => String(right.occurredAt).localeCompare(String(left.occurredAt)));
  byId("historyList").innerHTML = events.length
    ? events.map((event) => {
      const thread = threads.get(event.threadId);
      const state = states.get(event.workEventId);
      return "<article class=\"history-card\"><div class=\"candidate-meta\"><span class=\"pill ok\">已确认</span><span class=\"pill\">"
        + escapeHtml(event.occurredAt) + "</span><span class=\"pill\">Current State r"
        + escapeHtml(state.revision) + "</span></div><h3>" + escapeHtml(thread?.title || "已确认工作")
        + "</h3><p class=\"latest\">" + escapeHtml(event.businessStatement) + "</p><p><b>当前状态：</b>"
        + escapeHtml(state.latestChange) + "</p><p><b>下一步：</b>" + escapeHtml(state.nextAction)
        + "</p><p><small>本机确认写入：" + escapeHtml(state.updatedAt) + "</small></p></article>";
    }).join("")
    : "<div class=\"empty\">还没有可回顾的本机确认记录。完成“工作归属 → 重要性”确认后，真实变化会显示在这里。</div>";
}

function renderWorkspace() {
  const candidates = sortedCandidates();
  const pending = candidates.filter((item) => !decisionFor(item.candidateId)).length;
  byId("decisionCount").textContent = String(pending);
  byId("homeDecisionSummary").textContent = pending ? pending + " 项需要确认" : "没有待判断事项";
  byId("homeSourceSummary").textContent = (currentWorkspace?.sources || []).length
    ? currentWorkspace.sources.length + " 个已选来源 · " + currentWorkspace.messageCount + " 条消息"
    : "等待安装者选择";
  byId("workbench").innerHTML = candidates.length
    ? candidates.map(candidateCard).join("")
    : "<div class=\"empty\">还没有候选。先选择来源、完整导入，再显式触发 B/C 分析。</div>";
  const states = currentWorkspace?.currentStates || [];
  byId("currentStates").innerHTML = states.length
    ? states.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)).map((state) => (
      "<article class=\"state-card\"><h3>" + escapeHtml((currentWorkspace.workThreads || []).find((item) => item.threadId === state.threadId)?.title || "已确认工作")
      + "</h3><p class=\"latest\">" + escapeHtml(state.latestChange) + "</p><p>" + escapeHtml(state.background)
      + "</p><p><b>下一步：</b>" + escapeHtml(state.nextAction) + "</p><small>更新时间：" + escapeHtml(state.updatedAt) + "</small></article>"
    )).join("")
    : "<div class=\"empty\">还没有经你确认的工作变化。</div>";
  renderHistory();
  document.querySelectorAll("[data-save-ownership]").forEach((button) => { button.onclick = saveOwnership; });
  document.querySelectorAll("[data-save-importance]").forEach((button) => { button.onclick = saveImportance; });
}

async function refreshWorkspace() {
  currentWorkspace = await request("/api/workspace");
  renderWorkspace();
}

async function saveOwnership(event) {
  const candidateId = event.currentTarget.dataset.saveOwnership;
  const selected = document.querySelector('input[name="ownership-' + candidateId + '"]:checked');
  if (!selected) return alert("请先选择工作归属");
  const body = { candidateId, kind: selected.value };
  if (selected.value === "existing_work_thread") body.threadId = selected.dataset.threadId;
  if (selected.value === "new_work_thread") body.threadTitle = document.querySelector('[data-new-thread-title="' + candidateId + '"]').value;
  try {
    await post("/api/decisions/ownership", body);
    await refreshWorkspace();
  } catch (error) {
    alert(error.message);
  }
}

async function saveImportance(event) {
  try {
    await post("/api/decisions/importance", {
      candidateId: event.currentTarget.dataset.saveImportance,
      importance: event.currentTarget.dataset.importance,
    });
    await refreshWorkspace();
  } catch (error) {
    alert(error.message);
  }
}

async function refreshStatus() {
  const status = await request("/api/status");
  byId("status").innerHTML = "<span class=\"pill " + (status.configured ? "ok" : "") + "\">配置"
    + (status.configured ? "完成" : "缺失") + "</span><span class=\"pill "
    + (status.wpsAuthorized ? "ok" : "") + "\">WPS" + (status.wpsAuthorized ? "已授权" : "未授权")
    + "</span><span class=\"pill " + (status.importedMessages && status.importComplete ? "ok" : "") + "\">"
    + (status.importedMessages || 0) + " 条本地消息" + (status.importedMessages && !status.importComplete ? "（不完整）" : "") + "</span>";
  byId("analyze").disabled = !status.importedMessages || !status.importComplete;
}

byId("navToggle").onclick = () => {
  const navigation = byId("workbenchNav");
  navigation.classList.toggle("open");
  byId("navToggle").setAttribute("aria-expanded", String(navigation.classList.contains("open")));
};
function closeMobileNavigation() {
  byId("workbenchNav").classList.remove("open");
  byId("navToggle").setAttribute("aria-expanded", "false");
}
document.querySelectorAll(".workbench-nav a").forEach((link) => {
  link.onclick = (event) => {
    event.preventDefault();
    location.hash = link.dataset.routeLink;
    closeMobileNavigation();
  };
});
byId("authorize").onclick = async () => {
  try { location.href = (await post("/oauth/wps/start", {})).url; }
  catch (error) { alert(error.message); }
};
byId("load").onclick = async () => {
  try {
    const result = await request("/api/chats");
    const chats = result.chats || [];
    const completeness = result.completeness?.complete ? "" : "<p class=\"error\">会话清单未完整：" + escapeHtml(result.completeness?.reason) + "</p>";
    byId("chats").innerHTML = completeness + (chats.map((chat) => (
      "<label class=\"chat\"><input type=\"checkbox\" value=\"" + escapeHtml(chat.id) + "\"><span><b>"
      + escapeHtml(chat.name || "未命名来源") + "</b><br><span class=\"chat-kind\">"
      + (chat.conversationKind === "direct" ? "私聊" : "群聊") + "</span></span></label>"
    )).join("") || "<p>没有读取到支持的私聊或群聊。</p>");
    byId("import").disabled = !chats.length;
  } catch (error) {
    byId("chats").innerHTML = "<p class=\"error\">" + escapeHtml(error.message) + "</p>";
  }
};
byId("import").onclick = async () => {
  const chatIds = [...document.querySelectorAll("#chats input:checked")].map((item) => item.value);
  try {
    const result = await post("/api/import", { chatIds, days: Number(byId("days").value) });
    const completeness = result.complete ? "完整" : "存在截断，已禁止分析";
    byId("importResult").innerHTML = "<p>已在本机加密保存 " + escapeHtml(result.messageCount) + " 条 · " + completeness + "</p>"
      + (result.sources || []).map((source) => "<small>" + escapeHtml(source.chatName || "已选来源") + " · "
        + (source.conversationKind === "direct" ? "私聊" : "群聊") + " · " + escapeHtml(source.messageCount) + " 条</small><br>").join("");
    await Promise.all([refreshStatus(), refreshWorkspace()]);
  } catch (error) { byId("importResult").textContent = error.message; }
};
byId("analyze").onclick = async () => {
  const output = byId("analysisSummary");
  try {
    output.hidden = false;
    output.textContent = "B/C 双路径分析中…";
    const result = await post("/api/analyze", {});
    output.textContent = result.summary || "分析完成";
    await refreshWorkspace();
  } catch (error) { output.textContent = error.message; }
};

byId("createReport").onclick = async () => {
  try {
    currentReport = await post("/api/reports", {
      title: byId("reportTitle").value,
      body: byId("reportBody").value,
      attachments: [],
    });
    byId("reportPreview").hidden = false;
    byId("reportPreview").innerHTML = "<h3>完整本地预览</h3><p><b>目标：</b>" + escapeHtml(currentReport.target.repository)
      + "</p><p><b>标题：</b>" + escapeHtml(currentReport.issue.title) + "</p><pre>" + escapeHtml(currentReport.issue.body)
      + "</pre><p><b>隐私状态：</b>" + escapeHtml(currentReport.privacy.status) + "</p><p><b>外部写入：</b>NOT_RUN</p>";
    byId("confirmReport").disabled = currentReport.privacy.status !== "passed";
  } catch (error) { alert(error.message); }
};
byId("confirmReport").onclick = async () => {
  if (!currentReport) return;
  try {
    const receipt = await post("/api/reports/confirm", {
      draftId: currentReport.draftId,
      previewDigest: currentReport.previewDigest,
      githubLogin: byId("githubLogin").value,
    });
    byId("reportReceipt").hidden = false;
    byId("reportReceipt").textContent = "本地确认回执已保存\n状态：" + receipt.status
      + "\n绑定摘要：" + receipt.bindingDigest + "\nGitHub Issue：NOT_RUN";
  } catch (error) { alert(error.message); }
};

addEventListener("hashchange", renderRoute);
addEventListener("popstate", renderRoute);
async function initializeWorkbench() {
  renderRoute();
  await Promise.all([refreshStatus(), refreshWorkspace()]);
}
void initializeWorkbench();
