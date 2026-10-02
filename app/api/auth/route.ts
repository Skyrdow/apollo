import { createHmac, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createSession, getAuthUser, hashPassword, revokeSession, sessionCookie, verifyPassword } from "@/lib/auth";
import { database } from "@/lib/db";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 8_192;
const AUTH_ATTEMPT_LIMIT = 20;
const AUTH_WINDOW_MS = 60_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export async function GET(request: Request) {
  return NextResponse.json({ user: await getAuthUser(request) });
}

export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return NextResponse.json({ error: "Solicitud demasiado grande." }, { status: 413 });

  let payload: unknown;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return NextResponse.json({ error: "Solicitud demasiado grande." }, { status: 413 });
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "No se pudo leer la solicitud." }, { status: 400 });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });

  const record = payload as Record<string, unknown>;
  const action = record.action;
  const email = typeof record.email === "string" ? record.email.trim().toLowerCase() : "";
  const password = typeof record.password === "string" ? record.password : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if ((action !== "register" && action !== "login") || email.length > 254 || !EMAIL.test(email) || Array.from(password).length > 128) {
    return NextResponse.json({ error: "Revisa el correo y la contraseña." }, { status: 400 });
  }

  const db = database();
  // ponytail: trusts Vercel's x-forwarded-for and retains one hashed row per IP; use a trusted proxy header or prune if either ceiling changes.
  const clientAddress = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const addressHash = createHmac("sha256", process.env.TURSO_AUTH_TOKEN ?? "").update(clientAddress).digest("hex");
  const now = Date.now();
  const rateLimit = await db.execute({
    sql: `INSERT INTO auth_rate_limits (ip_hash, window_started_at, attempts) VALUES (?, ?, 1)
      ON CONFLICT(ip_hash) DO UPDATE SET
        window_started_at = CASE WHEN auth_rate_limits.window_started_at <= ? THEN excluded.window_started_at ELSE auth_rate_limits.window_started_at END,
        attempts = CASE WHEN auth_rate_limits.window_started_at <= ? THEN 1 ELSE auth_rate_limits.attempts + 1 END
      RETURNING attempts`,
    args: [addressHash, now, now - AUTH_WINDOW_MS, now - AUTH_WINDOW_MS],
  });
  if (Number(rateLimit.rows[0]?.attempts) > AUTH_ATTEMPT_LIMIT) {
    return NextResponse.json({ error: "Demasiados intentos. Espera un minuto e inténtalo de nuevo." }, { status: 429 });
  }
  let user: { id: string; email: string; full_name: string };
  if (action === "register") {
    if (Array.from(name).length < 2 || Array.from(name).length > 100 || Array.from(password).length < 10) {
      return NextResponse.json({ error: "El nombre debe tener entre 2 y 100 caracteres y la contraseña al menos 10." }, { status: 400 });
    }
    user = { id: randomUUID(), email, full_name: name };
    try {
      await db.execute({
        sql: "INSERT INTO users (id, email, password_hash, full_name, created_at) VALUES (?, ?, ?, ?, ?)",
        args: [user.id, email, await hashPassword(password), name, new Date().toISOString()],
      });
    } catch (error) {
      if (String(error).includes("users.email")) return NextResponse.json({ error: "Ya existe una cuenta con ese correo." }, { status: 409 });
      throw error;
    }
  } else {
    const result = await db.execute({ sql: "SELECT id, email, full_name, password_hash FROM users WHERE email = ?", args: [email] });
    const row = result.rows[0];
    if (!row || !await verifyPassword(password, String(row.password_hash))) {
      return NextResponse.json({ error: "Correo o contraseña incorrectos." }, { status: 401 });
    }
    user = { id: String(row.id), email: String(row.email), full_name: String(row.full_name) };
  }

  const token = await createSession(user.id);
  return NextResponse.json({ user }, { headers: { "Set-Cookie": sessionCookie(token) } });
}

export async function DELETE(request: Request) {
  try {
    await revokeSession(request);
  } catch {
    // Clear the browser cookie even if Turso is temporarily unavailable.
  }
  return NextResponse.json({ signedOut: true }, { headers: { "Set-Cookie": sessionCookie("", 0) } });
}
