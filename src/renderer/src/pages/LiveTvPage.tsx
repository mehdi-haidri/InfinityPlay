import { useMemo, useState } from "react";
import { BadgeCheck, Globe, LayoutGrid, ListVideo, Radio, RotateCw, Search, Users } from "lucide-react";
import type { Channel, ChannelProgramme, PlaylistSource, XtreamSource } from "@shared/types";
import { api, unwrap } from "../lib/api";
import { useAsync, useDebounced } from "../hooks/useAsync";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { useApp } from "../store";
import { PageHeader } from "../components/PageHeader";
import { MediaImage } from "../components/MediaImage";
import { FilterSelect, type FilterOption } from "../components/FilterSelect";

export function LiveTvPage() {
  const playlists = useApp((state) => state.config.playlists);
  const xtreamSources = useApp((state) => state.config.xtreamSources);
  const openPlayer = useApp((state) => state.openPlayer);
  const navigate = useApp((state) => state.navigate);

  const [sourceKey, setSourceKey] = useState("");
  const [group, setGroup] = useState("All");
  const [country, setCountry] = useState("All");
  const [query, setQuery] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const debouncedQuery = useDebounced(query, 220);

  type SourceChoice =
    | { key: string; kind: "playlist"; label: string; value: PlaylistSource }
    | { key: string; kind: "xtream"; label: string; value: XtreamSource };
  const sources = useMemo<SourceChoice[]>(() => [
    ...playlists.map((value) => ({ key: `playlist:${value.url}`, kind: "playlist" as const, label: value.name, value })),
    ...xtreamSources.map((value) => ({ key: `xtream:${value.id}`, kind: "xtream" as const, label: `${value.name} · My IPTV`, value })),
  ], [playlists, xtreamSources]);
  const source = sources.find((entry) => entry.key === sourceKey) ?? sources[0];

  const { data, loading, error, reload } = useAsync<Channel[]>(
    () => source
      ? source.kind === "playlist"
        ? unwrap(api.tv.playlist(source.value, refreshToken > 0))
        : unwrap(api.tv.xtream(source.value))
      : Promise.resolve([]),
    [source?.key, refreshToken],
  );

  const groups = useMemo<FilterOption[]>(() => {
    const counts = new Map<string, number>();
    for (const channel of data ?? []) {
      const name = channel.group || "Uncategorized";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    return [
      { value: "All", label: "All types", count: (data ?? []).length },
      ...sorted.map(([name, count]) => ({ value: name, label: name, count })),
    ];
  }, [data]);

  /**
   * Countries present in this playlist, most channels first so the big ones are reachable
   * without scrolling 178 entries. `Intl.DisplayNames` turns the ISO codes into names
   * rather than shipping a country table.
   */
  const countries = useMemo(() => {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    const counts = new Map<string, number>();
    for (const channel of data ?? []) {
      if (!channel.country) continue;
      counts.set(channel.country, (counts.get(channel.country) ?? 0) + 1);
    }
    const entries = [...counts.entries()]
      .map(([code, count]) => {
        let label = code;
        try {
          label = names.of(code) ?? code;
        } catch {
          // Unknown or malformed code; the raw code is still a usable label.
        }
        return { value: code, label, count };
      })
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    return entries;
  }, [data]);

  const unknownCountryCount = useMemo(
    () => (data ?? []).filter((channel) => !channel.country).length,
    [data],
  );

  const channels = useMemo(() => {
    const term = debouncedQuery.trim().toLowerCase();
    return (data ?? []).filter((channel) => {
      if (group !== "All" && (channel.group || "Uncategorized") !== group) return false;
      if (country === "Unknown" && channel.country) return false;
      if (country !== "All" && country !== "Unknown" && channel.country !== country) return false;
      return term.length === 0 || channel.name.toLowerCase().includes(term);
    });
  }, [data, group, country, debouncedQuery]);

  const epgChannelIds = useMemo(() => channels.slice(0, 400).map((entry) => entry.id).filter(Boolean), [channels]);
  const epgKey = epgChannelIds.join("|");
  const programmes = useAsync<Record<string, ChannelProgramme[]>>(
    () => {
      if (!source || epgChannelIds.length === 0) return Promise.resolve({});
      if (source.kind === "xtream") return unwrap(api.tv.xtreamEpg(source.value, epgChannelIds));
      return source.value.epgUrl ? unwrap(api.tv.epg(source.value.epgUrl, epgChannelIds)) : Promise.resolve({});
    },
    [source?.key, source?.kind === "playlist" ? source.value.epgUrl : "xtream", epgKey],
  );

  const currentProgramme = (channel: Channel) => {
    const now = Date.now();
    return (programmes.data?.[channel.id] ?? []).find((entry) => entry.start <= now && entry.stop > now);
  };

  const watch = (channel: Channel) => {
    // The player opens immediately with a spinner while the main process checks whether
    // this codec needs FFmpeg compatibility mode.
    openPlayer({
      title: channel.name,
      subtitleLine: channel.group || "Live TV",
      url: channel.streamUrl,
      live: true,
      posterUrl: channel.logo || null,
      headers: channel.headers,
    });
  };

  if (!source) {
    return (
      <div className="page">
        <PageHeader
          eyebrow="Live"
          title="Live TV"
          description="Watch channels from your own M3U playlists."
        />
        <EmptyState title="No playlists yet" body="Add an M3U playlist in Settings to watch live channels." />
        <div style={{ display: "grid", placeItems: "center" }}>
          <button className="btn" onClick={() => navigate({ name: "settings" })}>Open settings</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Live"
        title="Live TV"
          description={`Browse ${source.label} by channel group or search.`}
      />

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 18, flexWrap: "wrap" }}>
        <FilterSelect
          label="Playlist"
          icon={<ListVideo size={14} color="var(--text-faint)" />}
          value={source.key}
          options={sources.map((entry) => ({
            value: entry.key,
            label: entry.label,
          }))}
          onChange={(next) => {
            setSourceKey(next);
            setGroup("All");
            setCountry("All");
          }}
          searchPlaceholder="Search playlists…"
        />

        <FilterSelect
          label="Country"
          icon={<Globe size={14} color="var(--text-faint)" />}
          value={country}
          options={[
            { value: "All", label: "All countries", count: (data ?? []).length },
            ...countries,
            ...(unknownCountryCount > 0
              ? [{ value: "Unknown", label: "Unknown", count: unknownCountryCount }]
              : []),
          ]}
          onChange={setCountry}
          searchPlaceholder="Search countries…"
        />

        <FilterSelect
          label="Type"
          icon={<LayoutGrid size={14} color="var(--text-faint)" />}
          value={group}
          options={groups}
          onChange={setGroup}
          searchPlaceholder="Search types…"
        />

        <div className="search-field" style={{ maxWidth: 300 }}>
          <Search size={15} color="var(--text-faint)" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter channels"
            aria-label="Filter channels"
          />
        </div>

        <button className="btn btn-sm" onClick={() => setRefreshToken((value) => value + 1)}>
          <RotateCw size={14} /> Refresh
        </button>

        <span style={{ color: "var(--text-faint)", fontSize: 12, marginLeft: "auto" }}>
          {channels.length} channels
        </span>
      </div>

      {loading && <LoadingState label="Loading playlist…" />}
      {error && <ErrorState message={error} onRetry={reload} />}

      {!loading && !error && (
        <div>
          <div>
            {channels.length === 0 ? (
              <EmptyState title="No channels match" body="Try another country or group, or clear the filter." />
            ) : (
              <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }}>
                {channels.slice(0, 400).map((channel) => (
                  <button
                    key={`${channel.id}-${channel.streamUrl}`}
                    className="panel"
                    style={{ display: "flex", alignItems: "center", gap: 12, textAlign: "left", padding: 12 }}
                    onClick={() => watch(channel)}
                    title={channel.name}
                  >
                    <MediaImage
                      src={channel.logo}
                      label={channel.name}
                      alt=""
                      className="channel-art"
                    />
                    <span style={{ minWidth: 0 }}>
                      <span className="card-title" style={{ display: "block" }}>{channel.name}</span>
                      <span className="card-sub">
                        {currentProgramme(channel)?.title || channel.group || "Uncategorized"}
                      </span>
                      <span className="source-trust" data-trust={channel.trust ?? "user"} title={channel.trustNote}>
                        {channel.trust === "official" ? <BadgeCheck size={11} /> : channel.trust === "community" ? <Users size={11} /> : <Radio size={11} />}
                        {channel.trust === "official" ? "Verified free" : channel.trust === "community" ? "Community link" : "Your provider"}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            {channels.length > 400 && (
              <p style={{ color: "var(--text-faint)", marginTop: 16 }}>
                Showing the first 400 of {channels.length}. Narrow the filter to see the rest.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
