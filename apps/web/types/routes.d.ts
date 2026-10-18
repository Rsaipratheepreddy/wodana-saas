// Fallback global RouteContext type for Next.js internal API route handlers
declare global {
  type RouteContext<T = string> = {
    params: Promise<Record<string, string>>;
  };
}

export {};
