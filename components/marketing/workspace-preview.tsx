import {
  ArrowUpRight,
  CheckCheck,
  LayoutDashboard,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import { MapIllustration } from "@/components/dashboard/map-illustration";
import { StatusBadge } from "@/components/ui/status-badge";
import { demoVerifications } from "@/lib/demo-data";

export function WorkspacePreview() {
  return (
    <div
      className="workspace-preview"
      role="img"
      aria-label="Illustrative dispatcher workspace showing demo statistics, a Lagos map, and sample verification requests."
    >
      <div className="preview-chrome">
        <div>
          <span />
          <span />
          <span />
        </div>
        <span>spotly / dispatcher workspace</span>
        <span className="preview-demo">Demo data</span>
      </div>
      <div className="preview-body">
        <aside className="preview-sidebar" aria-hidden="true">
          <MapPin size={25} />
          <LayoutDashboard size={19} />
          <ShieldCheck size={19} />
          <MapPin size={19} />
        </aside>
        <div className="preview-content">
          <div className="preview-title">
            <div>
              <span>YOUR OPERATIONS, IN VIEW</span>
              <h3>Operations overview</h3>
            </div>
            <span className="preview-region">
              <span />
              Lagos region
            </span>
          </div>
          <div className="preview-stats">
            <div>
              <span>Active verifications</span>
              <strong>02</strong>
            </div>
            <div>
              <span>Awaiting review</span>
              <strong>01</strong>
            </div>
            <div>
              <span>Completed</span>
              <strong>
                01 <CheckCheck size={18} />
              </strong>
            </div>
          </div>
          <div className="preview-map">
            <MapIllustration patternId="preview-blocks" />
            <span className="preview-map-caption">
              Illustrative map · not live
            </span>
            <span className="preview-pin">
              <MapPin size={24} />
            </span>
            <div className="preview-location">
              <span className="legend-dot" />
              Lagos–Ibadan expressway
              <ArrowUpRight size={15} />
            </div>
          </div>
          <div className="preview-requests">
            <h4>Recent verifications</h4>
            {demoVerifications.slice(0, 2).map((request) => (
              <div className="preview-row" key={request.id}>
                <MapPin size={17} />
                <span>
                  {request.title}
                  <small>
                    {request.id} · {request.locationDescription}
                  </small>
                </span>
                <StatusBadge status={request.status} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
