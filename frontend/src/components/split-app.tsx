"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { reportLoadingFlags, type LoadingBarFlags } from "./LoadingBar";
import { useTranslations } from "next-intl";

import { SplitApp as SplitAppLegacy } from "./split-app-legacy";
import { useFocusTrap } from "./useFocusTrap";
import useLockBodyScroll from "./useLockBodyScroll";
import { useMaintenanceStatus } from "@/hooks/useMaintenanceStatus";
import { MaintenanceBanner } from "./MaintenanceBanner";

const MODAL_SELECTORS = [
  "[role='dialog'][aria-modal='true']",
  ".fixed.inset-0.z-50 > .glass-card",
  ".fixed.inset-0.z-100 > .glass-card",
].join(", ");

function isVisible(element: HTMLElement) {
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function normalizeText(value: string | null) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

export function SplitApp() {
  const t = useTranslations("SplitApp");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeModalRef = useRef<HTMLElement | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Single poll site for backend maintenance/degraded status (#934). The
  // result is threaded down to SplitAppLegacy via a prop rather than having
  // individual components poll independently.
  const { status: maintenanceStatus, isWriteDisabled, message: maintenanceMessage } =
    useMaintenanceStatus();

  const copy = useMemo(
    () =>
      new Map<string, string>([
        ["Premium royalty management on Stellar.", t("header.subtitle")],
        ["Connect Wallet", t("actions.connectWallet")],
        ["Switch Wallet", t("actions.switchWallet")],
        ["Sync", t("actions.sync")],
        ["Disconnect", t("actions.disconnect")],
        ["Status: Connected", t("wallet.statusConnected")],
        ["Wallet", t("wallet.wallet")],
        ["Network", t("wallet.network")],
        ["Dashboard", t("tabs.dashboard")],
        ["Create", t("tabs.create")],
        ["Manage & Distribute", t("tabs.manage")],
        ["Projects", t("tabs.projects")],
        ["Execute Payout", t("actions.executePayout")],
        ["Cancel", t("actions.cancel")],
        ["Save Changes", t("actions.saveChanges")],
        ["Lock Project", t("actions.lockProject")],
        ["Confirm Deposit", t("actions.confirmDeposit")],
        ["Confirm Pause", t("actions.confirmPause")],
        ["Confirm Resume", t("actions.confirmResume")],
        ["Project identifier is required.", t("wizard.validation.projectIdRequired")],
        ["Display title is required.", t("wizard.validation.titleRequired")],
        ["Asset token is required.", t("wizard.validation.tokenRequired")],
        ["Enter a valid Stellar token address.", t("wizard.validation.invalidTokenAddress")],
        ["Media category is required.", t("wizard.validation.projectTypeRequired")],
        ["Wallet address is required.", t("wizard.validation.addressRequired")],
        ["Enter a valid Stellar address or contract ID.", t("wizard.validation.invalidAddress")],
        ["Invalid Stellar address (G...) or contract ID (C...)", t("wizard.validation.invalidAddressGeneral")],
        ["Duplicate address", t("wizard.validation.duplicateAddress")],
        ["Alias is required.", t("wizard.validation.aliasRequired")],
        ["Share is required.", t("wizard.validation.shareRequired")],
        ["Share must be a whole integer in basis points.", t("wizard.validation.shareWholeInteger")],
        ["Share must be a valid number.", t("wizard.validation.shareValidNumber")],
        ["Share cannot exceed 10,000.", t("wizard.validation.shareMax")],
        ["Total shares valid: 100% allocated", t("wizard.validation.sharesValid")],
      ]),
    [t],
  );

  useFocusTrap(activeModalRef, isModalOpen);
  useLockBodyScroll(isModalOpen);

  const onLoadingFlagsChange = useCallback((flags: LoadingBarFlags) => {
    reportLoadingFlags(flags);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const applyTranslations = () => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const source = normalizeText(node.nodeValue);
        const translated = copy.get(source);
        if (translated && node.nodeValue !== translated) {
          node.nodeValue = node.nodeValue?.replace(source, translated) ?? translated;
        }
        node = walker.nextNode();
      }
    };

    const updateActiveModal = () => {
      const modal = Array.from(root.querySelectorAll<HTMLElement>(MODAL_SELECTORS)).find(isVisible) ?? null;
      if (modal) {
        if (!modal.hasAttribute("role")) modal.setAttribute("role", "dialog");
        if (!modal.hasAttribute("aria-modal")) modal.setAttribute("aria-modal", "true");
        if (!modal.hasAttribute("tabindex")) modal.setAttribute("tabindex", "-1");
      }
      activeModalRef.current = modal;
      setIsModalOpen(Boolean(modal));
    };

    applyTranslations();
    updateActiveModal();

    const observer = new MutationObserver(() => {
      applyTranslations();
      updateActiveModal();
    });
    observer.observe(root, {
      attributes: true,
      childList: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }, [copy]);

  useEffect(() => {
    if (!isModalOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !activeModalRef.current) return;
      const cancelButton = Array.from(activeModalRef.current.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => /cancel|annuler/i.test(button.textContent ?? ""),
      );
      if (cancelButton) {
        event.preventDefault();
        cancelButton.click();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isModalOpen]);

  return (
    <div ref={rootRef}>
      <MaintenanceBanner
        status={maintenanceStatus}
        message={maintenanceMessage}
        className="mx-auto mb-6 w-full max-w-4xl"
      />
      <SplitAppLegacy
        onLoadingFlagsChange={onLoadingFlagsChange}
        isWriteDisabled={isWriteDisabled}
      />
    </div>
  );
}
