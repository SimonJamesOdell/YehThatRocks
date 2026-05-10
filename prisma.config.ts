import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  // DATABASE_URL is optional for generate-only workflows in this repo.
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
