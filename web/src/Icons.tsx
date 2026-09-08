import type { ReactNode } from "react";
const paths: Record<string, ReactNode> = {
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  moon: <path d="M20 15A8.5 8.5 0 0 1 9 4a8.5 8.5 0 1 0 11 11Z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2m-3-9-1.5 1.5m-11 11L3 21M3 3l1.5 1.5m15 15L21 21" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r=".8" />
      <circle cx="12" cy="12" r=".8" />
      <circle cx="19" cy="12" r=".8" />
    </>
  ),
  branch: (
    <>
      <circle cx="6" cy="5" r="2.5" />
      <circle cx="6" cy="19" r="2.5" />
      <circle cx="18" cy="5" r="2.5" />
      <path d="M6 7.5v9M18 7.5c0 6-12 3-12 9" />
    </>
  ),
  file: <path d="M14 3H5v18h14V8l-5-5ZM14 3v5h5M8 12h8M8 16h5" />,
  arrow: <path d="M4 12h15m-5-5 5 5-5 5" />,
  back: <path d="M20 12H5m5-5-5 5 5 5" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="13" rx="2" />
      <path d="M15 8V3H3v13h5" />
    </>
  ),
  link: (
    <path
      d="m10 14 4-4m-6 6-2 2a4 4 0 0 1-5-5l5-5a4 4 0 0 1 5 0m2 8a4 4 0 0 0 5 0l5-5a4 4 0 0 0-5-5l-2 2"
      transform="translate(1 0) scale(.9)"
    />
  ),
  terminal: <path d="m5 7 5 5-5 5m8 0h6" />,
  check: <path d="m5 12 4 4L19 6" />,
  refresh: (
    <path d="M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3" />
  ),
};
export function Icon({ name }: { name: string }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name] ?? paths.file}
    </svg>
  );
}
export function Logo() {
  return (
    <svg viewBox="0 0 32 36" aria-hidden="true">
      <path
        d="M5 13V8.5Q5 6 8 6h16q3 0 3 2.5V13M3 14q0-2 2-2h22q2 0 2 2v15q0 2-2 2H5q-2 0-2-2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M9 6V3h14v3M3 19h26M13 17h6v5h-6Z"
        fill="var(--paper)"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  );
}
export function CollectionArt({
  className = "collection-art",
}: {
  className?: string;
}) {
  return (
    <svg className={className} viewBox="0 0 150 110" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.1">
        <path d="M19 89q52 13 109-3" strokeDasharray="1 4" opacity=".4" />
        <g transform="rotate(-13 67 47)">
          <rect
            x="39"
            y="10"
            width="56"
            height="73"
            rx="4"
            fill="var(--paper)"
          />
          <path d="M48 24h28m-28 7h34m-34 7h19" opacity=".5" />
        </g>
        <g transform="rotate(9 82 54)">
          <rect
            x="57"
            y="19"
            width="56"
            height="73"
            rx="4"
            fill="var(--paper)"
          />
          <path d="M69 35h16m-16 7h31m-31 7h23" opacity=".5" />
          <path d="m77 60-6 6 6 6m12-12 6 6-6 6m-5-14-3 17" />
        </g>
        <path d="M119 16v10m-5-5h10M25 43v6m-3-3h6" opacity=".5" />
      </g>
    </svg>
  );
}
