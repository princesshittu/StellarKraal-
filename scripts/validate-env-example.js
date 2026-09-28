#!/usr/bin/env node
// Validates that:
//   1. Every variable declared in backend/src/config.ts has an entry in .env.example
//   2. Every variable declared in backend/src/config.ts is documented in
//      docs/guides/environment-variables.md
//   3. Every Docker-specific variable (defined in DOCKER_VARS below) has an
//      entry in .env.example and is documented in environment-variables.md
//
// Exits with code 1 if any variable is missing from either file.

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const configPath = path.join(root, "backend", "src", "config.ts");
const examplePath = path.join(root, ".env.example");
const docsPath = path.join(root, "docs", "guides", "environment-variables.md");

const configSrc = fs.readFileSync(configPath, "utf8");
const exampleSrc = fs.readFileSync(examplePath, "utf8");
const docsSrc = fs.readFileSync(docsPath, "utf8");

// ---------------------------------------------------------------------------
// Docker-specific variables that live only in docker-compose files (not in
// backend/src/config.ts) but still need to be documented in .env.example and
// environment-variables.md so developers know they exist.
// ---------------------------------------------------------------------------
const DOCKER_VARS = [
  // Grafana observability service (docker-compose.prod.yml uses env_file: .env)
  "GF_SECURITY_ADMIN_USER",
  "GF_SECURITY_ADMIN_PASSWORD",
  "GF_AUTH_ANONYMOUS_ENABLED",
  "GF_AUTH_ANONYMOUS_ORG_ROLE",
  // Staging overrides (docker-compose.staging.yml)
  "STAGING_RPC_URL",
  "STAGING_CONTRACT_ID",
  "STAGING_API_URL",
  "STAGING_FRONTEND_URL",
];

// ---------------------------------------------------------------------------
// Extract variable names from z.object({ KEY: ... }) in config.ts
// ---------------------------------------------------------------------------
const keyRegex = /^\s{2}(\w+):/gm;
const configKeys = [];
let m;
while ((m = keyRegex.exec(configSrc)) !== null) {
  configKeys.push(m[1]);
}

// ---------------------------------------------------------------------------
// Extract keys present in .env.example (lines starting with KEY= or # KEY=)
// ---------------------------------------------------------------------------
const exampleKeys = new Set(
  exampleSrc
    .split("\n")
    .map((l) => l.replace(/^#\s*/, "").match(/^([A-Z_][A-Z0-9_]*)=/))
    .filter(Boolean)
    .map((m) => m[1])
);

// ---------------------------------------------------------------------------
// Extract keys mentioned in the docs (backtick-quoted uppercase variable names)
// ---------------------------------------------------------------------------
const docKeyRegex = /`([A-Z_][A-Z0-9_]*)`/g;
const docKeys = new Set();
let d;
while ((d = docKeyRegex.exec(docsSrc)) !== null) {
  docKeys.add(d[1]);
}

let hasError = false;

// ---------------------------------------------------------------------------
// Check 1: every backend config key must be in .env.example
// ---------------------------------------------------------------------------
const missingFromExample = configKeys.filter((k) => !exampleKeys.has(k));
if (missingFromExample.length > 0) {
  console.error("❌ .env.example is missing variables defined in config.ts:");
  missingFromExample.forEach((k) => console.error(`  - ${k}`));
  hasError = true;
}

// ---------------------------------------------------------------------------
// Check 2: every backend config key must appear in the docs
// ---------------------------------------------------------------------------
const missingFromDocs = configKeys.filter((k) => !docKeys.has(k));
if (missingFromDocs.length > 0) {
  console.error(
    "\n❌ docs/guides/environment-variables.md is missing variables defined in config.ts:"
  );
  missingFromDocs.forEach((k) => console.error(`  - ${k}`));
  hasError = true;
}

// ---------------------------------------------------------------------------
// Check 3: every Docker-specific variable must be in .env.example
// ---------------------------------------------------------------------------
const dockerMissingFromExample = DOCKER_VARS.filter((k) => !exampleKeys.has(k));
if (dockerMissingFromExample.length > 0) {
  console.error(
    "\n❌ .env.example is missing Docker-specific variables:"
  );
  dockerMissingFromExample.forEach((k) => console.error(`  - ${k}`));
  hasError = true;
}

// ---------------------------------------------------------------------------
// Check 4: every Docker-specific variable must appear in the docs
// ---------------------------------------------------------------------------
const dockerMissingFromDocs = DOCKER_VARS.filter((k) => !docKeys.has(k));
if (dockerMissingFromDocs.length > 0) {
  console.error(
    "\n❌ docs/guides/environment-variables.md is missing Docker-specific variables:"
  );
  dockerMissingFromDocs.forEach((k) => console.error(`  - ${k}`));
  hasError = true;
}

if (hasError) {
  process.exit(1);
}

console.log(
  `✅ .env.example and environment-variables.md cover all ${configKeys.length} backend config variables and ${DOCKER_VARS.length} Docker-specific variables.`
);
