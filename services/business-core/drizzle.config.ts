import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL is required");
}

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/database/schema.ts", "./src/database/crm.schema.ts", "./src/database/pre-project.schema.ts", "./src/database/catalog.schema.ts", "./src/database/commercial.schema.ts", "./src/database/site.schema.ts", "./src/database/sourcing.schema.ts"],
  out: "./drizzle",
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
});
