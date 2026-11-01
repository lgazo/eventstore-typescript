#!/usr/bin/env node
/**
 * Lockstep version manager for the published packages.
 *
 * - `scripts/lockstep-version.mjs`           -> verify all versions match, print the version
 * - `scripts/lockstep-version.mjs 1.3.0`     -> set all packages (and their
 *   `@lgazo/eventstore` dependency range) to the given version
 */
import { readFileSync, writeFileSync } from 'node:fs';

const files = [
  'packages/core/package.json',
  'packages/postgres/package.json',
  'packages/d1/package.json',
  'packages/supabase/package.json',
];

const versions = files.map((file) => JSON.parse(readFileSync(file, 'utf8')).version);

if (process.argv[2] === undefined) {
  const versionsByKey = Object.fromEntries(files.map((file, index) => [file, versions[index]]));
  const unique = [...new Set(versions)];
  if (unique.length !== 1) {
    console.error(`lockstep-version: package versions drift: ${JSON.stringify(versionsByKey, null, 2)}`);
    process.exit(1);
  }
  console.log(unique[0]);
  process.exit(0);
}

const target = process.argv[2];
if (!/^\d+\.\d+\.\d+(?:-[0-9a-z.]+)?$/.test(target)) {
  console.error(`lockstep-version: invalid version "${target}" (expected x.y.z[-suffix])`);
  process.exit(1);
}

for (const file of files) {
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  pkg.version = target;
  if (pkg.dependencies?.['@lgazo/eventstore']) {
    pkg.dependencies['@lgazo/eventstore'] = `^${target}`;
  }
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
}
console.log(target);
