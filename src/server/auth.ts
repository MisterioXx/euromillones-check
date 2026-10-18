import { betterAuth } from "better-auth";
import { getPool } from "./database.js";

export function appOrigin(): string {
  const value = process.env.APP_ORIGIN ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:5173");
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("El origen de la aplicación no es válido.");
  return parsed.origin;
}

export function trustedOrigins(): string[] {
  return [...new Set([
    appOrigin(),
    ...(process.env.VERCEL_BRANCH_URL ? [`https://${process.env.VERCEL_BRANCH_URL}`] : []),
    ...(process.env.VERCEL_ENV === "production" ? ["https://euromillones-check.vercel.app"] : []),
  ])];
}

function createAuth() {
  if (!process.env.BETTER_AUTH_SECRET) throw new Error("El acceso privado no está configurado.");
  return betterAuth({
    appName: "EuroControl",
    baseURL: appOrigin(),
    trustedOrigins: trustedOrigins(),
    secret: process.env.BETTER_AUTH_SECRET,
    database: getPool(),
    emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128 },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 30 },
  });
}

let instance: ReturnType<typeof createAuth> | undefined;
export function getAuth() { return instance ??= createAuth(); }
