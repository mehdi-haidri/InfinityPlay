import type { MediaDetails } from "@shared/types";
import { MediaImage } from "../../components/MediaImage";

interface Props {
  media: MediaDetails;
  onNavigatePerson: (id: string, name: string, avatarUrl: string | null) => void;
}

export function CastSection({ media, onNavigatePerson }: Props) {
  if (media.cast.length === 0) return null;

  return (
    <section className="section">
      <h2 className="section-title">Cast</h2>
      <div className="cast-row">
        {media.cast.map((member, index) => (
          <button
            className="cast"
            key={`${member.name}-${index}`}
            onClick={() => onNavigatePerson(member.id, member.name, member.avatarUrl)}
            aria-label={`View ${member.name}'s movies and series`}
          >
            <MediaImage
              src={member.avatarUrl}
              label={member.name}
              alt={`Portrait of ${member.name}`}
              className="cast-avatar"
            />
            <div className="cast-name">{member.name}</div>
            <div className="cast-role">{member.character}</div>
          </button>
        ))}
      </div>
    </section>
  );
}
