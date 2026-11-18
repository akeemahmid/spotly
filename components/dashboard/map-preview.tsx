import { MapIllustration } from "./map-illustration";
import { ArrowUpRight, Layers, MapPin } from "lucide-react";
export function MapPreview({
  onSelect,
}: {
  onSelect: (index: number) => void;
}) {
  return (
    <section className="card map-card" aria-labelledby="map-title">
      <div className="card-heading">
        <div>
          <h2 id="map-title">Verification coverage</h2>
          <p>Explore sample requests across the Lagos region.</p>
        </div>
        <span className="subtle-tag">
          <span /> Lagos region
        </span>
      </div>
      <div className="map-canvas">
        <MapIllustration />
        <span className="map-label">
          <Layers size={14} /> Illustrative map · not live
        </span>
        <button
          className="map-marker marker-one"
          onClick={() => onSelect(0)}
          aria-label="View Lagos–Ibadan expressway request"
        >
          <MapPin size={21} />
        </button>
        <button
          className="map-marker marker-two"
          onClick={() => onSelect(1)}
          aria-label="View Apapa port access request"
        >
          <MapPin size={21} />
        </button>
        <button
          className="map-marker marker-three"
          onClick={() => onSelect(2)}
          aria-label="View Third Mainland Bridge request"
        >
          <MapPin size={21} />
        </button>
        <div className="map-callout">
          <span className="pulse-dot" />
          <div>
            <strong>Lagos–Ibadan expressway</strong>
            <small>Demo verification in progress</small>
          </div>
          <ArrowUpRight size={17} />
        </div>
        <span className="map-scale">Regional illustration · not to scale</span>
      </div>
      <div className="map-footer">
        <span>
          <span className="legend-dot" /> 3 illustrative markers
        </span>
        <span>Ground-level context. City-wide confidence.</span>
      </div>
    </section>
  );
}
