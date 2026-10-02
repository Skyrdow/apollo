import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { database } from "@/lib/db";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 500_000;

export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Inicia sesión para ver tus bancos." }, { status: 401 });
  const result = await database().execute({
    sql: "SELECT id, title, created_at FROM banks WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
    args: [user.id],
  });
  const banks = result.rows.map(row => ({
    id: String(row.id),
    title: String(row.title),
    created_at: String(row.created_at),
  }));
  return NextResponse.json({ banks });
}

export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Inicia sesión para compartir." }, { status: 401 });

  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return NextResponse.json({ error: "Banco inválido (máximo 500 preguntas)." }, { status: 400 });
  let payload: unknown;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return NextResponse.json({ error: "Banco inválido (máximo 500 preguntas)." }, { status: 400 });
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "No se pudo leer el banco." }, { status: 400 });
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return NextResponse.json({ error: "Banco inválido." }, { status: 400 });
  const { title, questions } = payload as Record<string, unknown>;
  const bankTitle = title === undefined || title === null ? "Banco sin título" : title;
  if (typeof bankTitle !== "string" || bankTitle.length > 160 || !Array.isArray(questions) || questions.length > 500) {
    return NextResponse.json({ error: "Banco inválido (máximo 500 preguntas)." }, { status: 400 });
  }
  const id = randomUUID();
  await database().execute({
    sql: "INSERT INTO banks (id, user_id, title, questions, created_at) VALUES (?, ?, ?, ?, ?)",
    args: [id, user.id, bankTitle, JSON.stringify(questions), new Date().toISOString()],
  });
  return NextResponse.json({ id });
}
