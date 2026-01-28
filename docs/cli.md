# RocketBase CLI

The RocketBase CLI (`vrb-cli`) provides command-line tools for managing your
RocketBase instance, including authentication, database management, and
migrations.

## Installation

The CLI is available as `client/cli.ts`. Make it executable:

```bash
deno install -A -g -n vrb-cli https://raw.githubusercontent.com/vski-ai/sdk/refs/main/cli.ts
```

You can then run it directly:

```bash
vrb-cli <command> [options]
```

## Configuration

The CLI stores configuration in `~/.roketbase/config.json`. This includes:

- `url`: RocketBase API URL
- `token`: Authentication token (optional)
- `email`: Admin email (optional)

## Commands

### `login`

Authenticates as a superuser and saves the token for subsequent commands.

```bash
vrb-cli login --email <email> --password <password>
```

**Options:**

- `--url, -u`: API URL (default: saved config or http://127.0.0.1:3000)
- `--email, -e`: Admin email
- `--password, -p`: Admin password

**Example:**

```bash
vrb-cli login --url http://localhost:3000 --email admin@example.com --password secret123
```

### `db:create`

Creates a new tenant database.

```bash
vrb-cli db:create <name>
```

**Arguments:**

- `name`: Database name (required)

**Options:**

- `--url, -u`: API URL (default: saved config)

**Example:**

```bash
vrb-cli db:create my_app_db
```

### `db:list`

Lists all tenant databases.

```bash
vrb-cli db:list
```

**Options:**

- `--url, -u`: API URL (default: saved config)

**Example:**

```bash
vrb-cli db:list
```

### `db:delete`

Deletes a tenant database (with confirmation prompt).

```bash
vrb-cli db:delete <name>
```

**Arguments:**

- `name`: Database name to delete (required)

**Options:**

- `--url, -u`: API URL (default: saved config)

**Example:**

```bash
vrb-cli db:delete old_db
```

### `db:generate`

Generates a migration file from the current database state. This is useful for
capturing the current schema and creating versioned migrations.

```bash
vrb-cli db:generate [options]
```

**Options:**

- `--url, -u`: API URL (default: saved config)
- `--db, -d`: Target database name (default: postgres)
- `--out, -o`: Output file path (default: `migrations_<timestamp>.ts`)

**Behavior:**

- Fetches all user collections from the database
- Excludes system collections
- Generates TypeScript migration file with `create` calls for each collection
- Creates snapshot migration file

**Example:**

```bash
# Generate from postgres database
vrb-cli db:generate --db postgres

# Generate to specific file
vrb-cli db:generate --db my_app --out init_schema.ts
```

**Output Format:** The generated migration exports a `migrations` array with
objects containing:

- `name`: Migration name (timestamp + suffix)
- `up`: Async function that receives `RocketBaseClient` instance
- The function creates collections using `sdk.settings.collections.create()`

### `migrate`

Runs migrations from a migration file against a database.

```bash
vrb-cli migrate <path-to-migrations.ts> --db=<database>
```

**Arguments:**

- `path`: Path to migration file (required)

**Options:**

- `--url, -u`: API URL (default: saved config)
- `--db, -d`: Target database name (default: postgres)

**Behavior:**

- Loads migration file as a module
- Expects the module to export a `migrations` array (named export or default
  export)
- Executes each migration's `up` function with a client instance
- Commits all changes in a single operation

**Migration File Format:**

```typescript
import type { RocketBaseClient } from "https://raw.githubusercontent.com/vski-ai/sdk/main/exports.ts";

export const migrations = [
  {
    name: "migration_name",
    up: async (sdk: RocketBaseClient) => {
      await sdk.settings.collections.create({
        id: "my_collection",
        name: "My Collection",
        type: "base",
        fields: [...]
      });
    }
  }
];
```

**Example:**

```bash
# Run migrations against postgres database
vrb-cli migrate ./migrations/init.ts --db postgres

# Run against specific database
vrb-cli migrate ./migrations/init.ts --db my_app_db
```

## Usage Examples

### Complete Setup Workflow

```bash
# 1. Login to get API access
vrb-cli login --email admin@example.com --password secret

# 2. Create a new database for your app
vrb-cli db:create telegram_bot

# 3. Create your collections manually or use the API

# 4. Generate a migration from current state
vrb-cli db:generate --db telegram_bot --out init_migrations.ts

# 5. Later, run the migration to set up a new environment
vrb-cli migrate ./init_migrations.ts --db telegram_bot
```

### Database Management

```bash
# List all databases
vrb-cli db:list

# Delete old database
vrb-cli db:delete test_db --url http://localhost:3000
```

## Best Practices

1. **Version Control**: Always commit migration files to version control
2. **Naming Conventions**: Use descriptive migration names like `init_schema` or
   `add_user_preferences`
3. **Incremental Migrations**: Create separate migration files for each schema
   change
4. **Testing**: Test migrations on a copy of your database first
5. **Backups**: Always backup your database before running destructive
   migrations

## Error Handling

- Authentication failures: Check email and password, ensure API URL is correct
- Network errors: Verify RocketBase server is running and accessible
- Migration failures: Check collection definitions don't conflict with existing
  ones

## Permissions

The CLI requires the following Deno permissions:

- `--allow-env`: To read configuration and API URLs
- `--allow-read`: To read configuration and migration files
- `--allow-write`: To save configuration and generate migration files
- `--allow-net`: To communicate with RocketBase API
