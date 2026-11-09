import puppeteer from "@cloudflare/puppeteer";

const MAX_BODY = 50_000;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

async function readJson(request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) throw new Error("BODY_TOO_LARGE");
  try { return raw ? JSON.parse(raw) : {}; }
  catch { throw new Error("INVALID_JSON"); }
}

function safeUrl(raw) {
  let url;
  try { url = new URL(String(raw || "")); } catch { throw new Error("INVALID_URL"); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("UNSUPPORTED_PROTOCOL");
  if (url.username || url.password) throw new Error("URL_CREDENTIALS_BLOCKED");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const blocked = host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "0.0.0.0" ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
    host === "metadata.google.internal";
  if (blocked) throw new Error("PRIVATE_NETWORK_BLOCKED");
  return url.href;
}

async function runBrowser(env, input) {
  const target = safeUrl(input.url);
  const steps = Array.isArray(input.steps) ? input.steps.slice(0, 12) : [];
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10_000);
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 35_000 });
    const log = [{ action: "navigate", url: page.url(), title: await page.title() }];

    for (const step of steps) {
      if (!step || typeof step !== "object") throw new Error("INVALID_STEP");
      if (step.type === "click") {
        if (typeof step.selector !== "string" || step.selector.length > 400) throw new Error("INVALID_SELECTOR");
        await page.locator(step.selector).first().click();
        log.push({ action: "click", selector: step.selector });
      } else if (step.type === "fill") {
        if (typeof step.selector !== "string" || step.selector.length > 400 || typeof step.text !== "string" || step.text.length > 5000) throw new Error("INVALID_FILL");
        await page.locator(step.selector).first().fill(step.text);
        log.push({ action: "fill", selector: step.selector });
      } else if (step.type === "wait") {
        const ms = Math.max(0, Math.min(Number(step.ms) || 0, 3000));
        await new Promise(resolve => setTimeout(resolve, ms));
        log.push({ action: "wait", ms });
      } else if (step.type === "extract") {
        log.push({ action: "extract" });
      } else {
        throw new Error("UNSUPPORTED_STEP");
      }
    }

    const result = {
      ok: true,
      url: page.url(),
      title: await page.title(),
      text: (await page.locator("body").innerText().catch(() => "")).slice(0, 20_000),
      log,
    };
    if (input.screenshot === true) {
      const image = await page.screenshot({ type: "jpeg", quality: 65, fullPage: false });
      result.screenshot = `data:image/jpeg;base64,${Buffer.from(image).toString("base64")}`;
    }
    return result;
  } finally {
    await browser.close();
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health" && request.method === "GET") {
      return reply({ ok: true, service: "ABDOLAH AI Cloud Worker", browserConfigured: Boolean(env.BROWSER), version: "0.2.0-cloudflare" });
    }
    if (url.pathname === "/api/browser/run" && request.method === "POST") {
      try {
        const input = await readJson(request);
        const result = await runBrowser(env, input);
        return reply(result);
      } catch (error) {
        const known = new Set(["BODY_TOO_LARGE", "INVALID_JSON", "INVALID_URL", "UNSUPPORTED_PROTOCOL", "URL_CREDENTIALS_BLOCKED", "PRIVATE_NETWORK_BLOCKED", "INVALID_STEP", "INVALID_SELECTOR", "INVALID_FILL", "UNSUPPORTED_STEP"]);
        return reply({ ok: false, error: known.has(error.message) ? error.message : "BROWSER_TASK_FAILED", detail: String(error.message || "Unknown error").slice(0, 300) }, known.has(error.message) ? 400 : 502);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
