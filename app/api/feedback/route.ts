import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 8_192;
const MAX_MESSAGE_LENGTH = 2_000;
const MIN_MESSAGE_LENGTH = 10;
const CATEGORIES = new Set(["suggestion", "issue"]);

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") return NextResponse.json({ error: "Envía el comentario como JSON." }, { status: 415 });

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "El comentario es demasiado largo." }, { status: 413 });
  }

  let payload: unknown;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "El comentario es demasiado largo." }, { status: 413 });
    }
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "No se pudo leer el comentario." }, { status: 400 });
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return NextResponse.json({ error: "Comentario inválido." }, { status: 400 });
  }
  const record = payload as Record<string, unknown>;
  const category = record.category;
  const message = typeof record.message === "string" ? record.message.trim() : "";
  const messageLength = Array.from(message).length;
  if (typeof category !== "string" || !CATEGORIES.has(category) || messageLength < MIN_MESSAGE_LENGTH || messageLength > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: "Elige un tipo y escribe entre 10 y 2.000 caracteres." }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json({ error: "El buzón de comentarios aún no está configurado." }, { status: 503 });

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.from("feedback").insert({ category, message });
  if (error) return NextResponse.json({ error: "No se pudo enviar el comentario. Inténtalo más tarde." }, { status: 500 });

  return NextResponse.json({ submitted: true }, { status: 201 });
}
