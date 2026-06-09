import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";

export async function POST(req: Request) {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tableId } = (await req.json().catch(() => ({}))) as {
    tableId?: string;
  };

  const wsUrl = process.env["WS_SERVICE_URL"] ?? "http://localhost:8080";
  const secret = process.env["WS_ADMIN_SECRET"] ?? "";

  try {
    const upstream = await fetch(`${wsUrl}/admin/reset-table`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify({ tableId: tableId ?? "table-1" }),
    });
    const text = await upstream.text();
    const result = text ? JSON.parse(text) as { ok: boolean; tableId: string } : { ok: false };
    return NextResponse.json(result, { status: upstream.ok ? 200 : upstream.status });
  } catch (err) {
    console.error('[POST /api/admin/table-reset]', err);
    return NextResponse.json({ error: 'Could not reach ws-service', detail: String(err) }, { status: 502 });
  }
}
