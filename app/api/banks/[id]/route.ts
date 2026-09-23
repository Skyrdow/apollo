import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Este banco no existe o dejó de compartirse." }, { status: 404 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json({ error: "No se pudo cargar el banco compartido." }, { status: 500 });
  const supabase = createClient(url, key, { global: { headers: { "x-share-token": id } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.from("banks").select("id,title,questions,created_at").eq("id", id).maybeSingle();
  return error || !data ? NextResponse.json({ error: "Este banco no existe o dejó de compartirse." }, { status: 404 }) : NextResponse.json(data);
}
