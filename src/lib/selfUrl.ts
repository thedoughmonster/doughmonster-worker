export function buildSelfUrl(
  req: Request,
  path: string,
  selfOriginParam?: string
): URL {
  const reqUrl = new URL(req.url);

  let baseOrigin = reqUrl.origin;
  if (selfOriginParam) {
    try {
      const candidate = new URL(selfOriginParam);
      if (candidate.protocol === "https:" && candidate.hostname) {
        baseOrigin = candidate.origin;
      }
    } catch {
      // Ignore invalid override values and fall back to the request origin.
    }
  }

  const normalizedPath = path.replace(/^\/+/g, "");

  return new URL(`${baseOrigin}/${normalizedPath}`);
}

export function stringifyForLog(u: URL): string {
  return u.toString();
}
