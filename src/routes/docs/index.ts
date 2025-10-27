import type { AppEnv } from "../../config/env.js";

const HTML_DOCUMENT = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Doughmonster Worker API Documentation</title>
    <style>
      body {
        margin: 0;
        padding: 0;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #1f2933;
        background: #f9fbfd;
      }
      header {
        background: #243b53;
        color: #f5f7fa;
        padding: 1.5rem 2rem;
        box-shadow: 0 2px 8px rgba(15, 23, 42, 0.2);
      }
      header h1 {
        margin: 0;
        font-size: 1.5rem;
      }
      header p {
        margin: 0.5rem 0 0;
        font-size: 0.95rem;
        max-width: 48rem;
      }
      main {
        height: calc(100vh - 120px);
      }
      redoc {
        display: block;
        height: 100%;
      }
      .redoc-container {
        height: 100%;
      }
    </style>
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js" defer></script>
  </head>
  <body>
    <header>
      <h1>Doughmonster Worker API</h1>
      <p>Explore the OpenAPI reference below or fetch the raw schema at <code>/api/docs/openapi.json</code>.</p>
    </header>
    <main>
      <redoc spec-url="/api/docs/openapi.json"></redoc>
    </main>
  </body>
</html>`;

const CACHE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "public, max-age=300, stale-while-revalidate=86400",
};

export default function handleDocsPage(
  _env: AppEnv,
  _request: Request
): Response {
  return new Response(HTML_DOCUMENT, {
    headers: CACHE_HEADERS,
  });
}
