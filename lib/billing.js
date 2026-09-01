// lib/billing.js
// Client for the QR checker's paid-feature gate: 30-day free trial, then
// $2.99/month. Talks to the same backend configured in Settings.

const BILLING_DEFAULTS = { userEmail: "" };

async function getBillingSettings() {
  const stored = await chrome.storage.sync.get(BILLING_DEFAULTS);
  return { ...BILLING_DEFAULTS, ...stored };
}

async function saveBillingSettings(partial) {
  await chrome.storage.sync.set(partial);
}

async function apiBase() {
  const settings = await self.ScamcheckApi.getSettings();
  const base = self.ScamcheckApi.normalizeBaseUrl(settings.apiBaseUrl);
  if (!base) throw new Error("Set up a backend URL in settings first.");
  return base;
}

// Returns { status, access, trialEnd, currentPeriodEnd }.
// status is "none" | "trialing" | "active" | "past_due" | "canceled" | "unpaid" | "incomplete".
async function fetchSubscriptionStatus(email) {
  if (!email) return { status: "none", access: false, trialEnd: null, currentPeriodEnd: null };
  const base = await apiBase();
  const res = await fetch(`${base}/v1/billing/status?email=${encodeURIComponent(email)}`);
  if (!res.ok) throw new Error("Couldn't check subscription status.");
  return res.json();
}

// Opens Stripe Checkout (30-day trial, then $2.99/mo) for this email.
async function startCheckout(email) {
  const base = await apiBase();
  const res = await fetch(`${base}/v1/billing/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Couldn't start checkout.");
  return data.url;
}

// Opens the Stripe customer portal (cancel/update payment method) for this email.
async function openBillingPortal(email) {
  const base = await apiBase();
  const res = await fetch(`${base}/v1/billing/portal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Couldn't open billing portal.");
  return data.url;
}

self.ScamcheckBilling = {
  getBillingSettings,
  saveBillingSettings,
  fetchSubscriptionStatus,
  startCheckout,
  openBillingPortal,
};
