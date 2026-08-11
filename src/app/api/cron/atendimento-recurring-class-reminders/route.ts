import { sendRecurringClassStartNotifications } from "@/lib/atendimento/server";

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const url = new URL(req.url);
  const q = url.searchParams.get("secret");
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  return q === secret || bearer === secret;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  try {
    const result = await sendRecurringClassStartNotifications();
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "recurring_class_reminders_error");
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
