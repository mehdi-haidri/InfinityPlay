/**
 * Signing for the HD (DASH) streams.
 *
 * The catalog hands out a CloudFront policy covering a whole episode directory, but only
 * the manifest URL is returned signed. dash.js resolves segment URLs relative to the
 * manifest, and a relative resolve drops the query string — so every segment would arrive
 * unsigned and be refused with 403.
 *
 * Rather than depending on a dash.js extension point, the signature is re-attached at the
 * session level: any request under a registered prefix that has no `Policy` gets one.
 */
import { session } from "electron";

interface SignedPrefix {
  /** Everything under this URL prefix is covered by the policy. */
  prefix: string;
  query: string;
  expiresAt: number;
}

const signedPrefixes: SignedPrefix[] = [];

/** Turns the API's `signCookie` blob into CloudFront query parameters. */
export function signCookieToQuery(signCookie: string): string {
  const parts = Object.fromEntries(
    signCookie
      .split(";")
      .filter((part) => part.trim().length > 0)
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index).trim(), part.slice(index + 1)];
      }),
  );

  const policy = parts["CloudFront-Policy"];
  const signature = parts["CloudFront-Signature"];
  const keyPairId = parts["CloudFront-Key-Pair-Id"];
  if (!policy || !signature || !keyPairId) return "";

  return new URLSearchParams({
    Policy: policy,
    Signature: signature,
    "Key-Pair-Id": keyPairId,
  }).toString();
}

/** Reads the expiry out of the policy so stale entries can be dropped. */
function policyExpiry(query: string): number {
  try {
    const policy = new URLSearchParams(query).get("Policy");
    if (!policy) return 0;
    const normalised = policy.replace(/-/g, "+").replace(/_/g, "/").replace(/~/g, "=");
    const decoded = JSON.parse(Buffer.from(normalised, "base64").toString("utf8"));
    const seconds = decoded?.Statement?.[0]?.Condition?.DateLessThan?.["AWS:EpochTime"];
    return typeof seconds === "number" ? seconds * 1000 : 0;
  } catch {
    return 0;
  }
}

export function registerSignedStream(manifestUrl: string, signCookie: string): string {
  const query = signCookieToQuery(signCookie);
  if (!query) return manifestUrl;

  // The policy covers the manifest's directory, which is exactly where the segments live.
  const prefix = manifestUrl.replace(/[^/]+$/, "");
  const expiresAt = policyExpiry(query) || Date.now() + 6 * 60 * 60 * 1000;

  const existing = signedPrefixes.findIndex((entry) => entry.prefix === prefix);
  if (existing !== -1) signedPrefixes.splice(existing, 1);
  signedPrefixes.unshift({ prefix, query, expiresAt });

  // Keep the list small; these are only useful for as long as the user is watching.
  const now = Date.now();
  for (let i = signedPrefixes.length - 1; i >= 0; i--) {
    if (signedPrefixes[i].expiresAt < now || i > 20) signedPrefixes.splice(i, 1);
  }

  return `${manifestUrl}?${query}`;
}

export function installStreamSigner(): void {
  const filter = { urls: ["*://*.hakunaymatata.com/dash/*"] };
  session.defaultSession.webRequest.onBeforeRequest(filter, (details, callback) => {
    if (details.url.includes("Policy=")) {
      callback({});
      return;
    }
    const match = signedPrefixes.find((entry) => details.url.startsWith(entry.prefix));
    if (!match) {
      callback({});
      return;
    }
    const separator = details.url.includes("?") ? "&" : "?";
    callback({ redirectURL: `${details.url}${separator}${match.query}` });
  });
}
