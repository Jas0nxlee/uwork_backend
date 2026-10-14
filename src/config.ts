import { z } from "zod";
export function environment() {
  const env = z
    .object({
      DATABASE_PATH: z.string().default("data/uwork.sqlite"),
      MASTER_KEY: z.string().regex(/^[0-9a-f]{64}$/i),
      PUBLIC_URL: z
        .url()
        .refine((value) => {
          const u = new URL(value);
          return (
            ["https:", "http:"].includes(u.protocol) &&
            !u.username &&
            !u.password &&
            !u.search &&
            !u.hash &&
            u.pathname === "/"
          );
        }, "PUBLIC_URL must be a credential-free HTTP(S) origin")
        .default("http://localhost:3000"),
      HOST: z.string().default("127.0.0.1"),
      PORT: z.coerce.number().int().min(1).max(65535).default(3000),
      ALLOW_PRIVATE_UPSTREAMS: z.enum(["true", "false"]).default("false"),
      SANDBOX_DOCKER_SOCKET: z.string().max(512).optional(),
      SANDBOX_IMAGE: z.string().max(256).default("uwork-sandbox:local"),
    })
    .parse(process.env);
  if (
    !env.PUBLIC_URL.startsWith("https://") &&
    !["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(env.PUBLIC_URL).hostname,
    )
  )
    throw new Error("PUBLIC_URL requires HTTPS outside loopback");
  return {
    database: env.DATABASE_PATH,
    masterKey: Buffer.from(env.MASTER_KEY, "hex"),
    publicUrl: env.PUBLIC_URL,
    host: env.HOST,
    port: env.PORT,
    allowPrivateUpstreams: env.ALLOW_PRIVATE_UPSTREAMS === "true",
    sandboxSocket: env.SANDBOX_DOCKER_SOCKET,
    sandboxImage: env.SANDBOX_IMAGE,
  };
}
