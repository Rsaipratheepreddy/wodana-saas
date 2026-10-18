/** next/navigation outside Next (the sample harness). */
export const useRouter = () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, back: () => undefined, prefetch: () => undefined });
export const usePathname = () => "/";
export const useSearchParams = () => new URLSearchParams();
export const useParams = () => ({});
export const notFound = () => undefined;
export const redirect = () => undefined;
