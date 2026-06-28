"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import Image from "next/image";
import { MobileDrawer } from "./MobileDrawer";

// ---------------------------------------------------------------------------
// Nav item definition
// ---------------------------------------------------------------------------

export interface NavItem {
  label: string;
  href: string;
  icon?: ReactNode;
}

const DEFAULT_NAV_ITEMS: NavItem[] = [
  {
    label: "Projects",
    href: "/dashboard",
    icon: (
      <svg
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
        />
      </svg>
    ),
  },
  {
    label: "Distribute",
    href: "/dashboard/distribute",
    icon: (
      <svg
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
        />
      </svg>
    ),
  },
  {
    label: "History",
    href: "/dashboard/history",
    icon: (
      <svg
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
  {
    label: "Settings",
    href: "/dashboard/settings",
    icon: (
      <svg
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
    ),
  },
];

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

interface SidebarProps {
  navItems?: NavItem[];
  collapsed: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}

function Sidebar({
  navItems = DEFAULT_NAV_ITEMS,
  collapsed,
  onToggle,
  onNavigate,
}: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={clsx(
        "flex flex-col h-full bg-[var(--brand-surface)] text-white transition-all duration-200",
        collapsed ? "w-16" : "w-56",
      )}
      aria-label="Sidebar navigation"
    >
      {/* Logo / toggle */}
      <div className="flex items-center justify-between px-3 py-4 border-b border-[var(--brand-border)]">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <Image
              src="/logo.svg"
              alt="SplitNaira logo"
              width={32}
              height={32}
              className="shrink-0"
            />
            <span className="font-display font-bold text-[var(--brand-accent)] text-lg truncate">
              SplitNaira
            </span>
          </div>
        )}
        {collapsed && (
          <Image
            src="/logo.svg"
            alt="SplitNaira logo"
            width={32}
            height={32}
            className="mx-auto"
          />
        )}
        {!collapsed && (
          <button
            onClick={onToggle}
            aria-label="Collapse sidebar"
            className="p-1.5 rounded-md hover:bg-white/5 transition-colors"
          >
            <svg
              className="h-5 w-5 text-[var(--brand-muted)]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11 19l-7-7 7-7M19 19l-7-7 7-7"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Nav links */}
      <nav className="flex-1 overflow-y-auto py-3 space-y-0.5 px-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              onClick={onNavigate}
              className={clsx(
                "flex items-center gap-3 rounded-lg px-2 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-[var(--brand-primary)] text-white"
                  : "text-[var(--brand-muted)] hover:bg-white/5 hover:text-white",
                collapsed && "justify-center",
              )}
              title={collapsed ? item.label : undefined}
            >
              {item.icon && <span className="shrink-0">{item.icon}</span>}
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// DashboardLayout
// ---------------------------------------------------------------------------

export interface DashboardLayoutProps {
  children: ReactNode;
  /** Override the default nav items */
  navItems?: NavItem[];
  /** Page-level header content (title, actions, etc.) */
  header?: ReactNode;
}

export function DashboardLayout({
  children,
  navItems,
  header,
}: DashboardLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--brand-surface)]">
      {/* Desktop Sidebar */}
      <div className="hidden md:block">
        <Sidebar
          navItems={navItems}
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
        />
      </div>

      {/* Mobile Drawer */}
      <MobileDrawer
        isOpen={mobileDrawerOpen}
        onClose={() => setMobileDrawerOpen(false)}
      >
        <Sidebar
          navItems={navItems}
          collapsed={false}
          onToggle={() => setMobileDrawerOpen(false)}
          onNavigate={() => setMobileDrawerOpen(false)}
        />
      </MobileDrawer>

      {/* Main content area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center h-14 border-b border-[var(--brand-border)] bg-[var(--brand-surface)] px-4 md:px-6 shrink-0">
          {/* Mobile menu button */}
          <button
            onClick={() => setMobileDrawerOpen(true)}
            className="md:hidden p-2 -ml-2 mr-3 rounded-md hover:bg-white/5 transition-colors"
            aria-label="Open menu"
          >
            <svg
              className="h-6 w-6 text-[var(--brand-text)]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>

          {header ?? (
            <span className="text-sm font-medium text-[var(--brand-muted)]">
              Dashboard
            </span>
          )}
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
