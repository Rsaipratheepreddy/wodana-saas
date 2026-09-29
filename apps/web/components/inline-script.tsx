/**
 * A script that runs while the browser parses the server's HTML (before the first paint). React doesn't run
 * scripts it renders on the client and warns about them, so the client renders it inert (`text/plain`) and
 * keeps the server's element (the type differs, hence `suppressHydrationWarning`). Next's recommended pattern.
 */
export function InlineScript({ html }: { html: string }) {
  return <script type={typeof window === "undefined" ? "text/javascript" : "text/plain"} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: html }} />;
}
