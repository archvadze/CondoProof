import type { SVGProps } from "react";
const paths = {
  layers: "m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5",
  wallet: "M20 8V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v11H5a3 3 0 0 1-3-3V6m18 7h-5v4h5m-3-2h.01",
  copy: "M9 9h12v12H9V9ZM5 15H3V3h12v2",
  plus: "M12 5v14M5 12h14",
  house: "m3 10 9-7 9 7M5 9v12h14V9m-10 12v-8h6v8",
  sparkles: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z",
  wrench: "m14 6 4 4 3-3a6 6 0 0 1-8 8l-7 7-4-4 7-7a6 6 0 0 1 8-8l-3 3Z",
  check: "m5 12 4 4L19 6",
  refresh: "M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 13-2l2 2M4 17l2 2a8 8 0 0 0 13-2",
  arrow: "M7 17 17 7M7 7h10v10",
  fingerprint: "M4 12a8 8 0 0 1 16 0m-13 6v-6a5 5 0 0 1 10 0v5m-7 4v-9a2 2 0 0 1 4 0v8M4 16v-1m16 1v-1",
} as const;
export function UiIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: keyof typeof paths }) {
  return <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name]} /></svg>;
}
