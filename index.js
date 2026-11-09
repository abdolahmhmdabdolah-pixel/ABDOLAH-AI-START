import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8080);
const sessions = new Map();
let browserPromise;
const MAX_BODY = 1_000_000;
const MIME = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};

function json(res, status, data) { res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'}); res.end(JSON.stringify(data)); }
async function body(req) { let s=''; for await (const chunk of req) { s += chunk; if (s.length > MAX_BODY) throw new Error('BODY_TOO_LARGE'); } return s ? JSON.parse(s) : {}; }
function safeUrl(raw) {
  let u; try { u = new URL(raw); } catch { throw new Error('INVALID_URL'); }
  if (!['http:','https:'].includes(u.protocol)) throw new Error('UNSUPPORTED_PROTOCOL');
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) throw new Error('PRIVATE_NETWORK_BLOCKED');
  return u.href;
}
async function getBrowser() {
  const endpoint = process.env.BROWSER_WS_ENDPOINT;
  if (!endpoint) throw new Error('BROWSER_NOT_CONFIGURED');
  const { chromium } = await import('playwright-core');
  if (!browserPromise) browserPromise = chromium.connect(endpoint).catch(err => { browserPromise = undefined; throw err; });
  return browserPromise;
}
async function withPage(sessionId, action) {
  if (!sessionId) throw new Error('SESSION_REQUIRED');
  const browser = await getBrowser();
  try {
    let context = sessions.get(sessionId);
    if (!context) {
      context = { browser, context: await browser.newContext(), page: null };
      context.page = await context.context.newPage();
      sessions.set(sessionId, context);
    }
    return await action(context.page);
  } finally { /* Browser server owns browser lifecycle; contexts are isolated per session. */ }
}

const server = http.createServer(async (req,res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') { res.writeHead(204, {'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type'}); return res.end(); }
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res,200,{ok:true,service:'ABDOLAH AI API',browserConfigured:Boolean(process.env.BROWSER_WS_ENDPOINT),aiConfigured:Boolean(process.env.AI_API_KEY),version:'0.1.0'});
    if (req.method === 'POST' && url.pathname.startsWith('/api/browser/')) {
      const input = await body(req); const sid = String(input.sessionId || '');
      if (url.pathname === '/api/browser/navigate') {
        const target = safeUrl(input.url);
        const result = await withPage(sid, async page => { await page.goto(target,{waitUntil:'domcontentloaded',timeout:45000}); return {url:page.url(),title:await page.title()}; });
        return json(res,200,{ok:true,...result});
      }
      if (url.pathname === '/api/browser/extract') {
        const result = await withPage(sid, async page => ({url:page.url(),title:await page.title(),text:(await page.locator('body').innerText({timeout:10000})).slice(0,30000)}));
        return json(res,200,{ok:true,...result});
      }
      if (url.pathname === '/api/browser/click') {
        if (!input.selector || String(input.selector).length > 500) return json(res,400,{error:'SELECTOR_REQUIRED'});
        await withPage(sid, page => page.locator(input.selector).first().click({timeout:10000})); return json(res,200,{ok:true,message:'Click completed'});
      }
      if (url.pathname === '/api/browser/type') {
        if (!input.selector || typeof input.text !== 'string' || input.text.length > 10000) return json(res,400,{error:'SELECTOR_AND_TEXT_REQUIRED'});
        await withPage(sid, page => page.locator(input.selector).first().fill(input.text,{timeout:10000})); return json(res,200,{ok:true,message:'Text entered'});
      }
      if (url.pathname === '/api/browser/screenshot') {
        const image = await withPage(sid, page => page.screenshot({type:'jpeg',quality:70,fullPage:false}));
        return json(res,200,{ok:true,data:image.toString('base64'),mimeType:'image/jpeg'});
      }
      return json(res,404,{error:'UNKNOWN_BROWSER_ACTION'});
    }
    if (req.method === 'POST' && url.pathname === '/api/agent/run') {
      const input = await body(req); const command = String(input.command || '').trim();
      if (!command) return json(res,400,{error:'COMMAND_REQUIRED'});
      // Deliberately conservative MVP: natural-language browser actions are not inferred into clicks or submissions yet.
      if (/https?:\/\//i.test(command)) {
        const match = command.match(/https?:\/\/[^\s]+/i);
        const target = safeUrl(match[0].replace(/[),.]+$/,''));
        const result = await withPage(String(input.sessionId || ''), async page => { await page.goto(target,{waitUntil:'domcontentloaded',timeout:45000}); return {url:page.url(),title:await page.title()}; });
        return json(res,200,{ok:true,plan:['Open the supplied URL','Read the page title'],completed:true,result});
      }
      return json(res,501,{error:'AI_PROVIDER_NOT_CONFIGURED',message:'Connect an OpenAI-compatible provider using AI_BASE_URL, AI_API_KEY and AI_MODEL. Browser commands require an explicit supported action.'});
    }
    if (req.method === 'GET') {
      const filePath = path.join(ROOT,'public',url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^([.][.][/\\])+/,''));
      if (!filePath.startsWith(path.join(ROOT,'public'))) return json(res,403,{error:'FORBIDDEN'});
      try { const data = await readFile(filePath); res.writeHead(200,{'content-type':MIME[path.extname(filePath)] || 'application/octet-stream'}); return res.end(data); }
      catch { return json(res,404,{error:'NOT_FOUND'}); }
    }
    return json(res,404,{error:'NOT_FOUND'});
  } catch (e) {
    const known = ['INVALID_URL','UNSUPPORTED_PROTOCOL','PRIVATE_NETWORK_BLOCKED','BROWSER_NOT_CONFIGURED','SESSION_REQUIRED','BODY_TOO_LARGE'];
    const status = known.includes(e.message) ? (e.message === 'BROWSER_NOT_CONFIGURED' ? 503 : 400) : 500;
    return json(res,status,{error:e.message || 'INTERNAL_ERROR'});
  }
});
server.listen(PORT,()=>console.log(`ABDOLAH AI listening on :${PORT}`));
