export class ReportToIssueError extends Error { constructor(code, message) { super(message); this.name = "ReportToIssueError"; this.code = code; } }
