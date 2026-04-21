#!/usr/bin/env node
/**
 * Pre-flight health check before starting dev server.
 * If DATABASE_URL is set, verify the database is actually reachable.
 * Fail loudly if not - don't silently fall back.
 */

import { spawn } from "child_process";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.log("✓ DATABASE_URL not set - seed data mode OK");
  process.exit(0);
}

console.log(`🔍 Checking database connectivity...`);

// Parse the connection string
const match = DATABASE_URL.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)$/);
if (!match) {
  console.error("❌ Invalid DATABASE_URL format");
  process.exit(1);
}

const [, user, password, host, port, database] = match;

// Use mysql CLI to test connection
let output = "";
let error = "";

const mysql = spawn("mysql", [
  "-h", host,
  "-P", port,
  "-u", user,
  `-p${password}`,
  "-D", database,
  "-e", "SELECT 1;"
], { stdio: ["pipe", "pipe", "pipe"] });

mysql.stdout.on("data", (data) => {
  output += data.toString();
});

mysql.stderr.on("data", (data) => {
  error += data.toString();
});

mysql.on("close", (code) => {
  if (code === 0 && output.includes("1")) {
    console.log("✓ Database is reachable");
    
    // Also verify schema is initialized (Prisma migrations applied)
    checkSchemaInitialized(host, port, user, password, database);
  } else {
    console.error("❌ Database connection failed!");
    console.error(`   Host: ${host}:${port}`);
    console.error(`   Database: ${database}`);
    if (error) console.error(`   Error: ${error.trim()}`);
    console.error("");
    console.error("🔧 Fix this by:");
    console.error("   1. Start Docker: docker-compose up -d db");
    console.error("   2. Wait for container to be healthy");
    console.error("   3. Retry: npm run dev");
    console.error("");
    process.exit(1);
  }
});

function checkSchemaInitialized(host, port, user, password, database) {
  // Check if _prisma_migrations table exists (indicates migrations have run)
  let schemaOutput = "";
  let schemaError = "";
  
  const schemaMysql = spawn("mysql", [
    "-h", host,
    "-P", port,
    "-u", user,
    `-p${password}`,
    "-D", database,
    "-e", "SHOW TABLES LIKE '_prisma_migrations';"
  ], { stdio: ["pipe", "pipe", "pipe"] });
  
  schemaMysql.stdout.on("data", (data) => {
    schemaOutput += data.toString();
  });
  
  schemaMysql.stderr.on("data", (data) => {
    schemaError += data.toString();
  });
  
  schemaMysql.on("close", (code) => {
    if (code === 0 && schemaOutput.includes("_prisma_migrations")) {
      console.log("✓ Database schema is initialized");
      process.exit(0);
    } else {
      console.error("❌ Database schema not initialized (Prisma migrations not applied)");
      console.error("");
      console.error("🔧 Fix this by running migrations:");
      console.error("   DATABASE_URL=mysql://root:yehthatrocks@127.0.0.1:3307/yeh_live npx prisma migrate deploy");
      console.error("");
      process.exit(1);
    }
  });
  
  schemaMysql.on("error", (err) => {
    console.error("❌ Failed to check database schema!");
    console.error(`   Error: ${err.message}`);
    process.exit(1);
  });
}

mysql.on("error", (err) => {
  console.error("❌ Failed to run mysql command!");
  console.error(`   Make sure 'mysql' CLI is installed and in PATH`);
  console.error(`   Error: ${err.message}`);
  console.error("");
  console.error("🔧 Install MySQL CLI or skip this check by not setting DATABASE_URL");
  process.exit(1);
});
