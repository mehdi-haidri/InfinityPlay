/**
 * Catalog API client.
 *
 * Lives in the main process on purpose: the signed request sets `user-agent`,
 * `connection` and `x-forwarded-for`, which a renderer fetch is forbidden to send.
 */
import { buildSignedHeaders, generateClientIdentity, type ClientIdentity } from "./crypto";
import { Capacitor, CapacitorHttp } from "@capacitor/core";

const HOST_POOL = [
  "https://api6.aoneroom.com",
  "https://api5.aoneroom.com",
  "https://api4.aoneroom.com",
  "https://api4sg.aoneroom.com",
  "https://api3.aoneroom.com",
  "https://api6sg.aoneroom.com",
  "https://api.inmoviebox.com",
] as const;

const RESOURCE_PATH = "/wefeed-mobile-bff/subject-api/resource/v2";

const RETRY_STATUS_CODES = new Set([403, 406, 407, 429, 500, 502, 503, 504]);
const REQUEST_TIMEOUT_MS = 12_000;

export class HostsExhaustedError extends Error {
  constructor() {
    super("Every MovieBox host failed for this request.");
    this.name = "HostsExhaustedError";
  }
}

export type Json = any;

export class MovieBoxClient {
  private identity: ClientIdentity = generateClientIdentity();
  private token: string | null = null;
  private activeBaseIdx = 0;
  private initPromise: Promise<void> | null = null;

  /**
   * The first request returns an `x-user` response header carrying the runtime
   * bearer token; every later request signs with it. Skipping this makes the
   * whole API 403.
   */
  async init(): Promise<void> {
    if (this.token) return;
    this.initPromise ??= (async () => {
      try {
        await this.requestHosts("GET", "/wefeed-mobile-bff/tab-operating?page=1&tabId=0&version=", null);
        if (!this.token) throw new Error("MovieBox handshake returned no session token.");
      } finally {
        this.initPromise = null;
      }
    })();
    return this.initPromise;
  }

  /** Drops the session and identity, e.g. after a hard failure. */
  reset(): void {
    this.token = null;
    this.identity = generateClientIdentity();
    this.activeBaseIdx = 0;
  }

  private async requestHosts(method: string, pathAndQuery: string, body: string | null): Promise<Json> {
    const start = this.activeBaseIdx;

    for (let attempt = 0; attempt < HOST_POOL.length; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 50));
      const idx = (start + attempt) % HOST_POOL.length;
      const url = HOST_POOL[idx] + pathAndQuery;

      try {
        let status = 0;
        let payload: any = null;
        let xUserHeader: any = null;
        const headers = buildSignedHeaders(method, url, body, this.token, this.identity);

        if (Capacitor.isNativePlatform()) {
          const res = await CapacitorHttp.request({
            method,
            url,
            headers,
            data: body ? JSON.parse(body) : undefined,
          });
          status = res.status;
          payload = res.data;
          xUserHeader = res.headers ? (res.headers["x-user"] || res.headers["X-User"] || res.headers["X-USER"]) : null;
        } else {
          const response = await fetch(url, {
            method,
            headers,
            body: body ?? undefined,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
          status = response.status;
          xUserHeader = response.headers.get("x-user");
          payload = await response.json();
        }

        if (xUserHeader) {
          try {
            const rawToken = typeof xUserHeader === "string" ? JSON.parse(xUserHeader)?.token : xUserHeader?.token;
            if (typeof rawToken === "string" && rawToken.length > 0) this.token = rawToken;
          } catch {
            // Keep token
          }
        }

        if (RETRY_STATUS_CODES.has(status) || status < 200 || status >= 300) continue;

        this.activeBaseIdx = idx;
        return payload?.data !== undefined ? payload.data : payload;
      } catch {
        // Timeout, DNS, TLS or malformed JSON — move to the next host.
      }
    }

    throw new HostsExhaustedError();
  }

  private async request(method: string, pathAndQuery: string, body: string | null): Promise<Json> {
    try {
      return await this.requestHosts(method, pathAndQuery, body);
    } catch (error) {
      if (!(error instanceof HostsExhaustedError) || this.token) throw error;
      // No session yet: the failures were probably unauthenticated. Handshake, retry once.
      await this.init();
      return this.requestHosts(method, pathAndQuery, body);
    }
  }

  private get(pathAndQuery: string): Promise<Json> {
    return this.request("GET", pathAndQuery, null);
  }

  private post(pathAndQuery: string, body: unknown): Promise<Json> {
    return this.request("POST", pathAndQuery, JSON.stringify(body));
  }

  search(keyword: string, page = 1): Promise<Json> {
    return this.post("/wefeed-mobile-bff/subject-api/search/v2", {
      keyword,
      page,
      perPage: 20,
      subjectType: "All",
      tabId: "All",
    });
  }

  /** Details, with `seasons` merged in for series (subjectType 2). */
  async getDetails(subjectId: string): Promise<Json> {
    const details = await this.get(
      `/wefeed-mobile-bff/subject-api/get?subjectId=${encodeURIComponent(subjectId)}`,
    );
    if (!details) return details;

    const subjectType = Number(details.subjectType ?? details.stype ?? 1);
    if (subjectType === 2) {
      try {
        details.seasons = await this.get(
          `/wefeed-mobile-bff/subject-api/season-info?subjectId=${encodeURIComponent(subjectId)}`,
        );
      } catch {
        details.seasons = null;
      }
    }
    return details;
  }

  /**
   * Filtered browse. This is the endpoint behind the app's "Categories" chips — the
   * `filterType` payload in their deep links is exactly this body.
   *
   * `country` matters most: the unfiltered feed is India-weighted, and `country: "All"`
   * also lets through junk `subjectType`s (music clips, wrestling uploads). `subjectType`
   * 1 = movie, 2 = series, and filtering on it is what keeps the rows clean.
   */
  listSubjects(params: {
    page?: number;
    perPage?: number;
    classify?: string;
    country?: string;
    genre?: string;
    sort?: string;
    year?: string;
    tabId?: number;
    subjectType?: 1 | 2;
  }): Promise<Json> {
    return this.post("/wefeed-mobile-bff/subject-api/list", {
      page: 1,
      perPage: 20,
      classify: "All",
      country: "All",
      genre: "All",
      sort: "ForYou",
      year: "All",
      tabId: 2,
      ...params,
    });
  }

  getHomepage(tabId: string, page = 1): Promise<Json> {
    return this.get(
      `/wefeed-mobile-bff/tab-operating?page=${page}&tabId=${encodeURIComponent(tabId)}&version=`,
    );
  }

  /**
   * Playable releases. `season`/`episode` of 0 means "the movie itself".
   * `resolution` of 0 means "every resolution".
   */
  /**
   * The original `subject-api/resource` path now answers with an empty `list` while still
   * reporting a correct `pager.totalCount`, which reads as "no sources" for every title.
   * `resource/v2` returns the real rows and is otherwise shape-compatible, including
   * still ignoring `se`/`ep`.
   */
  getResources(
    subjectId: string,
    season = 0,
    episode = 0,
    page = 1,
    resolution = 0,
    perPage = 20,
  ): Promise<Json> {
    const id = encodeURIComponent(subjectId);
    const res = resolution > 0 ? `&resolution=${resolution}` : "";
    const path =
      season === 0 && episode === 0
        ? `${RESOURCE_PATH}?subjectId=${id}&page=${page}&perPage=${perPage}${res}`
        : `${RESOURCE_PATH}?subjectId=${id}&se=${season}&ep=${episode}` +
          `&page=${page}&perPage=${perPage}${res}`;
    return this.get(path);
  }

  /**
   * The adaptive (DASH) rendition. This is where 720p and 1080p live: the progressive
   * `resource/v2` rows for those qualities come back with an empty `resourceLink`.
   */
  getPlayInfo(subjectId: string, season = 0, episode = 0): Promise<Json> {
    const id = encodeURIComponent(subjectId);
    const suffix = season > 0 || episode > 0 ? `&se=${season}&ep=${episode}` : "";
    return this.get(`/wefeed-mobile-bff/subject-api/play-info?subjectId=${id}${suffix}`);
  }

  async getCollectionResolutions(subjectId: string): Promise<number[]> {
    const payload = await this.get(
      `${RESOURCE_PATH}?subjectId=${encodeURIComponent(subjectId)}&page=1&perPage=20`,
    );
    const resolutions: number[] = [];
    for (const entry of payload?.collectionResolutions ?? []) {
      const value = Number(entry?.resolution);
      if (Number.isFinite(value) && value > 0) resolutions.push(value);
    }
    resolutions.sort((a, b) => b - a);
    return resolutions.length > 0 ? resolutions : [1080, 720, 480, 360];
  }

  getExtCaptions(subjectId: string, resourceId: string): Promise<Json> {
    return this.get(
      `/wefeed-mobile-bff/subject-api/get-ext-captions?subjectId=${encodeURIComponent(subjectId)}` +
        `&resourceId=${encodeURIComponent(resourceId)}`,
    );
  }
}
