import { ExternalLink, Film, Tv } from "lucide-react";
import type { PersonDetails } from "@shared/types";
import { MediaImage } from "../components/MediaImage";
import { PosterCard } from "../components/PosterCard";
import { EmptyState, ErrorState, SkeletonGrid } from "../components/States";
import { useAsync } from "../hooks/useAsync";
import { api, unwrap } from "../lib/api";
import { useApp } from "../store";

interface Props {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export function PersonPage({ id, name, avatarUrl }: Props) {
  const preferredAudio = useApp((state) => state.config.preferredAudio);
  const hideAdultContent = useApp((state) => state.config.hideAdultContent);
  const { data, loading, error, reload } = useAsync<PersonDetails>(
    () => unwrap(api.catalog.person(id, name, avatarUrl)),
    [id, name, avatarUrl, preferredAudio, hideAdultContent],
  );

  return (
    <div className="page person-page">
      <section className="person-hero" aria-labelledby="person-name">
        <MediaImage
          src={data?.avatarUrl ?? avatarUrl}
          label={name}
          alt={`Portrait of ${name}`}
          className="person-portrait"
        />
        <div className="person-copy">
          <span className="page-eyebrow">Cast profile</span>
          <h1 id="person-name">{name}</h1>
          {loading && <div className="person-bio-skeleton skeleton" />}
          {!loading && data?.biography && <p className="person-biography">{data.biography}</p>}
          {!loading && data && !data.biography && (
            <p className="person-biography person-biography-muted">
              Explore the movies and series featuring {name} that are available in the catalog.
            </p>
          )}
          {data && (
            <div className="person-facts" aria-label="Available credits">
              <span><Film size={15} /> {data.movies.length} movies</span>
              <span><Tv size={15} /> {data.series.length} series</span>
              {data.biographySourceUrl && (
                <button
                  onClick={() => void unwrap(api.system.openExternal(data.biographySourceUrl!))}
                >
                  Biography source <ExternalLink size={13} />
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {error && <ErrorState message={error} onRetry={reload} />}
      {loading && (
        <>
          <section className="section"><h2 className="section-title">Movies</h2><SkeletonGrid /></section>
          <section className="section"><h2 className="section-title">Series</h2><SkeletonGrid /></section>
        </>
      )}

      {!loading && data && (
        <>
          <section className="section">
            <h2 className="section-title">Movies</h2>
            {data.movies.length > 0 ? (
              <div className="grid person-grid">
                {data.movies.map((item) => <PosterCard key={item.id} item={item} />)}
              </div>
            ) : (
              <EmptyState title="No movies found" body={`No movie credits for ${name} are currently available.`} />
            )}
          </section>

          <section className="section">
            <h2 className="section-title">Series</h2>
            {data.series.length > 0 ? (
              <div className="grid person-grid">
                {data.series.map((item) => <PosterCard key={item.id} item={item} />)}
              </div>
            ) : (
              <EmptyState title="No series found" body={`No series credits for ${name} are currently available.`} />
            )}
          </section>
        </>
      )}
    </div>
  );
}
