// background.js — MV3 service worker
importScripts("lib/api.js");

const BADGE_COLORS = {
  low: "#1FAE84",
  suspicious: "#E3A008",
  high: "#D93636",
  unknown: "#8A94A6",
};
const BADGE_TEXT = {
  low: "OK",
  suspicious: "!",
  high: "!!",
  unknown: "",
};

// tabId -> { url, result, checkedAt }
const tabResults = new Map();

function isCheckableUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

async function setBadgeForTab(tabId, riskLevel) {
  const level = riskLevel && BADGE_COLORS[riskLevel] ? riskLevel : "unknown";
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLORS[level] });
    await chrome.action.setBadgeText({ tabId, text: level === "unknown" ? "" : BADGE_TEXT[level] });
  } catch (_err) {
    // tab may have closed mid-flight; ignore
  }
}

async function clearBadgeForTab(tabId) {
  try {
    await chrome.action.setBadgeText({ tabId, text: "" });
  } catch (_err) {
    /* ignore */
  }
}

async function runUrlCheck(tabId, url) {
  try {
    const result = await self.ScamcheckApi.checkContent({ type: "url", content: url });
    tabResults.set(tabId, { url, result, checkedAt: Date.now() });
    await setBadgeForTab(tabId, result.riskLevel);
    return result;
  } catch (err) {
    tabResults.set(tabId, { url, result: null, error: err.message, checkedAt: Date.now() });
    if (err.code !== "not_configured") {
      await setBadgeForTab(tabId, "unknown");
    } else {
      await clearBadgeForTab(tabId);
    }
    throw err;
  }
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!isCheckableUrl(tab.url)) {
    await clearBadgeForTab(tabId);
    return;
  }

  const settings = await self.ScamcheckApi.getSettings();
  if (!settings.autoCheckPages || !self.ScamcheckApi.normalizeBaseUrl(settings.apiBaseUrl)) {
    await clearBadgeForTab(tabId);
    return;
  }

  const cached = tabResults.get(tabId);
  if (cached && cached.url === tab.url) return; // avoid duplicate work on same URL

  await clearBadgeForTab(tabId); // neutral while checking
  runUrlCheck(tabId, tab.url).catch(() => {
    /* already handled/badged in runUrlCheck */
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabResults.delete(tabId);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SCAMCHECK_GET_TAB_RESULT") {
    const entry = tabResults.get(message.tabId) || null;
    sendResponse({ ok: true, entry });
    return false;
  }

  if (message?.type === "SCAMCHECK_FORCE_RECHECK") {
    const { tabId, url } = message;
    runUrlCheck(tabId, url)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: err.message, code: err.code }));
    return true; // async response
  }

  return false;
});
