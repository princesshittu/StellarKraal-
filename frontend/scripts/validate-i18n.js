#!/usr/bin/env node
/**
 * validate-i18n.js — Issue #1207
 *
 * CI lint step: validates that all keys present in the English (en) locale
 * are also present in every other supported locale (sw, etc.).
 *
 * Usage:
 *   node scripts/validate-i18n.js
 *
 * Exit code 1 if any missing keys are found, 0 otherwise.
 */

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.resolve(__dirname, '../public/locales');
const BASE_LOCALE = 'en';

/** Recursively collect all dotted key paths from a nested object. */
function collectKeys(obj, prefix = '') {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...collectKeys(v, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`  ✗ Failed to parse ${filePath}: ${err.message}`);
    process.exit(1);
  }
}

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((d) => fs.statSync(path.join(LOCALES_DIR, d)).isDirectory());

const namespaces = fs
  .readdirSync(path.join(LOCALES_DIR, BASE_LOCALE))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

let hasErrors = false;

console.log(`\n🌐  Validating i18n translation files (base: ${BASE_LOCALE})\n`);

for (const ns of namespaces) {
  const baseFile = path.join(LOCALES_DIR, BASE_LOCALE, `${ns}.json`);
  const baseData = loadJson(baseFile);
  const baseKeys = collectKeys(baseData);

  console.log(`  Namespace: ${ns} (${baseKeys.length} keys in ${BASE_LOCALE})`);

  for (const locale of locales) {
    if (locale === BASE_LOCALE) continue;

    const targetFile = path.join(LOCALES_DIR, locale, `${ns}.json`);
    if (!fs.existsSync(targetFile)) {
      console.error(`    ✗ [${locale}] Missing file: ${targetFile}`);
      hasErrors = true;
      continue;
    }

    const targetData = loadJson(targetFile);
    const targetKeys = new Set(collectKeys(targetData));
    const missing = baseKeys.filter((k) => !targetKeys.has(k));

    if (missing.length === 0) {
      console.log(`    ✓ [${locale}] All keys present`);
    } else {
      console.error(`    ✗ [${locale}] Missing ${missing.length} key(s):`);
      missing.forEach((k) => console.error(`        - ${k}`));
      hasErrors = true;
    }
  }
}

if (hasErrors) {
  console.error('\n❌  i18n validation failed — fix missing keys above.\n');
  process.exit(1);
} else {
  console.log('\n✅  All translation keys are present.\n');
  process.exit(0);
}
