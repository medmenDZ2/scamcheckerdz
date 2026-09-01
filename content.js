// content.js
// Passive by design: extracts page context ONLY when explicitly asked via
// a runtime message (from the popup or background). Nothing is sent
// anywhere from this file — it just answers the question with local data.

const MAX_EXCERPT_CHARS = 4000;
const MAX_LINKS = 60;
const MAX_FORMS = 20;

function getMeta(name) {
  const el =
    document.querySelector(`meta[name="${name}"]`) ||
    document.querySelector(`meta[property="${name}"]`);
  return el ? el.getAttribute("content") || "" : "";
}

function getVisibleText() {
  // A cheap, dependency-free approximation of "visible text": walk body
  // text nodes, skip script/style/noscript, collapse whitespace, cap length.
  const skipTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parentTag = node.parentElement?.tagName;
      if (!parentTag || skipTags.has(parentTag)) return NodeFilter.FILTER_REJECT;
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let text = "";
  while (walker.nextNode() && text.length < MAX_EXCERPT_CHARS) {
    text += walker.currentNode.nodeValue.trim() + " ";
  }
  return text.trim().slice(0, MAX_EXCERPT_CHARS);
}

function getLinks() {
  return Array.from(document.querySelectorAll("a[href]"))
    .slice(0, MAX_LINKS)
    .map((a) => ({
      href: a.href,
      text: (a.textContent || "").trim().slice(0, 120),
    }))
    .filter((l) => l.href && !l.href.startsWith("javascript:"));
}

function getForms() {
  return Array.from(document.querySelectorAll("form"))
    .slice(0, MAX_FORMS)
    .map((f) => ({
      action: f.getAttribute("action") || "",
      hasPasswordField: !!f.querySelector('input[type="password"]'),
      hasPaymentField: !!f.querySelector(
        'input[autocomplete*="cc-"], input[name*="card"], input[name*="cvv"], input[name*="cvc"]'
      ),
    }));
}

function extractPageContext() {
  return {
    url: location.href,
    title: document.title || "",
    metaDescription: getMeta("description") || getMeta("og:description") || "",
    excerptText: getVisibleText(),
    links: getLinks(),
    forms: getForms(),
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SCAMCHECK_GET_PAGE_CONTEXT") {
    try {
      sendResponse({ ok: true, context: extractPageContext() });
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  }
  // Return true only when we respond asynchronously; here it's sync,
  // but Chrome tolerates a sync sendResponse without it too.
});
