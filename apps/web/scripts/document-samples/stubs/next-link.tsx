import type { AnchorHTMLAttributes } from "react";
/** next/link outside Next (the sample harness): a plain link. */
export default function Link({ href, prefetch: _prefetch, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; prefetch?: boolean }) {
  return <a href={href} {...rest} />;
}
