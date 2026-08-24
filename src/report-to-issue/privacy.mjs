const TEXT_RULES = Object.freeze([
  {
    code: "github_token",
    expression: /\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{20,}\b/gu,
    replacement: "[GITHUB_TOKEN_REMOVED]",
  },
  {
    code: "wps_token",
    expression: /\bkso_(?:ac|rt)_[A-Za-z0-9._-]{12,}\b/gu,
    replacement: "[WPS_TOKEN_REMOVED]",
  },
  {
    code: "oauth_credential",
    expression: /\b(?:oauth[_ -]?code|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*[^\s,;]+/giu,
    replacement: "[OAUTH_CREDENTIAL_REMOVED]",
  },
  {
    code: "credential",
    expression: /\b(?:wps[_ -]?(?:app[_ -]?key|sid)|github[_ -]?token|api[_ -]?key|cookie|authorization|bearer)\s*[:=]?\s*[^\s,;]+/giu,
    replacement: "[CREDENTIAL_REMOVED]",
  },
  {
    code: "internal_link",
    expression: /\b[a-z][a-z0-9+.-]*:\/\/[^\s)\]}>]+/giu,
    replacement: "[LINK_REMOVED]",
  },
  {
    code: "absolute_path",
    expression: /(?:\/(?:Users|home|private|tmp|var)\/[^\s,;]+|[A-Za-z]:\\Users\\[^\s,;]+)/gu,
    replacement: "[LOCAL_PATH_REMOVED]",
  },
  {
    code: "environment_variable",
    expression: /(?:^|\n)[A-Z][A-Z0-9_]{1,63}\s*=\s*[^\s,;]+/gmu,
    replacement: "[ENVIRONMENT_VALUE_REMOVED]",
  },
  {
    code: "runtime_database_reference",
    expression: /\b[^\s/\\]*\.(?:db|sqlite|sqlite3)\b/giu,
    replacement: "[DATABASE_REFERENCE_REMOVED]",
  },
  {
    code: "stable_identifier",
    expression: /\b(?:session|conversation|chat|user|tenant)[_-]?id\s*[:=]\s*[A-Za-z0-9._-]{6,}/giu,
    replacement: "[STABLE_ID_REMOVED]",
  },
]);

function addFinding(findings, code, field) {
  const key = `${code}\0${field}`;
  if (!findings.some((item) => `${item.code}\0${item.field}` === key)) {
    findings.push(Object.freeze({ code, field, action: "removed_and_blocked" }));
  }
}

function sanitizeText(value, field, findings) {
  let result = String(value);
  for (const rule of TEXT_RULES) {
    rule.expression.lastIndex = 0;
    if (rule.expression.test(result)) {
      addFinding(findings, rule.code, field);
      rule.expression.lastIndex = 0;
      result = result.replace(rule.expression, rule.replacement);
    }
    rule.expression.lastIndex = 0;
  }
  return result;
}

function removeNarrative(report) {
  return {
    ...report,
    title: "Local report requires manual privacy review",
    reproductionSteps: ["Review the local-only report package."],
    expectedResult: "No private office content leaves the local environment.",
    actualResult: "[PRIVATE_CONTENT_REMOVED]",
  };
}

export function scanAndSanitizeReport(input) {
  const findings = [];
  let report = structuredClone(input.report);
  const classification = input.classification ?? {};

  if (classification.containsOfficeText === true) {
    addFinding(findings, "office_content", "report");
    report = removeNarrative(report);
  }
  if (classification.containsInternalInformation === true) {
    addFinding(findings, "internal_information", "report");
    report = removeNarrative(report);
  }
  if (classification.isSecurityOrPrivacyIssue === true && input.edition === "public") {
    addFinding(findings, "public_security_or_privacy_report", "report");
    report = removeNarrative(report);
  }

  report.title = sanitizeText(report.title, "report.title", findings);
  report.reproductionSteps = report.reproductionSteps.map((value, index) =>
    sanitizeText(value, `report.reproductionSteps[${index}]`, findings));
  report.expectedResult = sanitizeText(
    report.expectedResult,
    "report.expectedResult",
    findings,
  );
  report.actualResult = sanitizeText(report.actualResult, "report.actualResult", findings);
  report.diagnostics = Object.fromEntries(
    Object.entries(report.diagnostics).map(([key, value]) => [
      key,
      sanitizeText(value, `report.diagnostics.${key}`, findings),
    ]),
  );

  const attachments = [];
  for (const [index, attachment] of input.attachments.entries()) {
    if (attachment.userApproved !== true || attachment.privacyScanStatus !== "passed") {
      addFinding(findings, "attachment_not_approved_or_scanned", `attachments[${index}]`);
      continue;
    }
    if (/\.(?:db|sqlite|sqlite3)$/iu.test(attachment.name)) {
      addFinding(findings, "runtime_database", `attachments[${index}]`);
      continue;
    }
    const name = sanitizeText(attachment.name, `attachments[${index}].name`, findings);
    if (name.includes("[")) continue;
    attachments.push({ ...attachment, name });
  }

  return Object.freeze({
    report,
    attachments,
    status: findings.length === 0 ? "passed" : "blocked",
    findings: Object.freeze(findings),
  });
}
