"use client";
import { useEffect, useRef, useState } from "react";
import { Crosshair, LoaderCircle, MapPin } from "lucide-react";
import type * as Leaflet from "leaflet";
import type { Coordinates } from "@/types/verification";

export function LocationMap({
  value,
  onChange,
}: {
  value: Coordinates | null;
  onChange?: (value: Coordinates) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const marker = useRef<Leaflet.Marker | null>(null);
  const tiles = useRef<Leaflet.TileLayer | null>(null);
  const latest = useRef({ value, onChange });
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [tileError, setTileError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    latest.current = { value, onChange };
  }, [value, onChange]);
  useEffect(() => {
    let disposed = false;
    let resizeObserver: ResizeObserver | undefined;
    async function initialize() {
      try {
        const L = await import("leaflet");
        if (disposed || !container.current) return;
        const initial = latest.current.value;
        const editable = Boolean(latest.current.onChange);
        const instance = L.map(container.current, {
          scrollWheelZoom: false,
          keyboard: true,
          zoomAnimation: false,
          fadeAnimation: false,
          markerZoomAnimation: false,
        }).setView(
          initial ? [initial.latitude, initial.longitude] : [6.5244, 3.3792],
          initial ? 14 : 11,
        );
        map.current = instance;
        tiles.current = L.tileLayer(
          "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
          {
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19,
            minZoom: 2,
            updateWhenIdle: true,
            updateWhenZooming: false,
            keepBuffer: 1,
          },
        )
          .on("tileerror", () => {
            if (!disposed) setTileError(true);
          })
          .addTo(instance);
        const icon = L.divIcon({
          className: "spotly-map-marker",
          html: '<span aria-hidden="true"></span>',
          iconSize: [30, 38],
          iconAnchor: [15, 38],
        });
        const setMarker = (point: Coordinates) => {
          if (!marker.current) {
            marker.current = L.marker([point.latitude, point.longitude], {
              icon,
              draggable: editable,
              title: editable
                ? "Selected location. Drag to reposition, or edit the coordinate fields."
                : "Selected verification location",
              alt: "Selected verification location",
              autoPan: editable,
            }).addTo(instance);
            marker.current.on("dragend", () => {
              const selected = marker.current?.getLatLng().wrap();
              if (selected)
                latest.current.onChange?.({
                  latitude: Number(selected.lat.toFixed(6)),
                  longitude: Number(selected.lng.toFixed(6)),
                });
            });
          } else marker.current.setLatLng([point.latitude, point.longitude]);
        };
        if (initial) setMarker(initial);
        instance.on("click", (event: Leaflet.LeafletMouseEvent) => {
          if (!editable) return;
          const point = event.latlng.wrap();
          const coordinates = {
            latitude: Number(point.lat.toFixed(6)),
            longitude: Number(point.lng.toFixed(6)),
          };
          setMarker(coordinates);
          latest.current.onChange?.(coordinates);
        });
        // Controlled coordinates can change from keyboard input as well as map gestures.
        instance.on("spotly:coordinates", () => {
          const point = latest.current.value;
          if (point) {
            setMarker(point);
            instance.panTo([point.latitude, point.longitude], {
              animate: false,
            });
          } else if (marker.current) {
            marker.current.remove();
            marker.current = null;
          }
        });
        if (typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(() => instance.invalidateSize());
          resizeObserver.observe(container.current);
        }
        setState("ready");
      } catch {
        if (!disposed) setState("error");
      }
    }
    void initialize();
    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      map.current?.remove();
      map.current = null;
      marker.current = null;
      tiles.current = null;
    };
  }, [attempt]);
  useEffect(() => {
    map.current?.fire("spotly:coordinates");
  }, [value?.latitude, value?.longitude]);
  return (
    <div className="location-map">
      <div
        className="leaflet-surface"
        ref={container}
        tabIndex={0}
        role="region"
        aria-label={
          onChange
            ? "Location map. Use arrow keys to pan, then choose Use map center, or enter coordinates in the form."
            : "Selected request location map"
        }
      />
      {state === "loading" && (
        <div className="map-state" role="status">
          <LoaderCircle size={22} />
          <span>Loading location map…</span>
        </div>
      )}
      {state === "error" && (
        <div className="map-state" role="alert">
          <MapPin size={25} />
          <strong>The map couldn’t load.</strong>
          <span>
            {onChange
              ? "You can still enter exact coordinates in the form."
              : "The saved coordinates are listed below."}
          </span>
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setState("loading");
              setTileError(false);
              setAttempt((current) => current + 1);
            }}
          >
            Retry map
          </button>
        </div>
      )}
      {state === "ready" && tileError && (
        <div className="tile-warning" role="status">
          Map tiles couldn’t load.{" "}
          {onChange
            ? "You can still select a point or enter coordinates."
            : "Your saved coordinates are shown below."}
          <button
            type="button"
            onClick={() => {
              setTileError(false);
              tiles.current?.redraw();
            }}
          >
            Retry tiles
          </button>
        </div>
      )}
      {state === "ready" && onChange && (
        <button
          type="button"
          className="map-center-button"
          onClick={() => {
            const center = map.current?.getCenter().wrap();
            if (center)
              onChange({
                latitude: Number(center.lat.toFixed(6)),
                longitude: Number(center.lng.toFixed(6)),
              });
          }}
        >
          <Crosshair size={14} />
          Use map center
        </button>
      )}
      <div className="map-policy">
        <span>OpenStreetMap tiles · prototype use</span>
        <a
          href="https://www.openstreetmap.org/fixthemap"
          target="_blank"
          rel="noopener noreferrer"
        >
          Report a map issue
        </a>
      </div>
    </div>
  );
}
