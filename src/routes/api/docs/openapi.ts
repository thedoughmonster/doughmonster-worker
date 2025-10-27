import type { AppEnv } from "../../../config/env.js";
import openApiDocument from "../../../../schemas/openapi.json" assert { type: "json" };

const JSON_PAYLOAD = JSON.stringify(openApiDocument, null, 2);
const CACHE_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=300, stale-while-revalidate=86400",
};

export default function handleOpenApiDocument(
  _env: AppEnv,
  _request: Request
): Response {
  return new Response(JSON_PAYLOAD, {
    headers: CACHE_HEADERS,
  });
}
