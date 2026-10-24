// Forwards backup rows from the counter to the owner's Google Sheet (a Google Apps Script
// web app). The script's address and secret stay on the server: set SHEETS_WEBHOOK_URL
// and SHEETS_SECRET in Vercel → Settings → Environment Variables.

export const dynamic = "force-dynamic";

const MAX_ROWS = 100;
const SHEETS = new Set(["Bills", "Items", "Expenses", "Days", "Events"]);

const webhook = () => process.env.SHEETS_WEBHOOK_URL?.trim() || "";

export async function GET() {
  return Response.json({ configured: !!webhook() });
}

export async function POST(req: Request) {
  const url = webhook();
  if (!url) return Response.json({ ok: false, error: "Google Sheet backup is not set up." }, { status: 501 });

  const body = (await req.json().catch(() => null)) as { rows?: unknown } | null;
  type Row = { id?: unknown; sheet?: unknown; headers?: unknown; values?: unknown };
  const rows = Array.isArray(body?.rows) ? (body.rows as Row[]) : null;
  const valid =
    rows &&
    rows.length > 0 &&
    rows.length <= MAX_ROWS &&
    rows.every(
      (r) =>
        r &&
        typeof r.id === "string" &&
        SHEETS.has(String(r.sheet)) &&
        Array.isArray(r.headers) &&
        Array.isArray(r.values) &&
        (r.values as unknown[]).length === (r.headers as unknown[]).length &&
        (r.values as unknown[]).length <= 30,
    );
  if (!valid) return Response.json({ ok: false, error: "Bad backup rows." }, { status: 400 });

  try {
    // Apps Script answers a POST with a redirect to the result; fetch follows it.
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ secret: process.env.SHEETS_SECRET ?? "", rows }),
      redirect: "follow",
      signal: AbortSignal.timeout(25_000),
    });
    const text = await res.text();
    let out: { ok?: boolean; error?: string } | null = null;
    try {
      out = JSON.parse(text);
    } catch {
      // An HTML page means the script isn't deployed for "Anyone", or the URL is wrong.
    }
    if (out?.ok) return Response.json({ ok: true });
    return Response.json(
      { ok: false, error: out?.error ?? "The Google Sheet script didn't answer properly. Check its deployment (access: Anyone)." },
      { status: 502 },
    );
  } catch {
    return Response.json({ ok: false, error: "Couldn't reach Google. Will retry." }, { status: 502 });
  }
}
