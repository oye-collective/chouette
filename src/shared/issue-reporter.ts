const REPO_ISSUES_URL = "https://github.com/oye-collective/chouette/issues/new";

function detectBrowser(): string {
  const ua = navigator.userAgent;
  const edge = ua.match(/Edg\/(\d+)/);
  if (edge) return `Edge ${edge[1]}`;
  const opera = ua.match(/OPR\/(\d+)/);
  if (opera) return `Opera ${opera[1]}`;
  const chrome = ua.match(/Chrome\/(\d+)/);
  if (chrome) return `Chrome ${chrome[1]}`;
  return ua;
}

function detectOS(): string {
  const ua = navigator.userAgent;
  const mac = ua.match(/Mac OS X (\d+)[._](\d+)/);
  if (mac) return `macOS ${mac[1]}.${mac[2]}`;
  const win = ua.match(/Windows NT (\d+\.\d+)/);
  if (win) return `Windows ${win[1]}`;
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Linux/.test(ua)) return "Linux";
  return "Unknown";
}

export function buildReportIssueUrl(): string {
  const params = new URLSearchParams({
    template: "bug_report.yml",
    version: chrome.runtime.getManifest().version,
    browser: detectBrowser(),
    os: detectOS(),
  });
  return `${REPO_ISSUES_URL}?${params.toString()}`;
}
