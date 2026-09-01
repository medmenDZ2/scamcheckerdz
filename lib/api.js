// lib/api.js
// Thin client for the SCAMCHECK backend. Loaded via <script> in popup/options
// and via importScripts() in the background service worker, so it must stay
// dependency-free, synchronous-safe, and attach itself to `self`.

const DEFAULT_SETTINGS = {
  apiBaseUrl: "https://scamcheck-backend-production.up.railway.app",
  apiKey: "",           // sent as Authorization: Bearer <key>, optional
  autoCheckPages: true, // background badges every navigated page
};

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function saveSettings(partial) {
  await chrome.storage.sync.set(partial);
}

function normalizeBaseUrl(url) {
  return (url || "").trim().replace(/\/+$/, "");
}

class ApiError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code || "unknown_error";
  }
}

/**
 * POST {baseUrl}/v1/check
 *
 * Request body:
 * {
 *   "type": "url" | "text",
 *   "content": "<the url or the raw text/message>",
 *   "pageContext": {              // optional, only present for on-page checks
 *     "url": "https://...",
 *     "title": "...",
 *     "metaDescription": "...",
 *     "excerptText": "...",       // truncated visible page text
 *     "links": [{ "href": "...", "text": "..." }],
 *     "forms": [{ "action": "...", "hasPasswordField": true }]
 *   }
 * }
 *
 * Response body:
 * {
 *   "riskLevel": "low" | "suspicious" | "high",
 *   "summary": "One or two sentence explanation.",
 *   "warningSigns": ["Creates urgency", "Requests sensitive information"],
 *   "evidence": [{ "quote": "...", "reason": "Urgency/manipulation" }],
 *   "recommendedActions": {
 *     "avoid": ["Don't click the link", "Don't send money"],
 *     "do": ["Contact the company through its official website"]
 *   },
 *   "category": "phishing",       // optional, one of the taxonomy in the spec
 *   "confidence": 0.82            // optional, 0-1
 * }
 *
 * On insufficient information the backend should still return riskLevel
 * "low" or a distinct "unknown" plus a summary saying so — never fabricate
 * evidence. The client treats any riskLevel other than
 * low/suspicious/high as "unknown" and renders it neutrally.
 */
async function checkContent({ type, content, pageContext }) {
  const settings = await getSettings();
  const base = normalizeBaseUrl(settings.apiBaseUrl);

  if (!base) {
    throw new ApiError(
      "No backend configured yet. Open SCAMCHECK settings and add your API URL.",
      "not_configured"
    );
  }

  const headers = { "Content-Type": "application/json" };
  if (settings.apiKey) headers["Authorization"] = `Bearer ${settings.apiKey}`;

  let res;
  try {
    res = await fetch(`${base}/v1/check`, {
      method: "POST",
      headers,
      body: JSON.stringify({ type, content, pageContext }),
    });
  } catch (err) {
    throw new ApiError(
      "Couldn't reach the SCAMCHECK backend. Check the API URL and your connection.",
      "network_error"
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new ApiError("The backend rejected the API key.", "auth_error");
  }
  if (res.status === 429) {
    throw new ApiError("Rate limit reached — try again shortly.", "rate_limited");
  }
  if (!res.ok) {
    throw new ApiError(`Backend returned an error (${res.status}).`, "server_error");
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    throw new ApiError("Backend response wasn't valid JSON.", "bad_response");
  }

  return normalizeResult(data);
}

async function checkHealth() {
  const settings = await getSettings();
  const base = normalizeBaseUrl(settings.apiBaseUrl);
  if (!base) throw new ApiError("No backend configured yet.", "not_configured");

  const headers = {};
  if (settings.apiKey) headers["Authorization"] = `Bearer ${settings.apiKey}`;

  let res;
  try {
    res = await fetch(`${base}/v1/health`, { headers });
  } catch (err) {
    throw new ApiError("Couldn't reach the backend.", "network_error");
  }
  if (!res.ok) throw new ApiError(`Backend returned ${res.status}.`, "server_error");
  return true;
}

const VALID_LEVELS = new Set(["low", "suspicious", "high"]);

function normalizeResult(data) {
  const riskLevel = VALID_LEVELS.has(data?.riskLevel) ? data.riskLevel : "unknown";
  return {
    riskLevel,
    summary: typeof data?.summary === "string" ? data.summary : "",
    warningSigns: Array.isArray(data?.warningSigns) ? data.warningSigns.slice(0, 12) : [],
    evidence: Array.isArray(data?.evidence)
      ? data.evidence
          .filter((e) => e && typeof e.quote === "string")
          .slice(0, 8)
      : [],
    recommendedActions: {
      avoid: Array.isArray(data?.recommendedActions?.avoid)
        ? data.recommendedActions.avoid.slice(0, 8)
        : [],
      do: Array.isArray(data?.recommendedActions?.do)
        ? data.recommendedActions.do.slice(0, 8)
        : [],
    },
    category: typeof data?.category === "string" ? data.category : null,
    confidence: typeof data?.confidence === "number" ? data.confidence : null,
  };
}

// Expose on self so both window (popup/options) and the service worker
// (importScripts) can reach these without module bundling.
self.ScamcheckApi = {
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  normalizeBaseUrl,
  checkContent,
  checkHealth,
  ApiError,
};
