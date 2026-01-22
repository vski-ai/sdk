#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write --allow-net
import { parseArgs } from "@std/cli/parse-args";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { RocketBaseClient } from "https://raw.githubusercontent.com/vski-ai/sdk/main/exports.ts";

// @ts-ignore: tsconfig conflict deno <- tsconf
const { args: $args, env, cwd, readTextFile, writeTextFile, exit } = Deno;

const CONFIG_DIR = join(
  env.get("HOME") || env.get("USERPROFILE") || ".",
  ".roketbase",
);
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

interface Config {
  url: string;
  token?: string;
  email?: string;
}

async function loadConfig(): Promise<Config> {
  try {
    const text = await readTextFile(CONFIG_FILE);
    return JSON.parse(text);
  } catch {
    return { url: "http://127.0.0.1:3000" };
  }
}

async function saveConfig(config: Config) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeTextFile(CONFIG_FILE, JSON.stringify(config, null, 2));
}

async function getClient(dbName = "postgres") {
  const config = await loadConfig();
  const client = new RocketBaseClient(config.url);
  client.setDb(dbName);
  if (config.token) {
    client.setToken(config.token);
  }
  return { client, config };
}

async function main() {
  const args = parseArgs($args, {
    string: ["url", "email", "password", "db"],
    alias: { u: "url", e: "email", p: "password", d: "db" },
  });

  const cmd = args._[0];

  if (!cmd) {
    const currentYear = new Date().getFullYear();
    console.log(`
VSKI RocketBase CLI
__      _______  ____
\\ \\    / /  __ \\|  _ \\
 \\ \\  / /| |__) | |_) |
  \\ \\/ / |  _  /|  _ <
   \\  /  | | \\ \\| |_) |
    \\/   |_|  \\_\\____/


Usage:

  vrb-cli <command> [options]

Commands:
  login           Log in as a superuser
  db:create       Create a new tenant database
  db:list         List all tenant databases
  db:delete       Delete a tenant database
  db:generate     Generate migration file from current db state
  migrate         Run migrations from a file

Options:
  --url, -u       API URL (default: saved config or http://127.0.0.1:3000)
  --email, -e     Admin email (for login)
  --password, -p  Admin password (for login)
  --db, -d        Target database (for migrations, default: postgres)
  --out, -o       Output file (for db:generate, default: migrations_<timestamp>.ts)



Anton A Nesterov (c) 2024-${currentYear} | https://github.com/nesterow
    `);
    exit(0);
  }

  try {
    switch (cmd) {
      case "login": {
        const url = args.url || (await loadConfig()).url;
        const email = args.email || prompt("Admin Email:");
        const password = args.password || prompt("Password:");

        if (!email || !password) {
          console.error("Email and password are required.");
          exit(1);
        }

        const client = new RocketBaseClient(url);
        try {
          console.log(`Authenticating with ${url}...`);
          await client.admins.authWithPassword(email, password);

          const token = client.getToken();
          if (token) {
            await saveConfig({ url, token, email });
            console.log("Login successful! Token saved.");
          } else {
            console.error("Login failed: No token received.");
          }
        } catch (e) {
          console.error("Login failed:", e.message);
        }
        break;
      }

      case "db:list": {
        const { client } = await getClient();
        console.log("Fetching databases...");
        const dbs = await client.settings.databases.list();
        console.table(dbs.map((d: string) => ({ name: d })));
        break;
      }

      case "db:create": {
        const name = args._[1]?.toString();
        if (!name) {
          console.error("Usage: db:create <name>");
          exit(1);
        }
        const { client } = await getClient();
        console.log(`Creating database '${name}'...`);
        try {
          const res = await client.settings.databases.create({ name });
          console.log("Database created:", res);
        } catch (e) {
          if (e.message.includes("already exists")) {
            console.log(`Database '${name}' already exists.`);
          } else {
            throw e;
          }
        }
        break;
      }

      case "db:delete": {
        const name = args._[1]?.toString();
        if (!name) {
          console.error("Usage: db:delete <name>");
          exit(1);
        }
        const confirm = prompt(
          `Are you sure you want to delete '${name}'? (y/N)`,
        );
        if (confirm?.toLowerCase() !== "y") {
          console.log("Aborted.");
          exit(0);
        }

        const { client } = await getClient();
        await client.settings.databases.delete(name);
        console.log(`Database '${name}' deleted.`);
        break;
      }

      case "db:generate": {
        const dbName = args.db || "postgres";
        const { client } = await getClient(dbName);
        console.log(`Fetching collections from '${dbName}'...`);

        const collections = await client.settings.collections.getList();
        // Filter out system collections
        const userCollections = collections.filter((c: { system: boolean }) =>
          !c.system
        );

        if (userCollections.length === 0) {
          console.log("No user collections found.");
          exit(0);
        }

        const timestamp = new Date()
          .toISOString()
          .replace(/[-:T.]/g, "")
          .slice(0, 14);
        const outFile = args.out || `migrations_${timestamp}.ts`;

        const code = `
// generated with vrb-cli
import type { RocketBaseClient } from "https://raw.githubusercontent.com/vski-ai/sdk/main/exports.ts";
export const migrations = [
  {
    name: "${timestamp}_snapshot",
    up: async (sdk: RocketBaseClient) => {
${
          userCollections
            .map((col: Record<string, unknown>) => {
              // Clean up internal fields if necessary
              const { id: _, created: __, updated: ___, ...data } = col;
              return `      await sdk.settings.collections.create(${
                JSON.stringify(data, null, 2).replace(/\n/g, "\n      ")
              });`;
            })
            .join("\n\n")
        }
    },
  },
];
`;
        await writeTextFile(outFile, code);
        console.log(`Migration generated: ${outFile}`);
        break;
      }

      case "migrate": {
        const file = args._[1]?.toString();
        if (!file) {
          console.error("Usage: migrate <path-to-migrations.ts> --db=<dbname>");
          exit(1);
        }

        const dbName = args.db || "postgres";
        const { client } = await getClient(dbName);

        console.log(`Target Database: ${dbName}`);
        console.log(`Loading migrations from: ${file}`);

        try {
          const filePath = resolve(cwd(), file);
          const mod = await import("file://" + filePath);

          // Expecting 'migrations' export or default export to be the array
          const migrations = mod.migrations || mod.default ||
            Object.values(mod)[0];

          if (!Array.isArray(migrations)) {
            throw new Error(
              "Module must export an array of migrations (named 'migrations' or default).",
            );
          }

          console.log(`Found ${migrations.length} definitions.`);
          await client.migrations.run(migrations);
          console.log("Migration sync complete.");
        } catch (e) {
          console.error("Migration failed:", e);
          console.error(e.message);
        }
        break;
      }

      default:
        console.error(`Unknown command: ${cmd}`);
        exit(1);
    }
  } catch (err) {
    console.error("Error:", err.message);
    exit(1);
  }
}

if (import.meta.main) {
  main();
}
