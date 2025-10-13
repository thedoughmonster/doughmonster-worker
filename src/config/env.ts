export interface AppEnv {
  TOAST_API_BASE: string;
  TOAST_AUTH_URL: string;
  TOAST_CLIENT_ID: string;
  TOAST_CLIENT_SECRET: string;
  TOAST_RESTAURANT_GUID: string;
  TOKEN_KV: KVNamespace;
}

const REQUIRED_STRING_KEYS: Array<keyof AppEnv> = [
  "TOAST_API_BASE",
  "TOAST_AUTH_URL",
  "TOAST_CLIENT_ID",
  "TOAST_CLIENT_SECRET",
  "TOAST_RESTAURANT_GUID",
];

export function getEnv(rawEnv: Record<string, unknown>): AppEnv {
  const missing = REQUIRED_STRING_KEYS.filter((key) => !isNonEmptyString(rawEnv[key]));

  if (missing.length > 0) {
    throw new Error(`Missing required env bindings: ${missing.join(", ")}`);
  }

  const tokenKv = rawEnv.TOKEN_KV;
  if (!isKvNamespace(tokenKv)) {
    throw new Error("TOKEN_KV binding missing or invalid");
  }

  return {
    TOAST_API_BASE: String(rawEnv.TOAST_API_BASE),
    TOAST_AUTH_URL: String(rawEnv.TOAST_AUTH_URL),
    TOAST_CLIENT_ID: String(rawEnv.TOAST_CLIENT_ID),
    TOAST_CLIENT_SECRET: String(rawEnv.TOAST_CLIENT_SECRET),
    TOAST_RESTAURANT_GUID: String(rawEnv.TOAST_RESTAURANT_GUID),
    TOKEN_KV: tokenKv,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isKvNamespace(value: unknown): value is KVNamespace {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as KVNamespace).get === "function" &&
    typeof (value as KVNamespace).put === "function"
  );
}
