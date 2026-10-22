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
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}

function formatMessage(msg: string, values?: Record<string, unknown>): string {
  if (!values) return msg;
  let formatted = msg;
  for (const [k, v] of Object.entries(values)) {
    formatted = formatted.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
  }
  return formatted;
}

vi.mock("next-intl", () => {
  // Defaults to English so tests that never mount a provider keep the
  // previous behaviour. NextIntlClientProvider overrides this per render.
  let activeMessages: unknown = enMessages;

  const reset = () => {
    activeMessages = enMessages;
  };

  return {
    useTranslations: (namespace?: string) => {
      return (key: string, values?: Record<string, unknown>) => {
        const fullKey = namespace ? `${namespace}.${key}` : key;
        const resolved =
          getNestedValue(activeMessages, fullKey) ??
          getNestedValue(activeMessages, key) ??
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
    NextIntlClientProvider: ({
      children,
      messages: providerMessages,
    }: {
      children: ReactNode;
      locale?: string;
      messages?: unknown;
    }) => {
      if (providerMessages) {
        activeMessages = providerMessages;
      }
      return children;
    },
    __resetIntlMock: reset,
  };
});

import * as nextIntlMock from "next-intl";

function resetIntlMock(): void {
  const mock = nextIntlMock as unknown as { __resetIntlMock?: () => void };
  mock.__resetIntlMock?.();
}

afterEach(() => {
  cleanup();
  resetIntlMock();
});
