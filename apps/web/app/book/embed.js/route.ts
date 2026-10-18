/**
 * The popup embed (plan §6.5b): one script tag on a firm's website adds a button that opens its booking page
 * in an overlay. <script src="…/book/embed.js" data-url="…/book/{workspace}/{type}?placement=…" data-label="Book a visit" async></script>
 * It runs on someone else's site, so it carries its own small styles; the booking page inside keeps the firm's brand.
 */
const SCRIPT = String.raw`(function () {
  var script = document.currentScript;
  if (!script || !script.dataset.url) return;
  var origin = new URL(script.src).origin;
  var target;
  try { target = new URL(script.dataset.url, origin); } catch (error) { return; }
  if (target.origin !== origin || !/^\/book\/[a-z0-9-]+\/[a-z0-9-]+$/.test(target.pathname)) return;
  target.searchParams.set("embed", "1");
  var rtl = (document.documentElement.getAttribute("dir") || "").toLowerCase() === "rtl";
  var button = document.createElement("button");
  button.type = "button";
  button.textContent = script.dataset.label || "Book a meeting";
  button.setAttribute("style", "font:inherit;font-weight:600;padding:12px 20px;border:0;border-radius:8px;cursor:pointer;background:" + (/^#[0-9a-fA-F]{6}$/.test(script.dataset.color || "") ? script.dataset.color : "#292d32") + ";color:#fff");
  function open() {
    var overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", button.textContent);
    overlay.setAttribute("style", "position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(17,17,17,.55);padding:16px");
    var frame = document.createElement("iframe");
    frame.src = target.toString();
    frame.title = button.textContent;
    frame.setAttribute("style", "width:100%;max-width:760px;height:100%;max-height:860px;border:0;border-radius:12px;background:#fff");
    var close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.textContent = "×";
    close.setAttribute("style", "position:absolute;top:12px;" + (rtl ? "left" : "right") + ":12px;width:40px;height:40px;border:0;border-radius:20px;font-size:24px;line-height:1;cursor:pointer;background:#fff;color:#111");
    function dismiss() { overlay.remove(); document.removeEventListener("keydown", onKey); button.focus(); }
    function onKey(event) { if (event.key === "Escape") dismiss(); }
    close.addEventListener("click", dismiss);
    overlay.addEventListener("click", function (event) { if (event.target === overlay) dismiss(); });
    document.addEventListener("keydown", onKey);
    overlay.appendChild(frame);
    overlay.appendChild(close);
    document.body.appendChild(overlay);
    close.focus();
  }
  button.addEventListener("click", open);
  script.insertAdjacentElement("afterend", button);
  window.WodanaBooking = { open: open };
})();
`;

export function GET() {
  return new Response(SCRIPT, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "cross-origin-resource-policy": "cross-origin",
    },
  });
}
