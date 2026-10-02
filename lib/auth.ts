import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { database } from "@/lib/db";

const SESSION_COOKIE = "aulaforma_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

type User = { id: string; email: string; full_name: string };


function derive(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(key as Buffer));
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64url")}$${(await derive(password, salt)).toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, saltValue, hashValue] = encoded.split("$");
  if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;
  const salt = Buffer.from(saltValue, "base64url");
  const expected = Buffer.from(hashValue, "base64url");
  if (salt.length !== 16 || expected.length !== 64) return false;
  return timingSafeEqual(await derive(password, salt), expected);
}

function sessionToken(request: Request) {
  const cookie = request.headers.get("cookie")?.split(";").map(value => value.trim())
    .find(value => value.startsWith(`${SESSION_COOKIE}=`));
  const token = cookie?.slice(SESSION_COOKIE.length + 1);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export function sessionCookie(token: string, maxAge = SESSION_MAX_AGE) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE * 1000).toISOString();
  await database().execute({
    sql: "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    args: [createHash("sha256").update(token).digest("hex"), userId, expiresAt, now.toISOString()],
  });
  return token;
}

export async function getAuthUser(request: Request): Promise<User | null> {
  const token = sessionToken(request);
  if (!token) return null;
  const result = await database().execute({
    sql: "SELECT users.id, users.email, users.full_name FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?",
    args: [createHash("sha256").update(token).digest("hex"), new Date().toISOString()],
  });
  const row = result.rows[0];
  return row ? { id: String(row.id), email: String(row.email), full_name: String(row.full_name) } : null;
}

export async function revokeSession(request: Request) {
  const token = sessionToken(request);
  if (token) await database().execute({ sql: "DELETE FROM sessions WHERE token_hash = ?", args: [createHash("sha256").update(token).digest("hex")] });
}

