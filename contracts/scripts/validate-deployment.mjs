import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const networkArg = process.argv[2] || 'testnet';

try {
  const deploymentsPath = join(process.cwd(), 'deployments.json');
  const registry = JSON.parse(readFileSync(deploymentsPath, 'utf8'));
  const record = registry[networkArg];

  if (!record) {
    console.error(`❌ Error: No deployment footprint entry located matching network: [${networkArg}]`);
    process.exit(1);
  }

  console.log(`🔍 Inspecting network [${networkArg}] contract matching: ${record.contractId}...`);

  // Query network state through native Stellar developer CLI tool mirrors
  const cliOutput = execSync(
    `stellar contract id status --id ${record.contractId} --network ${networkArg}`,
    { encoding: 'utf8' }
  );

  // Extract the live WASM hash from the response metrics
  const onChainHashMatch = cliOutput.match(/Wasm Hash:\s+([a-f0-9]+)/i);
  
  if (!onChainHashMatch) {
    console.error('❌ Operational Error: Failed to extract structural WASM metadata from ledger lookup parameters.');
    console.log('CLI Trace:', cliOutput);
    process.exit(1);
  }

  const liveWasmHash = onChainHashMatch[1].toLowerCase();
  const fileWasmHash = record.wasmHash.toLowerCase();

  console.log(`➡️ File Signature:   ${fileWasmHash}`);
  console.log(`➡️ On-Chain Engine:  ${liveWasmHash}`);

  if (liveWasmHash !== fileWasmHash) {
    console.error('🚨 INTEGRITY FAILURE: Local codebase artifact hashes deviate from deployed on-chain ledger bytecode!');
    process.exit(2);
  }

  console.log('✅ VALIDATION PASSED: Local version hashes align precisely with live network records.');
  process.exit(0);

} catch (error) {
  console.error('❌ Verification Pipeline Exception Abort:', error.message);
  process.exit(1);
}