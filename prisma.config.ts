import "dotenv/config";
import { defineConfig } from "prisma/config";

const dbUrl =
  process.env.DIRECT_URL ||
  process.env.DATABASE_URL ||
  "postgresql://dummy:dummy@localhost:5432/neondb";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: dbUrl,
  },
});

