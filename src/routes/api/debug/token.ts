// /src/routes/api/debug/token.ts
import { getAccessToken } from "../../../lib/toastAuth";

export default async function handleDebugToken(env: Env): Promise<Response> {
  try {
    const accessToken = await getAccessToken({
      clientId: env.TOAST_CLIENT_ID,
      clientSecret: env.TOAST_CLIENT_SECRET,
      authUrl: env.TOAST_AUTH_URL,
      kv: env.TOKEN_KV,
    });

    return Response.json({
      ok: true,
      message: "Token retrieved successfully.",
      preview: accessToken.slice(0, 12) + "...",
    });
  } catch (err: any) {
    return Response.json({
      ok: false,
      error: err.message || "Unknown error",
    }, { status: 500 });
  }
}
