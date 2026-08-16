import {
  Clock,
  Clock3,
  Home,
  Heart,
  Info,
  LibraryBig,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sparkles,
} from "lucide-react";
import { type ComponentType, useState } from "react";
import { useApp, type Route } from "../store";
import { downloadsSupported } from "../lib/device";
import { BrandMark } from "./BrandMark";
import { DownloadIcon, LiveIcon } from "./CoreIcons";

type Item = {
  route: Route;
  label: string;
  icon: ComponentType<{ size?: string | number }>;
  /** Phone label, when the full one is too long for a 20%-wide tab. */
  shortLabel?: string;
};

const ITEMS: Item[] = [
  { route: { name: "home" }, label: "Home", icon: Home },
  { route: { name: "anime" }, label: "Anime", icon: Sparkles },
  { route: { name: "free-library" }, label: "Free Library", icon: LibraryBig, shortLabel: "Library" },
  { route: { name: "livetv" }, label: "Live TV", icon: LiveIcon },
  { route: { name: "history" }, label: "Continue watching", icon: Clock },
  { route: { name: "favorites" }, label: "Favorites", icon: Heart },
  { route: { name: "watch-later" }, label: "Watch later", icon: Clock3 },
  { route: { name: "downloads" }, label: "Downloads", icon: DownloadIcon },
  { route: { name: "settings" }, label: "Settings", icon: Settings },
];

/** The ones that keep a tab of their own on phones; the rest move into the More hub. */
const PHONE_TABS = new Set(["home", "livetv", "downloads"]);

/** Routes that the More tab owns, so it stays highlighted while the user is inside one. */
const MORE_ROUTES = new Set([
  "more",
  "anime",
  "free-library",
  "history",
  "favorites",
  "watch-later",
  "settings",
  "about",
]);

export function Sidebar() {
  const route = useApp((state) => state.route);
  const navigate = useApp((state) => state.navigate);
  const [collapsed, setCollapsed] = useState(
    () => window.localStorage.getItem("infinityplay:ui:sidebar:v1") === "true",
  );
  const activeDownloads = useApp((state) =>
    state.downloads.filter((entry) => entry.state === "progressing").length,
  );
  // A destination that can never hold anything is worse than one tab fewer.
  const canDownload = downloadsSupported();

  const toggle = () => {
    setCollapsed((value) => {
      window.localStorage.setItem("infinityplay:ui:sidebar:v1", String(!value));
      return !value;
    });
  };

  return (
    <nav className="sidebar" data-collapsed={collapsed} aria-label="Primary navigation">
      <div className="brand">
        <BrandMark className="brand-mark" />
        <span className="brand-name">InfinityPlay</span>
        <button
          className="sidebar-toggle icon-button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
      </div>

      {ITEMS.filter((item) => item.route.name !== "downloads" || canDownload).map(({ route: target, label, shortLabel, icon: Icon }) => (
        <button
          key={label}
          className="nav-item"
          /* Every destination stays in the DOM at every size; on phones the CSS hides the ones
             the More hub owns, so the markup has a single source of truth. */
          data-phone-tab={PHONE_TABS.has(target.name) || undefined}
          data-focus-key={`nav-${target.name}`}
          data-focus-initial={target.name === "home" || undefined}
          aria-current={route.name === target.name ? "page" : undefined}
          onClick={() => navigate(target)}
          title={collapsed ? label : undefined}
        >
          <span className="nav-item-glyph">
            <Icon size={18} />
            {target.name === "downloads" && activeDownloads > 0 && (
              <span className="nav-item-dot" aria-hidden="true" />
            )}
          </span>
          <span className="nav-label">{label}</span>
          {shortLabel && <span className="nav-label-short">{shortLabel}</span>}
        </button>
      ))}

      {/* Phone-only tab. Hidden everywhere else, where the full list is already visible. */}
      <button
        className="nav-item nav-item-more"
        data-phone-tab
        data-focus-key="nav-more"
        aria-current={MORE_ROUTES.has(route.name) ? "page" : undefined}
        onClick={() => navigate({ name: "more" })}
      >
        <span className="nav-item-glyph">
          <MoreHorizontal size={19} />
        </span>
        <span className="nav-label">More</span>
      </button>

      {/* Pinned to the bottom, below a rule: About is not part of the browsing flow. */}
      <div className="sidebar-bottom">
        <button
          className="nav-item nav-item-about"
          aria-current={route.name === "about" ? "page" : undefined}
          onClick={() => navigate({ name: "about" })}
          title={collapsed ? "About" : undefined}
        >
          <Info size={16} />
          <span className="nav-label">About</span>
        </button>
      </div>
    </nav>
  );
}
