import { Brand } from "./brand";
import {
  LayoutDashboard,
  Map,
  Settings,
  ShieldCheck,
  Wallet,
} from "lucide-react";
export function Sidebar({
  view,
  onView,
  count,
}: {
  view: string;
  onView: (view: string) => void;
  count: number;
}) {
  return (
    <aside className="sidebar">
      <Brand />
      <div className="workspace">
        <span className="workspace-icon">S</span>
        <div>
          Spotly workspace<small>Dispatcher workspace</small>
        </div>
        <span className="workspace-arrow">⌄</span>
      </div>
      <p className="nav-label">WORKSPACE</p>
      <nav aria-label="Main navigation">
        {[
          { label: "Overview", icon: LayoutDashboard },
          { label: "Verifications", icon: ShieldCheck },
          { label: "Map", icon: Map },
        ].map(({ label, icon: Icon }) => (
          <button
            key={label}
            className={`nav-item ${view === label ? "active" : ""}`}
            onClick={() => onView(label)}
            aria-current={view === label ? "page" : undefined}
          >
            <Icon size={19} />
            {label}
            {label === "Verifications" && (
              <span className="nav-count">{count}</span>
            )}
          </button>
        ))}
        <div className="nav-divider" />
        {[
          { label: "Payments", icon: Wallet },
          { label: "Settings", icon: Settings },
        ].map(({ label, icon: Icon }) => (
          <button
            className="nav-item unavailable"
            disabled
            key={label}
            title="Not available yet"
          >
            <Icon size={19} />
            {label}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="profile">
          <span className="avatar">S</span>
          <div>
            Spotly account<small>Authenticated dispatcher</small>
          </div>
          <span className="demo-dot" />
        </div>
      </div>
    </aside>
  );
}
