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

  const wsUrl = process.env["NEXT_PUBLIC_WS_URL"] ?? "http://localhost:8080";
  const secret = process.env["WS_ADMIN_SECRET"] ?? "";

  const upstream = await fetch(`${wsUrl}/admin/reset-table`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-secret": secret,
    },
    body: JSON.stringify({ tableId: tableId ?? "table-1" }),
  });

  if (!upstream.ok) {
    return NextResponse.json({ error: "WS service error" }, { status: 502 });
  }

  const result = (await upstream.json()) as { ok: boolean; tableId: string };
  return NextResponse.json(result);
}
