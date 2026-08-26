#!/usr/bin/env node
/**
 * Issue #1076: mainnet readiness gate for the payments admin write toggle.
 *
 * Verifies that admin-mutation environment toggles are set to safe
 * production values before a mainnet launch/readiness check passes.
 *
 * Usage: node scripts/check-mainnet-admin-toggle-readiness.mjs
 *
 * Expected production values:
 *   PAYMENTS_ADMIN_WRITE_ENABLED=false  (writes disabled by default)
 *   PAYMENTS_ADMIN_API_KEY set to a non-empty, non-default value
 */
const problems = [];

const writeEnabled = process.env.PAYMENTS_ADMIN_WRITE_ENABLED;
if (writeEnabled === undefined) {
  problems.push('PAYMENTS_ADMIN_WRITE_ENABLED is not set.');
} else if (writeEnabled.toLowerCase() !== 'false') {
  problems.push(
    `PAYMENTS_ADMIN_WRITE_ENABLED is "${writeEnabled}", expected "false" for mainnet readiness.`
  );
}

const adminKey = process.env.PAYMENTS_ADMIN_API_KEY;
if (!adminKey) {
  problems.push('PAYMENTS_ADMIN_API_KEY is not set.');
} else if (adminKey === 'changeme' || adminKey.length < 16) {
  problems.push('PAYMENTS_ADMIN_API_KEY looks like a placeholder or is too short.');
}

if (problems.length > 0) {
  console.error('Mainnet readiness check FAILED — unsafe admin write-toggle configuration:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log('Mainnet readiness check passed: admin write-toggle configuration is safe.');
