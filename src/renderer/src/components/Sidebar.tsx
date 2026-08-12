import {
  Clock,
  Download,
  Home,
  Info,
  Radio,
  Search,
  Settings,
} from "lucide-react";
import { useApp, type Route } from "../store";
import logoUrl from "../assets/logo.png";

const ITEMS: { route: Route; label: string; icon: typeof Home }[] = [
  { route: { name: "home" }, label: "Home", icon: Home },
  { route: { name: "search", query: "" }, label: "Search", icon: Search },
  { route: { name: "livetv" }, label: "Live TV", icon: Radio },
  { route: { name: "history" }, label: "Continue watching", icon: Clock },
  { route: { name: "downloads" }, label: "Downloads", icon: Download },
  { route: { name: "settings" }, label: "Settings", icon: Settings },
];

export function Sidebar() {
  const route = useApp((state) => state.route);
  const navigate = useApp((state) => state.navigate);

  return (
    <nav className="sidebar">
      <div className="brand">
        <img src={logoUrl} alt="" className="brand-mark" />
        InfinityPlay
      </div>

      {ITEMS.map(({ route: target, label, icon: Icon }) => (
        <button
          key={label}
          className="nav-item"
          aria-current={route.name === target.name ? "page" : undefined}
          onClick={() => navigate(target)}
        >
          <Icon size={18} />
          {label}
        </button>
      ))}

      {/* Pinned to the bottom, below a rule: About is not part of the browsing flow. */}
      <div className="sidebar-bottom">
        <button
          className="nav-item nav-item-about"
          aria-current={route.name === "about" ? "page" : undefined}
          onClick={() => navigate({ name: "about" })}
        >
          <Info size={16} />
          About
        </button>
      </div>
    </nav>
  );
}
