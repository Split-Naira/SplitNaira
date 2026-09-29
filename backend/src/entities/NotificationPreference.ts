import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * Notification categories a participant can express a preference about
 * (#1307).
 */
export const PREFERENCE_CATEGORIES = [
  "security",
  "payment",
  "project_activity",
  "participant_activity",
  "marketing",
] as const;

export type PreferenceCategory = (typeof PREFERENCE_CATEGORIES)[number];

/**
 * Categories that may never be silenced.
 *
 * `security` and `payment` carry account-safety and financial consequences;
 * an opt-out there means someone can lose money without being told. The
 * acceptance criterion is explicit that these stay mandatory, and the rule is
 * enforced in the service rather than trusted to the client.
 */
export const MANDATORY_CATEGORIES: readonly PreferenceCategory[] = [
  "security",
  "payment",
];

export function isMandatoryCategory(category: PreferenceCategory): boolean {
  return MANDATORY_CATEGORIES.includes(category);
}

/** Categories a user may opt out of. */
export function optionalCategories(): PreferenceCategory[] {
  return PREFERENCE_CATEGORIES.filter((c) => !isMandatoryCategory(c));
}

@Entity("notification_preferences")
@Index("IDX_notification_preferences_wallet", ["wallet"])
// The service saves with `upsert(..., ["wallet", "category"])`, which compiles
// to `ON CONFLICT ("wallet", "category")`. Postgres only accepts that target
// when a unique index covers exactly those columns, so without this every
// preference write fails — and it also makes a repeated save converge instead
// of accumulating contradictory rows.
@Index("UQ_notification_preferences_wallet_category", ["wallet", "category"], {
  unique: true,
})
export class NotificationPreference {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 128 })
  wallet!: string;

  // `enumName` pins the Postgres type the migration creates. Without it
  // TypeORM derives the name from the table and column, so a later table rename
  // would silently point the entity at a type that no longer exists.
  @Column({
    type: "enum",
    enum: PREFERENCE_CATEGORIES,
    enumName: "notification_preference_category_enum",
  })
  category!: PreferenceCategory;

  /**
   * Whether the user wants this category.
   *
   * Absence of a row means "default", not "off" — a category added later
   * must not arrive silently disabled for every existing user.
   */
  @Column({ type: "boolean", default: true })
  enabled!: boolean;

  @Column({ type: "timestamptz", default: () => "now()" })
  updatedAt!: Date;
}
