#!/usr/bin/env node
/**
 * Issue #1073: alert on contract interface drift after deployment.
 *
 * Compares the checksum of the currently deployed contract's interface
 * (as recorded in deployments.json) against the checksum of the committed
 * interface artifact (contracts/interface/splitnaira.contract-interface.json).
 * A mismatch means the deployed contract no longer matches what's committed.
 *
 * Usage: node scripts/check-contract-interface-drift.mjs [network]
 *
 * Remediation on drift: re-run `npm run generate:contract-interface`,
 * commit the regenerated artifact, and redeploy so deployed state and
 * the committed interface stay in sync.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const network = process.argv[2] || 'mainnet';
const repoRoot = process.cwd();

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

try {
  const deployments = JSON.parse(
    readFileSync(join(repoRoot, 'deployments.json'), 'utf8')
  );
  const record = deployments[network];
  if (!record || !record.interfaceChecksum) {
    console.error(`No recorded interfaceChecksum for network [${network}].`);
    process.exit(2);
  }

  const committedInterface = readFileSync(
    join(repoRoot, 'contracts/interface/splitnaira.contract-interface.json'),
    'utf8'
  );
  const committedChecksum = sha256(committedInterface);

  if (committedChecksum !== record.interfaceChecksum) {
    console.error(
      `Contract interface drift detected on [${network}]: deployed checksum ` +
        `${record.interfaceChecksum} does not match committed artifact checksum ${committedChecksum}.`
    );
    process.exit(1);
  }

  console.log(`Contract interface for [${network}] matches deployed checksum.`);
} catch (err) {
  console.error(`Interface drift check failed: ${err.message}`);
  process.exit(2);
}
