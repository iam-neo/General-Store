"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { LanguageToggle } from "@/components/language-toggle";
import { DemoDataNotice } from "@/components/dashboard/demo-data-notice";
import { Icon, type IconName } from "@/components/ui/icon";
import type { MessageKey } from "@/lib/i18n/messages";
import { useLocale } from "@/lib/i18n/locale-provider";

type NavigationItem = Readonly<{ href: string; key: MessageKey; icon: IconName }>;

const navigation: readonly NavigationItem[] = [
  { href: "/dashboard", key: "overview", icon: "overview" },
  { href: "/dashboard/sales", key: "newSale", icon: "sale" },
  { href: "/dashboard/products", key: "products", icon: "products" },
  { href: "/dashboard/customers", key: "customers", icon: "customers" },
  { href: "/dashboard/transactions", key: "transactions", icon: "transactions" },
  { href: "/dashboard/credit", key: "credit", icon: "credit" },
  { href: "/dashboard/reports", key: "reports", icon: "reports" },
  { href: "/dashboard/settings", key: "settings", icon: "settings" },
];

function isCurrentPath(pathname: string, href: string) {
  return href === "/dashboard"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

function SignOutButton() {
  const { t } = useLocale();
  const router = useRouter();

  async function handleSignOut() {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { Accept: "application/json" },
      });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <button
      className="nav-link nav-link-signout w-full border-0 bg-transparent text-left cursor-pointer"
      onClick={handleSignOut}
      title={t("signOutNote")}
      type="button"
    >
      <Icon name="logout" size={18} />
      <span>{t("signOut")}</span>
    </button>
  );
}

function NavigationLinks({ pathname }: Readonly<{ pathname: string }>) {
  const { t } = useLocale();

  return (
    <>
      {navigation.map((item) => {
        const active = isCurrentPath(pathname, item.href);
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={`nav-link${active ? " nav-link-active" : ""}`}
            href={item.href}
            key={item.href}
          >
            <Icon name={item.icon} size={18} />
            <span>{t(item.key)}</span>
          </Link>
        );
      })}
      <SignOutButton />
    </>
  );
}

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const { t } = useLocale();
  const pathname = usePathname();
  const currentPage = navigation.find((item) => isCurrentPath(pathname, item.href)) ?? navigation[0];

  return (
    <div className="app-layout min-h-screen bg-background text-foreground">
      <aside aria-label={t("workspace")} className="desktop-sidebar">
        <Link aria-label={t("appName")} className="brand-lockup" href="/dashboard">
          <span className="brand-mark"><Icon name="store" size={21} /></span>
          <span className="brand-copy">
            <span className="brand-name">{t("appName")}</span>
            <span className="brand-caption">{t("appTagline")}</span>
          </span>
        </Link>
        <p className="nav-section-label">{t("workspace")}</p>
        <nav aria-label={t("workspace")} className="sidebar-navigation">
          <NavigationLinks pathname={pathname} />
        </nav>
        <div className="sidebar-profile">
          <span aria-hidden="true" className="owner-avatar">O</span>
          <span className="owner-copy"><strong>{t("owner")}</strong><small>{t("demoOwner")}</small></span>
        </div>
      </aside>

      <div className="main-column">
        <header className="mobile-header">
          <Link aria-label={t("appName")} className="mobile-brand" href="/dashboard">
            <span className="brand-mark"><Icon name="store" size={19} /></span>
            <span className="brand-name">{t("appName")}</span>
          </Link>
          <details className="mobile-menu">
            <summary aria-label={t("menu")}>
              <Icon name="menu" size={20} />
              <span>{t("menu")}</span>
            </summary>
            <div className="mobile-menu-panel">
              <nav aria-label={t("workspace")} className="mobile-navigation">
                <NavigationLinks pathname={pathname} />
              </nav>
              <p className="mobile-menu-note">{t("demoRouteNotice")}</p>
            </div>
          </details>
        </header>

        <main className="workspace-main">
          <header className="workspace-header">
            <div className="workspace-heading">
              <p className="breadcrumb">{t("appName")} <span aria-hidden="true">/</span> {t(currentPage.key)}</p>
              <h1>{t(currentPage.key)}</h1>
            </div>
            <div className="header-controls">
              <LanguageToggle />
              <div aria-label={`${t("owner")} · ${t("demoOwner")}`} className="profile-control">
                <span aria-hidden="true" className="owner-avatar">O</span>
                <span className="profile-name">{t("owner")}</span>
              </div>
            </div>
          </header>

          <DemoDataNotice />
          <div className="page-content">{children}</div>
          <p className="route-disclaimer">{t("demoRouteNotice")}</p>
        </main>
      </div>
    </div>
  );
}
