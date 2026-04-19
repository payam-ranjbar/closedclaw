import { promises as fs } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import cron from "node-cron";
import type { Trigger, TriggerContext, CronSpec } from "./index.js";
import type { Dispatcher } from "../dispatch/core.js";

export async function loadCronSpecs(workspace: string): Promise<CronSpec[]> {
  const files = [join(workspace, "crons.yaml")];
  const agentsDir = join(workspace, "agents");
  try {
    const entries = await fs.readdir(agentsDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) files.push(join(agentsDir, e.name, "crons.yaml"));
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  const all: CronSpec[] = [];
  for (const f of files) {
    let raw: string;
    try {
      raw = await fs.readFile(f, "utf8");
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    const parsed = parseYaml(raw) as CronSpec[] | null;
    if (Array.isArray(parsed)) all.push(...parsed);
  }

  const ids = new Set<string>();
  for (const s of all) {
    if (ids.has(s.id)) throw new Error(`duplicate cron id: ${s.id}`);
    ids.add(s.id);
  }
  return all;
}

interface Options {
  dispatcher: Dispatcher;
  writeDream: (agent: string, payload: string, result: string) => Promise<void>;
  logLine: (line: object) => Promise<void>;
}

export function createCronTrigger(opts: Options): Trigger {
  const tasks: cron.ScheduledTask[] = [];

  return {
    name: "cron",

    async start(ctx: TriggerContext): Promise<void> {
      const specs = await loadCronSpecs(ctx.workspace);
      for (const spec of specs) {
        const task = cron.schedule(spec.schedule, async () => {
          const res = await opts.dispatcher.dispatch({
            agent: spec.agent,
            payload: spec.payload,
            timeoutMs: spec.timeoutMs,
            origin: { kind: "trigger", name: "cron" },
          });
          await opts.logLine({ cron_id: spec.id, agent: spec.agent, ok: res.ok, error: res.error });
          if (res.ok && spec.reply_to === null && res.result) {
            await opts.writeDream(spec.agent, spec.payload, res.result);
          } else if (res.ok && spec.reply_to && res.result) {
            const channel = ctx.channels.get(spec.reply_to.channel);
            if (channel) {
              await channel.reply({ channel: spec.reply_to.channel, conversationId: spec.reply_to.conversationId }, res.result);
            }
          } else if (!res.ok && spec.reply_to) {
            const channel = ctx.channels.get(spec.reply_to.channel);
            if (channel) {
              await channel.reply(
                { channel: spec.reply_to.channel, conversationId: spec.reply_to.conversationId },
                `cron ${spec.id} failed: ${res.error?.code}`,
              );
            }
          }
        });
        tasks.push(task);
      }
    },

    async stop(): Promise<void> {
      for (const t of tasks) t.stop();
      tasks.length = 0;
    },
  };
}
