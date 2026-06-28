import { Column, Entity, PrimaryColumn } from "typeorm";

/**
 * Generic key/value store for background-service state that must survive
 * process restarts (Issue #619).
 *
 * The first consumer is the EventListenerService, which persists its latest
 * processed Soroban event cursor under `event_listener_cursor` so the worker
 * resumes from where it left off instead of replaying from `latestLedger - 100`.
 */
@Entity("service_state")
export class ServiceState {
  @PrimaryColumn({ type: "varchar", length: 128 })
  key!: string;

  @Column({ type: "text" })
  value!: string;
}
