import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand colors mapped from CSS variables
        brand: {
          primary: "var(--brand-primary)",
          accent: "var(--brand-accent)",
          surface: "var(--brand-surface)",
          card: "var(--brand-card)",
          border: "var(--brand-border)",
          text: "var(--brand-text)",
          muted: "var(--brand-muted)",
          highlight: "var(--brand-highlight)",
        },
        // Legacy aliases for backwards compatibility
        ink: "var(--brand-text)",
        muted: "var(--brand-muted)",
        greenBright: "var(--brand-highlight)",
        greenMid: "var(--brand-primary)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui"],
        display: ["var(--font-display)", "ui-serif", "Georgia"],
      },
      boxShadow: {
        soft: "0 20px 60px -40px rgba(20, 20, 18, 0.6)",
      },
    },
  },
  plugins: [],
};

export default config;
