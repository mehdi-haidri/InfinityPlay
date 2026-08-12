import { useMemo, useState } from "react";
import { Globe, LayoutGrid, ListVideo, RotateCw, Search } from "lucide-react";
import type { Channel } from "@shared/types";
import { api, unwrap } from "../lib/api";
import { useAsync, useDebounced } from "../hooks/useAsync";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { useApp } from "../store";
import { PageHeader } from "../components/PageHeader";
import { MediaImage } from "../components/MediaImage";
import { FilterSelect, type FilterOption } from "../components/FilterSelect";

export function LiveTvPage() {
  const playlists = useApp((state) => state.config.playlists);
  const openPlayer = useApp((state) => state.openPlayer);
  const navigate = useApp((state) => state.navigate);

  const [playlistIndex, setPlaylistIndex] = useState(0);
  const [group, setGroup] = useState("All");
  const [country, setCountry] = useState("All");
  const [query, setQuery] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const debouncedQuery = useDebounced(query, 220);

  const source = playlists[playlistIndex];

  const { data, loading, error, reload } = useAsync<Channel[]>(
    () => (source ? unwrap(api.tv.playlist(source.url, refreshToken > 0)) : Promise.resolve([])),
    [source?.url, refreshToken],
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

  const watch = (channel: Channel) => {
    // The player opens immediately with a spinner while the main process checks whether
    // this codec needs FFmpeg compatibility mode.
    openPlayer({
      title: channel.name,
      subtitleLine: channel.group || "Live TV",
      url: channel.streamUrl,
      live: true,
      posterUrl: channel.logo || null,
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
        description={`Browse ${source.name} by channel group or search.`}
      />

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 18, flexWrap: "wrap" }}>
        <FilterSelect
          label="Playlist"
          icon={<ListVideo size={14} color="var(--text-faint)" />}
          value={String(playlistIndex)}
          options={playlists.map((playlist, index) => ({
            value: String(index),
            label: playlist.name,
          }))}
          onChange={(next) => {
            setPlaylistIndex(Number(next));
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
                      <span className="card-sub">{channel.group || "Uncategorized"}</span>
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
