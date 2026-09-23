import { NextResponse } from "next/server";
import { serverSupabase } from "@/lib/server-supabase";
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
  const auth = serverSupabase(request);
  if (!auth) return NextResponse.json({ error: "Inicia sesión para ver tu historial." }, { status: 401 });
  const { client: supabase, getUser } = auth;
  const { data: { user } } = await getUser();
  if (!user) return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  const { data, error } = await supabase.from("documents").select("id,title,data,updated_at").order("updated_at", { ascending: false }).limit(50);
  return error ? NextResponse.json({ error: "No se pudo cargar tu historial." }, { status: 500 }) : NextResponse.json({ documents: data });
}

export async function POST(request: Request) {
  const auth = serverSupabase(request);
  if (!auth) return NextResponse.json({ error: "Inicia sesión para guardar." }, { status: 401 });
  const { client: supabase, getUser } = auth;
  const { data: { user } } = await getUser();
  if (!user) return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });

  const payload = await readPayload(request);
  if (!payload) return NextResponse.json({ error: "Documento inválido (máximo 500 KB)." }, { status: 400 });
  const { id, title, data } = payload;
  if ((id !== undefined && (typeof id !== "string" || !UUID.test(id))) ||
      typeof title !== "string" || title.length > 160 ||
      data === null || typeof data !== "object" || Array.isArray(data)) {
    return NextResponse.json({ error: "Documento inválido." }, { status: 400 });
  }

  const row = { title, data, updated_at: new Date().toISOString() };
  if (typeof id === "string") {
    const { data: saved, error } = await supabase.from("documents").update(row).eq("id", id).eq("user_id", user.id).select("id,updated_at").maybeSingle();
    if (error) return NextResponse.json({ error: "No se pudo guardar el documento." }, { status: 500 });
    if (!saved) return NextResponse.json({ error: "El documento no existe." }, { status: 404 });
    return NextResponse.json({ id: saved.id, updatedAt: saved.updated_at });
  }

  const { data: saved, error } = await supabase.from("documents").insert({ ...row, user_id: user.id }).select("id,updated_at").single();
  return error ? NextResponse.json({ error: "No se pudo guardar el documento." }, { status: 500 }) : NextResponse.json({ id: saved.id, updatedAt: saved.updated_at });
}
