import Link from "next/link";
import { MapPin } from "lucide-react";

export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="Spotly home">
      <span className="brand-symbol">
        <MapPin size={23} strokeWidth={2.3} aria-hidden="true" />
      </span>
      spotly<span className="brand-dot">.</span>
    </Link>
  );
}
