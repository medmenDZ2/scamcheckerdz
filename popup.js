const LEVEL_LABEL = {
  low: "Low risk",
  suspicious: "Suspicious",
  high: "High risk",
  unknown: "Not sure",
};

const els = {
  settingsBtn: document.getElementById("settingsBtn"),
  configBanner: document.getElementById("configBanner"),
  configBannerLink: document.getElementById("configBannerLink"),
  siteDomain: document.getElementById("siteDomain"),
  siteStatusChip: document.getElementById("siteStatusChip"),
  siteSummary: document.getElementById("siteSummary"),
  siteDetails: document.getElementById("siteDetails"),
  checkSiteBtn: document.getElementById("checkSiteBtn"),
  fullCheckBtn: document.getElementById("fullCheckBtn"),
  manualInput: document.getElementById("manualInput"),
  manualCheckBtn: document.getElementById("manualCheckBtn"),
  manualDetails: document.getElementById("manualDetails"),
  qrUploadBtn: document.getElementById("qrUploadBtn"),
  qrCameraBtn: document.getElementById("qrCameraBtn"),
  qrFileInput: document.getElementById("qrFileInput"),
  qrDetails: document.getElementById("qrDetails"),
  qrPaywall: document.getElementById("qrPaywall"),
};

let activeTab = null;

els.settingsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
els.configBannerLink.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

function setChip(level) {
  els.siteStatusChip.dataset.level = level;
  els.siteStatusChip.textContent = LEVEL_LABEL[level] || LEVEL_LABEL.unknown;
}

function renderDetails(container, result) {
  container.innerHTML = "";
  if (!result) return;

  const parts = [];

  if (result.warningSigns?.length) {
    parts.push(`<h3>Warning signs</h3><ul>${result.warningSigns
      .map((w) => `<li>${escapeHtml(w)}</li>`)
      .join("")}</ul>`);
  }

  if (result.evidence?.length) {
    parts.push(
      `<h3>Evidence</h3>${result.evidence
        .map(
          (e) =>
            `<div class="evidence-item"><p class="evidence-quote">"${escapeHtml(
              e.quote
            )}"</p>${e.reason ? `<p class="evidence-reason">${escapeHtml(e.reason)}</p>` : ""}</div>`
        )
        .join("")}`
    );
  }

  if (result.recommendedActions?.avoid?.length) {
    parts.push(
      `<h3>Don't</h3><ul class="avoid-list">${result.recommendedActions.avoid
        .map((a) => `<li>${escapeHtml(a)}</li>`)
        .join("")}</ul>`
    );
  }

  if (result.recommendedActions?.do?.length) {
    parts.push(
      `<h3>Do</h3><ul class="do-list">${result.recommendedActions.do
        .map((a) => `<li>${escapeHtml(a)}</li>`)
        .join("")}</ul>`
    );
  }

  if (!parts.length) {
    container.classList.add("hidden");
    return;
  }
  container.innerHTML = parts.join("");
  container.classList.remove("hidden");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function showError(scope, message) {
  const note = document.createElement("p");
  note.className = "error-note";
  note.textContent = message;
  const targets = { site: els.siteDetails, manual: els.manualDetails, qr: els.qrDetails };
  const target = targets[scope] || els.manualDetails;
  if (scope === "site") els.siteSummary.textContent = "";
  target.classList.remove("hidden");
  target.innerHTML = "";
  target.appendChild(note);
}

async function refreshConfigBanner() {
  const settings = await self.ScamcheckApi.getSettings();
  const configured = !!self.ScamcheckApi.normalizeBaseUrl(settings.apiBaseUrl);
  els.configBanner.classList.toggle("hidden", configured);
  els.checkSiteBtn.disabled = !configured;
  els.manualCheckBtn.disabled = !configured;
  return configured;
}

async function loadActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab;
  if (!tab?.url || !/^https?:\/\//i.test(tab.url)) {
    els.siteDomain.textContent = "Not a checkable page";
    els.checkSiteBtn.disabled = true;
    els.fullCheckBtn.classList.add("hidden");
    return;
  }
  try {
    els.siteDomain.textContent = new URL(tab.url).hostname;
  } catch {
    els.siteDomain.textContent = tab.url;
  }

  chrome.runtime.sendMessage({ type: "SCAMCHECK_GET_TAB_RESULT", tabId: tab.id }, (resp) => {
    const entry = resp?.entry;
    if (entry?.result) {
      setChip(entry.result.riskLevel);
      els.siteSummary.textContent = entry.result.summary || "";
      renderDetails(els.siteDetails, entry.result);
      els.fullCheckBtn.classList.remove("hidden");
    } else if (entry?.error) {
      setChip("unknown");
      showError("site", entry.error);
    }
  });
}

async function checkSite(fullCheck) {
  if (!activeTab?.id || !activeTab?.url) return;
  const btn = fullCheck ? els.fullCheckBtn : els.checkSiteBtn;
  btn.disabled = true;
  btn.textContent = fullCheck ? "Checking…" : "Checking…";
  setChip("unknown");
  els.siteSummary.textContent = "";
  els.siteDetails.classList.add("hidden");

  try {
    let result;
    if (fullCheck) {
      const ctxResp = await chrome.tabs
        .sendMessage(activeTab.id, { type: "SCAMCHECK_GET_PAGE_CONTEXT" })
        .catch(() => null);
      const pageContext = ctxResp?.ok ? ctxResp.context : undefined;
      result = await self.ScamcheckApi.checkContent({
        type: "url",
        content: activeTab.url,
        pageContext,
      });
      chrome.runtime.sendMessage({
        type: "SCAMCHECK_FORCE_RECHECK",
        tabId: activeTab.id,
        url: activeTab.url,
      });
    } else {
      const resp = await new Promise((resolve) =>
        chrome.runtime.sendMessage(
          { type: "SCAMCHECK_FORCE_RECHECK", tabId: activeTab.id, url: activeTab.url },
          resolve
        )
      );
      if (!resp?.ok) throw new (self.ScamcheckApi.ApiError)(resp?.error || "Check failed", resp?.code);
      result = resp.result;
    }

    setChip(result.riskLevel);
    els.siteSummary.textContent = result.summary || "";
    renderDetails(els.siteDetails, result);
    els.fullCheckBtn.classList.remove("hidden");
  } catch (err) {
    setChip("unknown");
    showError("site", err.message || "Something went wrong.");
  } finally {
    els.checkSiteBtn.disabled = false;
    els.fullCheckBtn.disabled = false;
    els.checkSiteBtn.textContent = "Recheck this page";
    els.fullCheckBtn.textContent = "Full check";
  }
}

function looksLikeUrl(text) {
  const t = text.trim();
  return /^https?:\/\//i.test(t) || /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(t);
}

async function checkManualInput() {
  const raw = els.manualInput.value.trim();
  if (!raw) return;

  els.manualCheckBtn.disabled = true;
  els.manualCheckBtn.textContent = "Checking…";
  els.manualDetails.classList.add("hidden");

  try {
    const type = looksLikeUrl(raw) ? "url" : "text";
    const content = type === "url" && !/^https?:\/\//i.test(raw) ? `https://${raw}` : raw;
    const result = await self.ScamcheckApi.checkContent({ type, content });

    els.manualDetails.classList.remove("hidden");
    const summary = document.createElement("p");
    summary.className = "summary";
    summary.style.marginTop = "0";
    const chip = document.createElement("span");
    chip.className = "status-chip";
    chip.dataset.level = result.riskLevel;
    chip.textContent = LEVEL_LABEL[result.riskLevel] || LEVEL_LABEL.unknown;

    els.manualDetails.innerHTML = "";
    els.manualDetails.appendChild(chip);
    summary.textContent = result.summary || "";
    els.manualDetails.appendChild(summary);

    const rest = document.createElement("div");
    renderDetails(rest, result);
    els.manualDetails.appendChild(rest);
  } catch (err) {
    showError("manual", err.message || "Something went wrong.");
  } finally {
    els.manualCheckBtn.disabled = false;
    els.manualCheckBtn.textContent = "Check now";
  }
}

els.checkSiteBtn.addEventListener("click", () => checkSite(false));
els.fullCheckBtn.addEventListener("click", () => checkSite(true));
els.manualCheckBtn.addEventListener("click", checkManualInput);

// ---- QR code: paywall gate ----------------------------------------------
function showQrPaywall(message) {
  els.qrPaywall.classList.remove("hidden");
  els.qrPaywall.innerHTML = "";

  const note = document.createElement("p");
  note.className = "summary";
  note.style.margin = "0 0 8px";
  note.textContent = message;
  els.qrPaywall.appendChild(note);

  const row = document.createElement("div");
  row.className = "actions";
  row.style.marginTop = "0";
  const btn = document.createElement("button");
  btn.className = "btn btn-primary";
  btn.textContent = "Unlock QR checking";
  btn.addEventListener("click", () => chrome.runtime.openOptionsPage());
  row.appendChild(btn);
  els.qrPaywall.appendChild(row);
}

// Returns true if the QR checker can be used; otherwise shows the paywall
// (with a link to Settings, where the trial/subscription is set up) and
// returns false.
async function ensureQrAccess() {
  els.qrPaywall.classList.add("hidden");
  const { userEmail } = await self.ScamcheckBilling.getBillingSettings();
  if (!userEmail) {
    showQrPaywall("QR code checking includes a 30-day free trial, then $2.99/month.");
    return false;
  }
  try {
    const status = await self.ScamcheckBilling.fetchSubscriptionStatus(userEmail);
    if (status.access) return true;
    const message =
      status.status === "none"
        ? "QR code checking includes a 30-day free trial, then $2.99/month."
        : "Your trial or subscription has ended. Subscribe to keep checking QR codes.";
    showQrPaywall(message);
    return false;
  } catch (err) {
    showQrPaywall(err.message || "Couldn't verify your subscription. Check settings.");
    return false;
  }
}

// ---- QR code: upload-an-image path -------------------------------------
els.qrUploadBtn.addEventListener("click", async () => {
  if (!(await ensureQrAccess())) return;
  els.qrFileInput.click();
});

els.qrCameraBtn.addEventListener("click", async () => {
  if (!(await ensureQrAccess())) return;
  chrome.tabs.create({ url: chrome.runtime.getURL("qr-scanner.html") });
  window.close();
});

els.qrFileInput.addEventListener("change", async () => {
  const file = els.qrFileInput.files?.[0];
  els.qrFileInput.value = ""; // allow re-selecting the same file later
  if (!file) return;

  els.qrDetails.classList.remove("hidden");
  els.qrDetails.innerHTML = `<p class="summary" style="margin:0;">Reading QR code…</p>`;

  try {
    if (!("BarcodeDetector" in window)) {
      throw new Error("QR scanning isn't supported in this browser.");
    }
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    const bitmap = await createImageBitmap(file);
    const codes = await detector.detect(bitmap);
    if (!codes.length) throw new Error("No QR code found in that image.");

    const rawValue = codes[0].rawValue;
    const type = looksLikeUrl(rawValue) ? "url" : "text";
    const content = type === "url" && !/^https?:\/\//i.test(rawValue) ? `https://${rawValue}` : rawValue;

    els.qrDetails.innerHTML = `<p class="summary" style="margin:0 0 6px;">Checking destination…</p>`;
    const result = await self.ScamcheckApi.checkContent({ type, content });

    const chip = document.createElement("span");
    chip.className = "status-chip";
    chip.dataset.level = result.riskLevel;
    chip.textContent = LEVEL_LABEL[result.riskLevel] || LEVEL_LABEL.unknown;

    const dest = document.createElement("p");
    dest.className = "summary";
    dest.style.wordBreak = "break-all";
    dest.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    dest.style.fontSize = "12px";
    dest.textContent = content;

    const summary = document.createElement("p");
    summary.className = "summary";
    summary.textContent = result.summary || "";

    els.qrDetails.innerHTML = "";
    els.qrDetails.appendChild(dest);
    els.qrDetails.appendChild(chip);
    els.qrDetails.appendChild(summary);

    const rest = document.createElement("div");
    renderDetails(rest, result);
    els.qrDetails.appendChild(rest);

    if (type === "url") {
      const openRow = document.createElement("div");
      openRow.className = "actions";
      const openBtn = document.createElement("button");
      openBtn.className = "btn btn-primary";
      openBtn.textContent =
        result.riskLevel === "high"
          ? "Open anyway (high risk)"
          : result.riskLevel === "suspicious"
          ? "Open anyway (suspicious)"
          : "Open destination";
      openBtn.addEventListener("click", () => {
        if (result.riskLevel === "high" && !confirm("This was flagged as high risk. Open it anyway?")) {
          return;
        }
        chrome.tabs.create({ url: content });
      });
      openRow.appendChild(openBtn);
      els.qrDetails.appendChild(openRow);
    }

    const note = document.createElement("p");
    note.className = "error-note";
    note.style.color = "var(--muted)";
    note.textContent = "Nothing opens automatically — this was never visited for you.";
    els.qrDetails.appendChild(note);
  } catch (err) {
    els.qrDetails.innerHTML = "";
    showError("qr", err.message || "Couldn't read that QR code.");
  }
});

(async function init() {
  const configured = await refreshConfigBanner();
  await loadActiveTab();
  if (configured) els.checkSiteBtn.textContent = "Check this page";
})();
