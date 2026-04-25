import express from "express";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { createServer, type Server as HttpServer } from "node:http";
import { config as loadEnv } from "dotenv";
import { readAgents } from "./state.js";
import { createDispatcher, type Dispatcher } from "./dispatch/core.js";
import { createRunner } from "./dispatch/runner.js";
import { createIngestBus } from "./channels/bus.js";
import { TelegramChannel } from "./channels/telegram.js";
import { createCronTrigger } from "./triggers/cron.js";
import { resolveBindHost } from "./channels/server-bind.js";
import type { Channel, Mount, MountOptions, HttpMethod } from "./channels/index.js";
import type { RequestHandler } from "express";

export interface ServerHandle {
  dispatcher: Dispatcher;
  stop(): Promise<void>;
}

export async function startServer(workspace: string): Promise<ServerHandle> {
  loadEnv({ path: join(workspace, ".env") });
  const port = Number(process.env.PORT ?? 3000);

  const secretsRaw = await fs.readFile(join(workspace, "state/secrets.json"), "utf8");
  const secrets = JSON.parse(secretsRaw) as { telegramWebhookSecret: string };

  const dispatcher = createDispatcher({ workspace, runner: createRunner() });
  const channels = new Map<string, Channel>();
  const telegram = new TelegramChannel({ secretOverride: secrets.telegramWebhookSecret });
  channels.set("telegram", telegram);

  const app = express();
  const bus = createIngestBus({ dispatcher, channels });

  const mounts: Mount[] = [];
  const mount = (method: HttpMethod, path: string, handler: RequestHandler, opts?: MountOptions): void => {
    const isPublic = opts?.public ?? false;
    mounts.push({ method, path, handler, public: isPublic });
    const verb = method.toLowerCase() as Lowercase<HttpMethod>;
    app[verb](path, handler);
  };

  const appendSystemLog = async (entry: object): Promise<void> => {
    await fs.appendFile(
      join(workspace, "system.log"),
      JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n",
    );
  };

  await telegram.start({
    app,
    mount,
    bus,
    config: {
      token: process.env.TELEGRAM_BOT_TOKEN ?? "",
      publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "",
    },
    log: appendSystemLog,
  });

  const cron = createCronTrigger({
    dispatcher,
    writeDream: async (agent, payload, result) => {
      const dir = join(workspace, "agents", agent, "dreams");
      await fs.mkdir(dir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      await fs.writeFile(join(dir, `${ts}.md`), `# ${ts}\n\n## Payload\n\n${payload}\n\n## Result\n\n${result}\n`);
    },
    logLine: appendSystemLog,
  });

  const registry = await readAgents(workspace);
  await cron.start({ bus, channels, registry, workspace });

  const httpServer: HttpServer = createServer(app);
  const bindHost = resolveBindHost(mounts);
  if (bindHost !== null) {
    await new Promise<void>((resolve) => httpServer.listen(port, bindHost, resolve));
  }

  const stop = async (): Promise<void> => {
    await cron.stop();
    await telegram.stop();
    if (bindHost !== null) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  };

  const onSignal = async (): Promise<void> => { await stop(); process.exit(0); };
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);

  return { dispatcher, stop };
}
