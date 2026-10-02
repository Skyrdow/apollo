import { NextResponse } from "next/server";
import { database } from "@/lib/db";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Este banco no existe o dejó de compartirse." }, { status: 404 });
  const result = await database().execute({
    sql: "SELECT id, title, questions, created_at FROM banks WHERE id = ?",
    args: [id],
  });
  const row = result.rows[0];
  if (!row) return NextResponse.json({ error: "Este banco no existe o dejó de compartirse." }, { status: 404 });
  return NextResponse.json({
    id: String(row.id),
    title: String(row.title),
    questions: JSON.parse(String(row.questions)),
    created_at: String(row.created_at),
  });
}
