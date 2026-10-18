import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import resultHandler from "./api/check-euromillones";
import cloudHandler from "./api/cloud";
import authHandler from "./api/auth";

export default defineConfig(({ mode }) => {
  // Only VITE_* variables are exposed by Vite to the client. These stay in Node.
  const environment = loadEnv(mode, process.cwd(), "");
  for (const key of ["DATABASE_URL", "BETTER_AUTH_SECRET", "CRON_SECRET", "APP_ORIGIN"]) {
    if (!process.env[key] && environment[key]) process.env[key] = environment[key];
  }
  return {
  server: { port: 5173, strictPort: true },
  plugins: [
    react(),
    {
      name: "local-vercel-api",
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          const url = new URL(request.url ?? "/", "http://localhost");
          if (url.pathname === "/api/check-euromillones") {
            const adapter = { setHeader: (key: string, value: string) => { response.setHeader(key, value); },
              status: (code: number) => { response.statusCode = code; return adapter; },
              json: (body: unknown) => { response.end(JSON.stringify(body)); } };
            return resultHandler(request, adapter);
          }
          if (url.pathname === "/api/cloud") return cloudHandler(request, response);
          if (url.pathname.startsWith("/api/auth/")) return authHandler(request, response);
          if (url.pathname === "/api/cron") {
            const { default: cronHandler } = await import("./api/cron");
            return cronHandler(request, response);
          }
          next();
        });
      },
    },
  ],
  build: {
    sourcemap: false,
  },
};
});
