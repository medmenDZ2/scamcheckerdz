const els = {
  video: document.getElementById("video"),
  scanArea: document.getElementById("scanArea"),
  hintOverlay: document.getElementById("hintOverlay"),
  statusLine: document.getElementById("statusLine"),
  resultCard: document.getElementById("resultCard"),
  destinationText: document.getElementById("destinationText"),
  statusChip: document.getElementById("statusChip"),
  summaryText: document.getElementById("summaryText"),
  detailsBody: document.getElementById("detailsBody"),
  openBtn: document.getElementById("openBtn"),
  scanAgainBtn: document.getElementById("scanAgainBtn"),
};

const LEVEL_LABEL = { low: "Low risk", suspicious: "Suspicious", high: "High risk", unknown: "Not sure" };

let stream = null;
let detector = null;
let scanning = false;
let rafId = null;
let pendingOpenUrl = null;

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function looksLikeUrl(text) {
  const t = text.trim();
  return /^https?:\/\//i.test(t) || /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(t);
}

async function startCamera() {
  if (!("BarcodeDetector" in window)) {
    els.statusLine.textContent =
      "QR scanning isn't supported in this browser. Try Upload QR image from the popup instead.";
    els.scanArea.classList.add("hidden");
    return;
  }

  detector = new BarcodeDetector({ formats: ["qr_code"] });

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
    });
  } catch (err) {
    els.statusLine.textContent =
      "Camera access was blocked or unavailable. Allow camera access for this page, or use Upload QR image from the popup instead.";
    els.scanArea.classList.add("hidden");
    return;
  }

  els.video.srcObject = stream;
  await els.video.play();
  els.statusLine.textContent = "Scanning…";
  scanning = true;
  scanLoop();
}

function stopCamera() {
  scanning = false;
  if (rafId) cancelAnimationFrame(rafId);
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
}

async function scanLoop() {
  if (!scanning) return;
  try {
    const codes = await detector.detect(els.video);
    if (codes.length) {
      const value = codes[0].rawValue;
      stopCamera();
      els.hintOverlay.classList.add("hidden");
      await handleDecoded(value);
      return;
    }
  } catch (_err) {
    // transient detection errors are normal mid-frame; keep looping
  }
  rafId = requestAnimationFrame(scanLoop);
}

async function handleDecoded(rawValue) {
  els.statusLine.textContent = "Decoded — checking destination…";
  els.resultCard.classList.remove("hidden");
  els.destinationText.textContent = rawValue;
  els.statusChip.dataset.level = "unknown";
  els.statusChip.textContent = "Checking…";
  els.summaryText.textContent = "";
  els.detailsBody.innerHTML = "";
  els.openBtn.disabled = true;
  pendingOpenUrl = null;

  try {
    const type = looksLikeUrl(rawValue) ? "url" : "text";
    const content = type === "url" && !/^https?:\/\//i.test(rawValue) ? `https://${rawValue}` : rawValue;
    const result = await self.ScamcheckApi.checkContent({ type, content });

    els.statusChip.dataset.level = result.riskLevel;
    els.statusChip.textContent = LEVEL_LABEL[result.riskLevel] || LEVEL_LABEL.unknown;
    els.summaryText.textContent = result.summary || "";
    renderDetails(result);
    els.statusLine.textContent = "";

    if (type === "url") {
      pendingOpenUrl = content;
      els.openBtn.disabled = false;
      els.openBtn.textContent =
        result.riskLevel === "high"
          ? "Open anyway (high risk)"
          : result.riskLevel === "suspicious"
          ? "Open anyway (suspicious)"
          : "Open destination";
    } else {
      els.openBtn.disabled = true;
      els.openBtn.textContent = "Not a link";
    }
  } catch (err) {
    els.statusChip.dataset.level = "unknown";
    els.statusChip.textContent = "Error";
    els.summaryText.textContent = err.message || "Something went wrong checking this.";
    els.statusLine.textContent = "";
  }
}

function renderDetails(result) {
  const parts = [];
  if (result.warningSigns?.length) {
    parts.push(
      `<h3>Warning signs</h3><ul>${result.warningSigns.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>`
    );
  }
  if (result.evidence?.length) {
    parts.push(
      `<h3>Evidence</h3>${result.evidence
        .map((e) => `<p><em>"${escapeHtml(e.quote)}"</em> — ${escapeHtml(e.reason || "")}</p>`)
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
  els.detailsBody.innerHTML = parts.join("");
}

els.openBtn.addEventListener("click", () => {
  if (!pendingOpenUrl) return;
  if (els.statusChip.dataset.level === "high") {
    if (!confirm("This was flagged as high risk. Are you sure you want to open it?")) return;
  }
  chrome.tabs.create({ url: pendingOpenUrl });
});

els.scanAgainBtn.addEventListener("click", () => {
  els.resultCard.classList.add("hidden");
  els.hintOverlay.classList.remove("hidden");
  els.scanArea.classList.remove("hidden");
  pendingOpenUrl = null;
  startCamera();
});

async function ensureQrAccess() {
  const { userEmail } = await self.ScamcheckBilling.getBillingSettings();
  if (!userEmail) return { access: false, none: true };
  try {
    const status = await self.ScamcheckBilling.fetchSubscriptionStatus(userEmail);
    return { access: status.access, none: status.status === "none" };
  } catch {
    return { access: false, none: true };
  }
}

function showPaywall() {
  els.scanArea.classList.add("hidden");
  els.statusLine.textContent = "QR code checking includes a 30-day free trial, then $2.99/month.";
  const btn = document.createElement("button");
  btn.className = "btn btn-primary";
  btn.textContent = "Unlock QR checking";
  btn.style.marginTop = "12px";
  btn.addEventListener("click", () => chrome.runtime.openOptionsPage());
  els.statusLine.insertAdjacentElement("afterend", btn);
}

window.addEventListener("beforeunload", stopCamera);

(async function init() {
  const { access } = await ensureQrAccess();
  if (!access) {
    showPaywall();
    return;
  }
  startCamera();
})();
