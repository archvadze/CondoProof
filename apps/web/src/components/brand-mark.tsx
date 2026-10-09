import Image from "next/image";

/** Decorative: the adjacent wordmark provides the accessible brand name. */
export function BrandMark() {
  return <span className="brand-mark"><Image src="/condoproof-mark.svg" alt="" width={44} height={44} unoptimized /></span>;
}
