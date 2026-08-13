/**
 * Renderer-side network interceptor for Capacitor/Mobile/Browser.
 * Intercepts fetch and XMLHttpRequest to ensure segment URLs carry the CloudFront signature.
 */

let registeredPrefixes: { prefix: string; query: string }[] = [];

export function registerStreamSignature(manifestUrl: string, signQuery: string) {
  if (!manifestUrl || !signQuery) return;
  const prefix = manifestUrl.replace(/[^/]+$/, "");
  const existing = registeredPrefixes.findIndex((p) => p.prefix === prefix);
  if (existing !== -1) registeredPrefixes.splice(existing, 1);
  registeredPrefixes.unshift({ prefix, query: signQuery });
}

export function installRendererStreamSigner(): void {
  if (typeof window === "undefined" || (window as any).__rendererStreamSignerInstalled) {
    return;
  }
  (window as any).__rendererStreamSignerInstalled = true;

  const patchUrl = (input: string): string => {
    if (typeof input !== "string" || input.includes("Policy=")) return input;
    const match = registeredPrefixes.find((entry) => input.startsWith(entry.prefix));
    if (!match) return input;
    const separator = input.includes("?") ? "&" : "?";
    return `${input}${separator}${match.query}`;
  };

  const originalFetch = window.fetch;
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    if (typeof input === "string") {
      input = patchUrl(input);
    } else if (input instanceof URL) {
      input = new URL(patchUrl(input.toString()));
    } else if (typeof Request !== "undefined" && input instanceof Request) {
      const newUrl = patchUrl(input.url);
      if (newUrl !== input.url) {
        input = new Request(newUrl, input);
      }
    }
    return originalFetch.call(this, input, init);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    async: boolean = true,
    user?: string | null,
    password?: string | null,
  ) {
    const urlString = url.toString();
    const signedUrl = patchUrl(urlString);
    return originalOpen.call(this, method, signedUrl, async, user, password);
  };
}
