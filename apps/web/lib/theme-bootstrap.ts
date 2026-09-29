/** Where the person's light/dark choice is kept on this device. */
export const THEME_STORAGE_KEY = "wodana-theme";

/**
 * Client- and supplier-facing pages (the client portal, public enquiry forms, shared quotations and supplier
 * orders) keep the tenant's light look whatever the visitor's device prefers.
 */
export const LIGHT_ONLY_PATH = /^\/(?:portal|enquiry|quotation|vendor)(?:\/|$)/;

/**
 * Runs while the browser parses <head>, before the first paint: puts the stored theme, else the device's, on
 * <html> so a full page load never flashes light before React hydrates. Plain ES5 with no globals left behind;
 * the site's script policy allows inline scripts (next.config.ts), which `theme-bootstrap.test.ts` checks.
 */
export const themeBootstrapScript = `(function(){try{var d=document.documentElement;if(${LIGHT_ONLY_PATH}.test(location.pathname))return;var t=null;try{t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}if(t!=="dark"&&t!=="light")t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";d.setAttribute("data-theme",t)}catch(e){}})();`;
