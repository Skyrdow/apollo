import { NextResponse } from "next/server";
import { serverSupabase } from "@/lib/server-supabase";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 500_000;

export async function GET(request: Request) {
  const auth = serverSupabase(request);
  if (!auth) return NextResponse.json({ error: "Inicia sesión para ver tus bancos." }, { status: 401 });
  const { client: supabase, getUser } = auth;
  const { data: { user } } = await getUser();
  if (!user) return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });
  const { data, error } = await supabase.from("banks")
    .select("id,title,created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  return error
    ? NextResponse.json({ error: "No se pudieron cargar tus bancos." }, { status: 500 })
    : NextResponse.json({ banks: data });
}

export async function POST(request: Request) {
  const auth = serverSupabase(request);
  if (!auth) return NextResponse.json({ error: "Inicia sesión para compartir." }, { status: 401 });
  const { client: supabase, getUser } = auth;
  const { data: { user } } = await getUser();
  if (!user) return NextResponse.json({ error: "Sesión no válida." }, { status: 401 });

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
  const { data, error } = await supabase.from("banks").insert({ user_id: user.id, title: bankTitle, questions }).select("id").single();
  return error ? NextResponse.json({ error: "No se pudo guardar el banco." }, { status: 500 }) : NextResponse.json({ id: data.id });
}
