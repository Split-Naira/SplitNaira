import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, vi } from "vitest";
import enMessages from "../../messages/en.json";

expect.extend(matchers);

Object.assign(globalThis, { jest: vi });

const messages: Record<string, string> = {
  "header.subtitle": "Premium royalty management on Stellar.",
  "actions.connectWallet": "Connect Wallet",
  "actions.switchWallet": "Switch Wallet",
  "actions.sync": "Sync",
  "actions.disconnect": "Disconnect",
  "actions.executePayout": "Execute Payout",
  "actions.cancel": "Cancel",
  "actions.saveChanges": "Save Changes",
  "actions.lockProject": "Lock Project",
  "actions.confirmDeposit": "Confirm Deposit",
  "actions.confirmPause": "Confirm Pause",
  "actions.confirmResume": "Confirm Resume",
  "wallet.statusConnected": "Status: Connected",
  "wallet.wallet": "Wallet",
  "wallet.network": "Network",
  "tabs.dashboard": "Dashboard",
  "tabs.create": "Create",
  "tabs.manage": "Manage & Distribute",
  "tabs.projects": "Projects",
};

function getNestedValue(obj: unknown, path: string): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = path.split(".");
  let current: any = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = current[part];
  }
  return typeof current === "string" ? current : undefined;
}

function formatMessage(msg: string, values?: Record<string, any>): string {
  if (!values) return msg;
  let formatted = msg;
  for (const [k, v] of Object.entries(values)) {
    formatted = formatted.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
  }
  return formatted;
}

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    return (key: string, values?: Record<string, any>) => {
      const fullKey = namespace ? `${namespace}.${key}` : key;
      const resolved =
        getNestedValue(enMessages, fullKey) ??
        getNestedValue(enMessages, key) ??
        messages[fullKey] ??
        messages[key];

      if (typeof resolved === "string") {
        return formatMessage(resolved, values);
      }
      return key;
    };
  },
  NextIntlClientProvider: ({ children }: { children: ReactNode }) => children,
}));

afterEach(() => {
  cleanup();
});
