import * as Sentry from "@sentry/nextjs";

// Only initialises when NEXT_PUBLIC_SENTRY_DSN is set.
// Leave the variable unset in local dev to avoid noise.
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  const scrubWallets =
    process.env.NEXT_PUBLIC_SENTRY_SCRUB_WALLET_ADDRESSES !== "false";

  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
      process.env.NODE_ENV ??
      "development",
    // Capture a sample of traces; adjust in production as needed.
    tracesSampleRate: 0.1,
    beforeSend(event) {
      if (scrubWallets) {
        // Redact Stellar public keys (G…) and contract IDs (C…), both 56 chars.
        const scrubbed = JSON.stringify(event).replace(
          /\b[GC][A-Z2-7]{55}\b/g,
          "[WALLET_REDACTED]"
        );
        return JSON.parse(scrubbed);
      }
      return event;
    },
  });
}
