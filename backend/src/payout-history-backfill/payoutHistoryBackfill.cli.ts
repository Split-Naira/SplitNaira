import { PayoutHistoryBackfillService } from "./payoutHistoryBackfill.service";

interface CliDependencies {
  service: PayoutHistoryBackfillService;
}

function getArgument(name: string): string | undefined {
  const prefix = `--${name}=`;

  return process.argv
    .slice(2)
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function getRequiredNumberArgument(name: string): number {
  const value = getArgument(name);

  if (!value) {
    throw new Error(`Missing required argument: --${name}`);
  }

  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue)) {
    throw new Error(
      `Argument --${name} must be a valid integer.`,
    );
  }

  return parsedValue;
}

export async function runPayoutHistoryBackfill(
  dependencies: CliDependencies,
): Promise<void> {
  const fromLedger = getRequiredNumberArgument("from-ledger");
  const toLedger = getRequiredNumberArgument("to-ledger");

  const sampleSizeValue = getArgument("sample-size");
  const sampleSize = sampleSizeValue
    ? Number(sampleSizeValue)
    : 10;

  const dryRun = hasFlag("dry-run");

  const result = await dependencies.service.run({
    fromLedger,
    toLedger,
    dryRun,
    sampleSize,
  });

  if (result.dryRun) {
    console.log("\nPayout History Backfill Dry Run");
    console.log("================================");
    console.log(
      `Ledger range: ${result.ledgerRange.from} - ${result.ledgerRange.to}`,
    );
    console.log(`Events found: ${result.counts.eventsFound}`);
    console.log(
      `Records to create: ${result.counts.recordsToCreate}`,
    );
    console.log(
      `Existing records: ${result.counts.existingRecords}`,
    );
    console.log("\nSample records:");

    if (result.sampleRecords.length === 0) {
      console.log("No new records would be created.");
    } else {
      console.table(result.sampleRecords);
    }

    console.log(
      "\nDry run complete. No database records were written.",
    );

    return;
  }

  console.log("\nPayout History Backfill Complete");
  console.log("================================");
  console.log(
    `Ledger range: ${result.ledgerRange.from} - ${result.ledgerRange.to}`,
  );
  console.log(`Events found: ${result.counts.eventsFound}`);
  console.log(
    `Records created: ${result.counts.recordsCreated}`,
  );
  console.log(
    `Existing records: ${result.counts.existingRecords}`,
  );
}