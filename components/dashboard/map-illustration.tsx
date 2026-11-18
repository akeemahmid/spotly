export function MapIllustration({
  patternId = "map-blocks",
}: {
  patternId?: string;
}) {
  return (
    <svg
      className="map-art"
      viewBox="0 0 900 350"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id={patternId}
          width="95"
          height="75"
          patternTransform="rotate(-16)"
          patternUnits="userSpaceOnUse"
        >
          <rect width="95" height="75" fill="#edf0e7" />
          <rect x="6" y="6" width="80" height="59" rx="6" fill="#e4e9dc" />
          <path d="M0 0H95M0 0V75" stroke="#fafbf7" strokeWidth="9" />
        </pattern>
      </defs>
      <rect width="900" height="350" fill={`url(#${patternId})`} />
      <path d="M470 350Q445 280 565 245T735 185T900 150V350Z" fill="#c8dfe0" />
      <path
        d="M550 350Q560 277 700 253T900 218"
        fill="none"
        stroke="#dfeae4"
        strokeWidth="14"
      />
      <path
        d="M-40 230Q200 210 325 120T670 -30M145 380Q240 230 445 205T870 20M-10 74Q280 155 440 175T925 280"
        fill="none"
        stroke="#d4d8c8"
        strokeWidth="18"
      />
      <path
        d="M-40 230Q200 210 325 120T670 -30M145 380Q240 230 445 205T870 20M-10 74Q280 155 440 175T925 280"
        fill="none"
        stroke="#fffdf2"
        strokeWidth="12"
      />
      <path
        d="M267 204Q340 157 416 119T500 35"
        fill="none"
        stroke="#126b53"
        strokeWidth="4"
        strokeDasharray="7 7"
      />
      <g fill="#788579" fontSize="12" fontFamily="inherit" letterSpacing="2">
        <text x="180" y="110">
          IKEJA
        </text>
        <text x="360" y="265">
          LAGOS
        </text>
        <text x="620" y="135">
          IKORODU
        </text>
        <text x="665" y="323">
          LAGOS LAGOON
        </text>
        <text x="422" y="60">
          BERGER
        </text>
      </g>
    </svg>
  );
}
