import {
  Clock,
  Home,
  Info,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
} from "lucide-react";
import { useState, type ComponentType } from "react";
import { useApp, type Route } from "../store";
import { BrandMark } from "./BrandMark";
import { DownloadIcon, LiveIcon } from "./CoreIcons";

const ITEMS: { route: Route; label: string; icon: ComponentType<{ size?: string | number }> }[] = [
  { route: { name: "home" }, label: "Home", icon: Home },
  { route: { name: "search", query: "" }, label: "Search", icon: Search },
  { route: { name: "livetv" }, label: "Live TV", icon: LiveIcon },
  { route: { name: "history" }, label: "Continue watching", icon: Clock },
  { route: { name: "downloads" }, label: "Downloads", icon: DownloadIcon },
  { route: { name: "settings" }, label: "Settings", icon: Settings },
];

export function Sidebar() {
  const route = useApp((state) => state.route);
  const navigate = useApp((state) => state.navigate);
  const [collapsed, setCollapsed] = useState(
    () => window.localStorage.getItem("infinityplay:ui:sidebar:v1") === "true",
  );

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

      {ITEMS.map(({ route: target, label, icon: Icon }) => (
        <button
          key={label}
          className="nav-item"
          aria-current={route.name === target.name ? "page" : undefined}
          onClick={() => navigate(target)}
          title={collapsed ? label : undefined}
        >
          <Icon size={18} />
          <span className="nav-label">{label}</span>
        </button>
      ))}

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
