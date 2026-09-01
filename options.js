const els = {
  apiBaseUrl: document.getElementById("apiBaseUrl"),
  apiKey: document.getElementById("apiKey"),
  autoCheckPages: document.getElementById("autoCheckPages"),
  testBtn: document.getElementById("testBtn"),
  saveBtn: document.getElementById("saveBtn"),
  status: document.getElementById("status"),
  billingEmail: document.getElementById("billingEmail"),
  billingStatus: document.getElementById("billingStatus"),
  startTrialBtn: document.getElementById("startTrialBtn"),
  manageBillingBtn: document.getElementById("manageBillingBtn"),
};

function setStatus(text, kind) {
  els.status.textContent = text;
  els.status.className = "status" + (kind ? ` ${kind}` : "");
}

function originPatternFor(urlStr) {
  try {
    const u = new URL(urlStr);
    return `${u.protocol}//${u.host}/*`;
  } catch {
    return null;
  }
}

async function ensureHostPermission(urlStr) {
  const pattern = originPatternFor(urlStr);
  if (!pattern) throw new Error("That doesn't look like a valid URL.");

  const already = await chrome.permissions.contains({ origins: [pattern] });
  if (already) return true;

  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) throw new Error("Permission for that URL was declined, so the extension can't reach it.");
  return true;
}

async function load() {
  const settings = await self.ScamcheckApi.getSettings();
  els.apiBaseUrl.value = settings.apiBaseUrl || "";
  els.apiKey.value = settings.apiKey || "";
  els.autoCheckPages.checked = settings.autoCheckPages !== false;

  const billingSettings = await self.ScamcheckBilling.getBillingSettings();
  els.billingEmail.value = billingSettings.userEmail || "";
  await refreshBillingStatus();
}

async function save() {
  const apiBaseUrl = self.ScamcheckApi.normalizeBaseUrl(els.apiBaseUrl.value);
  const apiKey = els.apiKey.value.trim();
  const autoCheckPages = els.autoCheckPages.checked;

  els.saveBtn.disabled = true;
  setStatus("Saving…");

  try {
    if (apiBaseUrl) await ensureHostPermission(apiBaseUrl);
    await self.ScamcheckApi.saveSettings({ apiBaseUrl, apiKey, autoCheckPages });
    setStatus("Saved.", "ok");
  } catch (err) {
    setStatus(err.message || "Couldn't save settings.", "err");
  } finally {
    els.saveBtn.disabled = false;
  }
}

async function testConnection() {
  const apiBaseUrl = self.ScamcheckApi.normalizeBaseUrl(els.apiBaseUrl.value);
  if (!apiBaseUrl) {
    setStatus("Enter an API URL first.", "err");
    return;
  }

  els.testBtn.disabled = true;
  setStatus("Testing…");

  try {
    await ensureHostPermission(apiBaseUrl);
    // Test against whatever is currently in the fields, even if unsaved.
    await self.ScamcheckApi.saveSettings({ apiBaseUrl, apiKey: els.apiKey.value.trim() });
    await self.ScamcheckApi.checkHealth();
    setStatus("Connected — the backend responded.", "ok");
  } catch (err) {
    setStatus(err.message || "Couldn't reach the backend.", "err");
  } finally {
    els.testBtn.disabled = false;
  }
}

function daysUntil(ts) {
  if (!ts) return null;
  return Math.max(0, Math.ceil((ts - Date.now()) / 86400000));
}

function setBillingStatus(text, kind) {
  els.billingStatus.textContent = text;
  els.billingStatus.className = "status" + (kind ? ` ${kind}` : "");
}

async function refreshBillingStatus() {
  const email = els.billingEmail.value.trim();
  if (!email) {
    setBillingStatus("");
    els.startTrialBtn.classList.remove("hidden");
    els.startTrialBtn.disabled = false;
    els.startTrialBtn.textContent = "Start 30-day free trial";
    els.manageBillingBtn.classList.add("hidden");
    return;
  }
  try {
    const s = await self.ScamcheckBilling.fetchSubscriptionStatus(email);
    els.manageBillingBtn.classList.toggle("hidden", s.status === "none");
    if (s.status === "trialing") {
      setBillingStatus(`Free trial — ${daysUntil(s.trialEnd)} day(s) left.`, "ok");
      els.startTrialBtn.classList.add("hidden");
    } else if (s.status === "active") {
      setBillingStatus("Active subscriber — thanks!", "ok");
      els.startTrialBtn.classList.add("hidden");
    } else if (s.status === "past_due" || s.status === "unpaid") {
      setBillingStatus("Payment failed — update your payment method to keep access.", "err");
      els.startTrialBtn.classList.add("hidden");
    } else if (s.status === "canceled" || s.status === "incomplete") {
      setBillingStatus("No active subscription. Subscribe again to regain access.", "");
      els.startTrialBtn.classList.remove("hidden");
      els.startTrialBtn.disabled = false;
      els.startTrialBtn.textContent = "Subscribe ($2.99/mo)";
    } else {
      setBillingStatus("Not started yet.", "");
      els.startTrialBtn.classList.remove("hidden");
      els.startTrialBtn.disabled = false;
      els.startTrialBtn.textContent = "Start 30-day free trial";
    }
  } catch (err) {
    setBillingStatus(err.message || "Couldn't check subscription status.", "err");
  }
}

async function startTrial() {
  const email = els.billingEmail.value.trim();
  if (!email) {
    setBillingStatus("Enter your email first.", "err");
    return;
  }
  await self.ScamcheckBilling.saveBillingSettings({ userEmail: email });
  els.startTrialBtn.disabled = true;
  setBillingStatus("Opening checkout…");
  try {
    const url = await self.ScamcheckBilling.startCheckout(email);
    chrome.tabs.create({ url });
  } catch (err) {
    setBillingStatus(err.message || "Couldn't start checkout.", "err");
  } finally {
    els.startTrialBtn.disabled = false;
  }
}

async function manageBilling() {
  const email = els.billingEmail.value.trim();
  if (!email) return;
  els.manageBillingBtn.disabled = true;
  try {
    const url = await self.ScamcheckBilling.openBillingPortal(email);
    chrome.tabs.create({ url });
  } catch (err) {
    setBillingStatus(err.message || "Couldn't open billing portal.", "err");
  } finally {
    els.manageBillingBtn.disabled = false;
  }
}

els.billingEmail.addEventListener("change", async () => {
  await self.ScamcheckBilling.saveBillingSettings({ userEmail: els.billingEmail.value.trim() });
  refreshBillingStatus();
});
els.startTrialBtn.addEventListener("click", startTrial);
els.manageBillingBtn.addEventListener("click", manageBilling);

els.saveBtn.addEventListener("click", save);
els.testBtn.addEventListener("click", testConnection);

load();
