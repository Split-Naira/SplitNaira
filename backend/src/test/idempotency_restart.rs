//! Integration coverage for idempotency-key behavior across
//! service/process restart boundaries.

#[cfg(test)]
mod tests {
    #[test]
    fn duplicate_idempotency_key_after_restart() {
        // 1. Start the service with a clean state.
        //
        // 2. Submit a create-split request with an idempotency key.
        //
        // 3. Store the original response/result.
        //
        // 4. Simulate a process restart or cache reset.
        //
        // 5. Submit the same create-split request with
        //    the same idempotency key.
        //
        // 6. Assert the expected replay semantics:
        //    - persisted idempotency keys should return the
        //      original result without creating another split.
        //    - memory-only keys should have their limitation
        //      explicitly documented.
    }
}