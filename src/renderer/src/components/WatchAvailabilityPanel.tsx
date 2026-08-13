import { ExternalLink } from "lucide-react";
import type { MediaType, WatchProviderOption } from "@shared/types";
import { api, unwrap } from "../lib/api";
import { useAsync } from "../hooks/useAsync";
import { useApp } from "../store";
import { MediaImage } from "./MediaImage";

function ProviderGroup({ title, entries }: { title: string; entries: WatchProviderOption[] }) {
  if (entries.length === 0) return null;
  return (
    <div className="watch-provider-group">
      <div className="setting-hint">{title}</div>
      <div className="watch-provider-list">
        {entries.map((entry) => (
          <span className="watch-provider" key={`${title}:${entry.id}`} title={entry.name}>
            <MediaImage src={entry.logoUrl} label={entry.name} alt="" />
            <span>{entry.name}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function WatchAvailabilityPanel({ title, mediaType }: { title: string; mediaType: MediaType }) {
  const token = useApp((state) => state.config.tmdbReadToken);
  const region = useApp((state) => state.config.watchRegion);
  const availability = useAsync(
    () => unwrap(api.availability.title(title, mediaType)),
    [title, mediaType, token, region],
  );

  if (!token) {
    return (
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-title">Watch legally</div>
        <div className="setting-hint">Add a TMDB read token in Settings to see free, ad-supported, subscription, rental, and purchase options in your region.</div>
      </div>
    );
  }
  if (availability.loading) return <div className="panel setting-hint" style={{ marginBottom: 16 }}>Checking legal availability…</div>;
  if (availability.error || !availability.data) return null;
  const data = availability.data;
  const total = data.free.length + data.ads.length + data.subscription.length + data.rent.length + data.buy.length;

  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-title">Watch legally · {data.region}</div>
      {total === 0 ? (
        <div className="setting-hint">No provider availability was reported for this title in {data.region}.</div>
      ) : (
        <>
          <ProviderGroup title="Free" entries={data.free} />
          <ProviderGroup title="Free with ads" entries={data.ads} />
          <ProviderGroup title="Subscription" entries={data.subscription} />
          <ProviderGroup title="Rent" entries={data.rent} />
          <ProviderGroup title="Buy" entries={data.buy} />
        </>
      )}
      {data.link && <button className="btn btn-sm btn-ghost" style={{ marginTop: 12 }} onClick={() => void unwrap(api.system.openExternal(data.link!))}><ExternalLink size={14} /> Open provider links</button>}
      <div className="setting-hint" style={{ marginTop: 9 }}>Availability data by JustWatch via TMDB.</div>
    </div>
  );
}
