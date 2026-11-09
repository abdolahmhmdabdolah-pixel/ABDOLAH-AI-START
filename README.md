# Cloudflare deployment (phone-friendly, free tier)

This folder provides a Cloudflare Workers + Browser Run deployment path. It does not need Base44, Docker, a local computer, or a payment card for the Cloudflare Free plan. Cloudflare currently documents a daily Browser Run cap of 10 minutes on Workers Free, so this is a limited personal MVP, not unlimited hosting.

## Deploy from a browser

1. Create a free Cloudflare account at https://dash.cloudflare.com/ (choose the Free plan; do not add a payment method or upgrade).
2. Open Workers & Pages and create a Worker. The dashboard editor can accept the contents of `worker.js`, but first the project must have the `@cloudflare/puppeteer` dependency and Browser binding configured. The reliable path is to connect the GitHub repository and deploy it through Cloudflare's Git integration.
3. In the Worker settings, confirm the Browser Run binding is named `BROWSER` and static assets point to the `public/` folder as configured in `wrangler.toml`.
4. Deploy. Test `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/api/health`.
5. Test browser execution with a POST to `/api/browser/run` using JSON:

```json
{
  "url": "https://example.com",
  "steps": [],
  "screenshot": true
}
```

## Security warning

This is a development MVP. Before exposing it publicly, add real user authentication, per-user quotas, durable encrypted session storage, stronger SSRF/egress controls, and audit logging. The current browser endpoint is not safe to leave open to the public internet. The worker closes the browser after each job, so authenticated sessions do not persist between jobs yet.

## Free-tier constraint

Cloudflare documents 10 minutes of browser use per day on Workers Free. When the daily quota is exhausted, browser tasks pause until the quota resets. Static assets and lightweight Worker API requests have separate limits.
