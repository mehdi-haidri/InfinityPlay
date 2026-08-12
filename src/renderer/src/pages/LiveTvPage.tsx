import { useMemo, useState } from "react";
import { Radio, RotateCw, Search } from "lucide-react";
import type { Channel } from "@shared/types";
import { api, unwrap } from "../lib/api";
import { useAsync, useDebounced } from "../hooks/useAsync";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { useApp } from "../store";
import { PageHeader } from "../components/PageHeader";
import { MediaImage } from "../components/MediaImage";

export function LiveTvPage() {
  const playlists = useApp((state) => state.config.playlists);
  const openPlayer = useApp((state) => state.openPlayer);
  const navigate = useApp((state) => state.navigate);

  const [playlistIndex, setPlaylistIndex] = useState(0);
  const [group, setGroup] = useState("All");
  const [query, setQuery] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const debouncedQuery = useDebounced(query, 220);

  const source = playlists[playlistIndex];

  const { data, loading, error, reload } = useAsync<Channel[]>(
    () => (source ? unwrap(api.tv.playlist(source.url, refreshToken > 0)) : Promise.resolve([])),
    [source?.url, refreshToken],
  );

  const groups = useMemo(() => {
    const seen = new Set<string>();
    for (const channel of data ?? []) seen.add(channel.group || "Uncategorized");
    return ["All", ...[...seen].sort()];
  }, [data]);

  const channels = useMemo(() => {
    const term = debouncedQuery.trim().toLowerCase();
    return (data ?? []).filter((channel) => {
      if (group !== "All" && (channel.group || "Uncategorized") !== group) return false;
      return term.length === 0 || channel.name.toLowerCase().includes(term);
    });
  }, [data, group, debouncedQuery]);

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
        <select
          className="input"
          value={playlistIndex}
          onChange={(event) => {
            setPlaylistIndex(Number(event.target.value));
            setGroup("All");
          }}
          aria-label="Playlist"
        >
          {playlists.map((playlist, index) => (
            <option key={playlist.url} value={index}>{playlist.name}</option>
          ))}
        </select>

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
        <div className="tv-layout">
          <div className="panel">
            <div className="panel-title">Groups</div>
            <div className="channel-list">
              {groups.map((name) => (
                <button
                  key={name}
                  className="channel"
                  data-active={name === group}
                  onClick={() => setGroup(name)}
                >
                  <Radio size={15} />
                  <span className="channel-name">{name}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            {channels.length === 0 ? (
              <EmptyState title="No channels match" body="Try another group or clear the filter." />
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
