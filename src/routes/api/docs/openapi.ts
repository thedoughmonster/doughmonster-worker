import type { AppEnv } from "../../../config/env.js";
import openApiDocument from "../../../../schemas/openapi.json" assert { type: "json" };

const JSON_PAYLOAD = JSON.stringify(openApiDocument, null, 2);
const CACHE_HEADERS = {
  "cache-control": "public, max-age=300, stale-while-revalidate=86400",
};

const JSON_HEADERS = {
  ...CACHE_HEADERS,
  "content-type": "application/json; charset=utf-8",
};

const JS_HEADERS = {
  ...CACHE_HEADERS,
  "content-type": "application/javascript; charset=utf-8",
};

const JS_PAYLOAD = `export default ${JSON_PAYLOAD};\n`;

export default function handleOpenApiDocument(
  _env: AppEnv,
  request: Request
): Response {
  const url = new URL(request.url);
  const isModuleRequest = url.pathname.endsWith(".js");

  return new Response(isModuleRequest ? JS_PAYLOAD : JSON_PAYLOAD, {
    headers: isModuleRequest ? JS_HEADERS : JSON_HEADERS,
  });
}
