// /src/routes/api/debug/token.ts
import type { ToastEnv } from "../../../lib/env";
import { getAccessToken } from "../../../lib/toastAuth";

export default async function handleDebugToken(env: ToastEnv): Promise<Response> {
  try {
    const accessToken = await getAccessToken(env);

    return Response.json({
      ok: true,
      message: "Token retrieved successfully.",
      preview: accessToken.slice(0, 12) + "...",
    });
  } catch (err: any) {
    return Response.json(
      {
        ok: false,
        error: err?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
