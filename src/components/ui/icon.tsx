import type { ReactNode } from "react";

export type IconName =
  | "store"
  | "overview"
  | "sale"
  | "products"
  | "customers"
  | "transactions"
  | "credit"
  | "reports"
  | "settings"
  | "logout"
  | "cash"
  | "digital"
  | "dues"
  | "calendar"
  | "eye"
  | "eyeOff"
  | "plus"
  | "menu"
  | "arrow"
  | "receipt";

const iconContent: Record<IconName, ReactNode> = {
  store: <><path d="M3 10h18l-1.5-6h-15L3 10Z" /><path d="M5 10v10h14V10M9 20v-6h6v6M3 10c0 1.1.9 2 2 2s2-.9 2-2c0 1.1.9 2 2 2s2-.9 2-2c0 1.1.9 2 2 2s2-.9 2-2c0 1.1.9 2 2 2s2-.9 2-2" /></>,
  overview: <><rect x="3" y="3" width="7" height="7" rx="1.3" /><rect x="14" y="3" width="7" height="5" rx="1.3" /><rect x="14" y="12" width="7" height="9" rx="1.3" /><rect x="3" y="13" width="7" height="8" rx="1.3" /></>,
  sale: <><path d="M6 3h12v18l-2.6-1.7L12 21l-3.4-1.7L6 21V3Z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  products: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4.5 7.8 7.5 4.4 7.5-4.4M12 12.2V21" /></>,
  customers: <><path d="M16 20v-1.7a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4V20" /><circle cx="10" cy="7" r="3.5" /><path d="M20 20v-1.7a4 4 0 0 0-3-3.9M16.5 3.7a3.5 3.5 0 0 1 0 6.7" /></>,
  transactions: <><path d="M6 3h12v18l-2.6-1.7L12 21l-3.4-1.7L6 21V3Z" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
  credit: <><circle cx="12" cy="12" r="9" /><path d="M16 8.5c-.7-.8-1.8-1.2-3.2-1.2-1.8 0-3 .8-3 2s1.1 1.8 3.1 2.2c2 .4 3.1 1 3.1 2.3s-1.3 2.2-3.3 2.2c-1.5 0-2.8-.5-3.6-1.4M12.6 5.8v12.4" /></>,
  reports: <><path d="M4 19.5V4" /><path d="M4 19.5h17" /><path d="m7 15 4-4 3 2 5-6" /><path d="M16 7h3v3" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 0 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 0 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 0 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 0 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 0 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z" /></>,
  logout: <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></>,
  cash: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 9H6v2M17 15h1v-2M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" /></>,
  digital: <><rect x="6" y="2.5" width="12" height="19" rx="2" /><path d="M10 18h4M9 6h6" /><path d="m10 12 1.5 1.5L14.5 10" /></>,
  dues: <><path d="M4 5h16v14H4z" /><path d="M8 9h8M8 13h3M15 13h1" /><path d="M8 16h8" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
  eye: <><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
  eyeOff: <><path d="m3 3 18 18M10.6 6.2A10 10 0 0 1 12 6c6.4 0 10 6 10 6a15 15 0 0 1-3.1 3.8M6.2 6.3C3.5 8 2 12 2 12s3.6 6 10 6c1.4 0 2.7-.3 3.8-.8" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
  arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  receipt: <><path d="M6 3h12v18l-2.6-1.7L12 21l-3.4-1.7L6 21V3Z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
};

export function Icon({
  name,
  size = 18,
  className,
}: Readonly<{ name: IconName; size?: number; className?: string }>) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
      width={size}
    >
      {iconContent[name]}
    </svg>
  );
}
