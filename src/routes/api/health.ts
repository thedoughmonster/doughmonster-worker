import { jsonResponse } from "../../lib/http.js";

export default function handleHealth(): Response {
  return jsonResponse({ ok: true });
}
