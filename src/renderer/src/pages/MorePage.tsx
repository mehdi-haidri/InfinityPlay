import { useEffect, useState, type ComponentType } from "react";
import { ChevronRight, Clock, Clock3, Heart, Info, LibraryBig, Settings, Sparkles } from "lucide-react";
import type { AppInfo } from "@shared/types";
import { api, unwrap } from "../lib/api";
import { BrandMark } from "../components/BrandMark";
import { useApp, type Route } from "../store";

type Entry = {
  route: Route;
  label: string;
  hint: string;
  icon: ComponentType<{ size?: string | number }>;
  /** Drawn as a pill on the right. Omitted when there is nothing to count. */
  badge?: number;
  tone: "browse" | "system";
};

/**
 * The phone bottom bar carries a few destinations plus this hub. Everything else lives here,
 * grouped so the list reads as two short sections rather than one long scroll.
 */
export function MorePage() {
  const navigate = useApp((state) => state.navigate);
  const favorites = useApp((state) => state.favorites);
  const watchHistory = useApp((state) => state.watchHistory);
  const watchLater = useApp((state) => state.watchLater);
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    unwrap(api.app.info())
      .then((value) => {
        if (!cancelled) setInfo(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const groups: { title: string; entries: Entry[] }[] = [
    {
      title: "Browse",
      entries: [
        {
          route: { name: "anime" },
          label: "Anime",
          hint: "Series and films, original audio",
          icon: Sparkles,
          tone: "browse",
        },
        {
          route: { name: "free-library" },
          label: "Free Library",
          hint: "Rights-cleared films and archive media",
          icon: LibraryBig,
          tone: "browse",
        },
        {
          route: { name: "history" },
          label: "Continue watching",
          hint: "Pick up where you stopped",
          icon: Clock,
          badge: watchHistory.length,
          tone: "browse",
        },
        {
          route: { name: "watch-later" },
          label: "Watch later",
          hint: "Titles you saved for another time",
          icon: Clock3,
          badge: watchLater.length,
          tone: "browse",
        },
        {
          route: { name: "favorites" },
          label: "Favorites",
          hint: "Everything you saved",
          icon: Heart,
          badge: favorites.length,
          tone: "browse",
        },
      ],
    },
    {
      title: "System",
      entries: [
        {
          route: { name: "settings" },
          label: "Settings",
          hint: "Playback, downloads, playlists",
          icon: Settings,
          tone: "system",
        },
        {
          route: { name: "about" },
          label: "About",
          hint: "Version, updates and credits",
          icon: Info,
          tone: "system",
        },
      ],
    },
  ];

  return (
    <div className="page more-page">
      <div className="more-hero">
        <BrandMark className="more-hero-mark" />
        <div className="more-hero-text">
          <h1 className="more-hero-title">InfinityPlay</h1>
          <p className="more-hero-meta">
            {info ? `Version ${info.version}` : "Everything else, in one place"}
          </p>
        </div>
      </div>

      {groups.map((group) => (
        <section className="more-group" key={group.title}>
          <h2 className="more-group-title">{group.title}</h2>
          <div className="more-list">
            {group.entries.map(({ route, label, hint, icon: Icon, badge, tone }) => (
              <button
                key={label}
                className="more-row"
                data-tone={tone}
                data-focus-key={`more-${route.name}`}
                onClick={() => navigate(route)}
              >
                <span className="more-row-icon">
                  <Icon size={18} />
                </span>
                <span className="more-row-text">
                  <span className="more-row-label">{label}</span>
                  <span className="more-row-hint">{hint}</span>
                </span>
                {badge ? <span className="more-row-badge">{badge}</span> : null}
                <ChevronRight className="more-row-chevron" size={17} />
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
