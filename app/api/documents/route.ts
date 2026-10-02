import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { database } from "@/lib/db";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 500_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function readPayload(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const length = Number(request.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) return null;
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return null;
    const value: unknown = JSON.parse(body);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Inicia sesión para ver tu historial." }, { status: 401 });
  const result = await database().execute({
    sql: "SELECT id, title, data, updated_at FROM documents WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50",
    args: [user.id],
  });
  const documents = result.rows.map(row => ({
    id: String(row.id),
    title: String(row.title),
    data: JSON.parse(String(row.data)),
    updated_at: String(row.updated_at),
  }));
  return NextResponse.json({ documents });
}

export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Inicia sesión para guardar." }, { status: 401 });

  const payload = await readPayload(request);
  if (!payload) return NextResponse.json({ error: "Documento inválido (máximo 500 KB)." }, { status: 400 });
  const { id, title, data } = payload;
  if ((id !== undefined && (typeof id !== "string" || !UUID.test(id))) ||
      typeof title !== "string" || title.length > 160 ||
      data === null || typeof data !== "object" || Array.isArray(data)) {
    return NextResponse.json({ error: "Documento inválido." }, { status: 400 });
  }

  const updatedAt = new Date().toISOString();
  const json = JSON.stringify(data);
  if (typeof id === "string") {
    const result = await database().execute({
      sql: "UPDATE documents SET title = ?, data = ?, updated_at = ? WHERE id = ? AND user_id = ? RETURNING id, updated_at",
      args: [title, json, updatedAt, id, user.id],
    });
    const saved = result.rows[0];
    if (!saved) return NextResponse.json({ error: "El documento no existe." }, { status: 404 });
    return NextResponse.json({ id: String(saved.id), updatedAt: String(saved.updated_at) });
  }

  const newId = randomUUID();
  await database().execute({
    sql: "INSERT INTO documents (id, user_id, title, data, updated_at) VALUES (?, ?, ?, ?, ?)",
    args: [newId, user.id, title, json, updatedAt],
  });
  return NextResponse.json({ id: newId, updatedAt });
}
