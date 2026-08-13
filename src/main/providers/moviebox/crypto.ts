/**
 * Request signing for the catalog API. Works across Node, Electron, Web, and Capacitor.
 * The canonical string layout, the field order and the empty-string placeholders on GET
 * all matter; the server rejects anything else.
 */
import { md5 } from "js-md5";

const SECRET_KEY_DEFAULT = "76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O";
const SIGNATURE_BODY_MAX_BYTES = 102_400;

const md5Hex = (data: string | Uint8Array): string => md5(data);

/** The secret is base64 with the padding stripped; returns raw bytes as Uint8Array. */
function secretKeyBytes(): Uint8Array {
  const padding = (4 - (SECRET_KEY_DEFAULT.length % 4)) % 4;
  const base64Str = SECRET_KEY_DEFAULT + "=".repeat(padding);
  
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64Str, "base64"));
  }
  
  const binaryString = atob(base64Str);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/** Query params sorted by key, duplicate keys keeping their original order. */
function sortedQueryString(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }

  const params = new Map<string, string[]>();
  for (const [key, value] of parsed.searchParams) {
    const bucket = params.get(key);
    if (bucket) bucket.push(value);
    else params.set(key, [value]);
  }
  if (params.size === 0) return "";

  const parts: string[] = [];
  for (const key of [...params.keys()].sort()) {
    for (const value of params.get(key)!) parts.push(`${key}=${value}`);
  }
  return parts.join("&");
}

export function buildCanonicalString(
  method: string,
  accept: string | null,
  contentType: string | null,
  url: string,
  body: string | null,
  timestampMs: number,
): string {
  let canonicalUrl: string;
  try {
    const parsed = new URL(url);
    const query = sortedQueryString(url);
    canonicalUrl = query ? `${parsed.pathname}?${query}` : parsed.pathname;
  } catch {
    canonicalUrl = url;
  }

  let bodyHash = "";
  let bodyLength = "";
  if (body !== null) {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(body);
    bodyLength = String(bytes.length);
    bodyHash = md5Hex(bytes.subarray(0, SIGNATURE_BODY_MAX_BYTES));
  }

  return [
    method.toUpperCase(),
    accept ?? "",
    contentType ?? "",
    bodyLength,
    String(timestampMs),
    bodyHash,
    canonicalUrl,
  ].join("\n");
}

export function generateXClientToken(timestampMs: number): string {
  const ts = String(timestampMs);
  const reversed = [...ts].reverse().join("");
  return `${ts},${md5Hex(reversed)}`;
}

export function generateXTrSignature(
  method: string,
  accept: string | null,
  contentType: string | null,
  url: string,
  body: string | null,
  timestampMs: number,
): string {
  const canonical = buildCanonicalString(method, accept, contentType, url, body, timestampMs);
  const signature = md5.hmac.create(secretKeyBytes()).update(canonical).base64();
  return `${timestampMs}|2|${signature}`;
}

const pick = <T>(values: readonly T[]): T => values[Math.floor(Math.random() * values.length)];

const randomHex = (length: number): string =>
  Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join("");

const randomUuid = (): string =>
  [randomHex(8), randomHex(4), randomHex(4), randomHex(4), randomHex(12)].join("-");

export interface ClientIdentity {
  userAgent: string;
  clientInfo: string;
  spoofedIp: string;
}

/**
 * The API expects an Android client. These values are generated once per client
 * instance and must stay stable for the lifetime of the runtime token.
 */
export function generateClientIdentity(): ClientIdentity {
  const androidVersions = [
    ["9", "PQ3A.190605.03081104"],
    ["10", "QP1A.191005.007.A3"],
    ["11", "RP1A.200720.011"],
    ["12", "S1B.220414.015"],
    ["13", "TQ2A.230405.003"],
  ] as const;
  const redmiDevices = [
    ["23078RKD5C", "Redmi"],
    ["2201117TY", "Redmi"],
    ["2201117TG", "Redmi"],
    ["22101316G", "Redmi"],
    ["21121210G", "Redmi"],
    ["M2012K11AG", "Redmi"],
    ["M2007J20CG", "Redmi"],
  ] as const;
  const versionCode = pick([50020042, 50020043, 50020044, 50020045, 50020046] as const);

  const [osVersion, buildId] = pick(androidVersions);
  const [model, brand] = pick(redmiDevices);

  const userAgent =
    `com.community.oneroom/${versionCode} (Linux; U; Android ${osVersion}; en_US; ` +
    `${model}; Build/${buildId}; Cronet/135.0.7012.3)`;

  const clientInfo = JSON.stringify({
    package_name: "com.community.oneroom",
    version_name: "3.0.03.0529.03",
    version_code: versionCode,
    os: "android",
    os_version: osVersion,
    install_ch: "ps",
    device_id: randomHex(32),
    install_store: "ps",
    gaid: randomUuid(),
    brand,
    model,
    system_language: "en",
    net: pick(["NETWORK_WIFI", "NETWORK_MOBILE"] as const),
    region: "US",
    timezone: pick([
      "Asia/Kolkata",
      "Asia/Shanghai",
      "Asia/Tokyo",
      "America/New_York",
      "Europe/London",
    ] as const),
    sp_code: "40401",
    "X-Play-Mode": "2",
  });

  const prefixes = [
    "103.241", "49.36", "117.195", "106.198", "122.162",
    "157.32", "182.70", "103.58", "27.60", "59.90",
  ] as const;
  const octet = () => Math.floor(Math.random() * 253) + 1;
  const spoofedIp = `${pick(prefixes)}.${octet()}.${octet()}`;

  return { userAgent, clientInfo, spoofedIp };
}

export function buildSignedHeaders(
  method: string,
  url: string,
  body: string | null,
  authToken: string | null,
  identity: ClientIdentity,
): Record<string, string> {
  const timestamp = Date.now();
  const accept = "application/json";
  const contentType = "application/json";

  const headers: Record<string, string> = {
    "user-agent": identity.userAgent,
    accept,
    "content-type": contentType,
    connection: "keep-alive",
    "x-client-token": generateXClientToken(timestamp),
    "x-tr-signature": generateXTrSignature(method, accept, contentType, url, body, timestamp),
    "x-client-info": identity.clientInfo,
    "x-client-status": "0",
    "x-forwarded-for": identity.spoofedIp,
  };

  if (authToken) headers.authorization = `Bearer ${authToken}`;
  return headers;
}
