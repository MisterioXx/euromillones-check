import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fetchEuromillonesResult } from "./src/server/checkEuromillones";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "local-vercel-api",
      configureServer(server) {
        server.middlewares.use("/api/check-euromillones", async (request, response) => {
          const url = new URL(request.url ?? "/", "http://localhost");
          const result = await fetchEuromillonesResult(url.searchParams.get("date") ?? undefined);
          response.statusCode = result.ok ? 200 : 502;
          response.setHeader("content-type", "application/json; charset=utf-8");
          response.end(JSON.stringify(result));
        });
      },
    },
  ],
  build: {
    sourcemap: false,
  },
});
