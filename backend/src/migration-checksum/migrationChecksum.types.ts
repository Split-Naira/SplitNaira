export interface MigrationFile {
  name: string;
  content: string;
}

export interface AppliedMigration {
  name: string;
  checksum: string | null;
}

export interface MigrationChecksumMismatch {
  name: string;
  expectedChecksum: string | null;
  actualChecksum: string | null;
  reason:
    | "checksum_mismatch"
    | "missing_checksum"
    | "missing_migration_file";
}

export interface MigrationChecksumVerificationResult {
  valid: boolean;
  checkedMigrations: number;
  mismatches: MigrationChecksumMismatch[];
}

export interface MigrationChecksumRepository {
  getAppliedMigrations(): Promise<AppliedMigration[]>;
}

export interface MigrationFileSource {
  getMigrationFiles(): Promise<MigrationFile[]>;
}

export interface MigrationChecksumVerifierOptions {
  environment: string;
  failOnMismatchInProduction?: boolean;
}