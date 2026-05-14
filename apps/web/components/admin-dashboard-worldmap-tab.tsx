import type { MapDateRange, WorldAtlasCountryFeature } from "@/components/admin-dashboard-types";

type WorldMapComputed = {
  width: number;
  height: number;
  meridians: number[];
  parallels: number[];
  countries: Array<{
    id: string;
    name: string;
    renderKey: string;
    geometry: WorldAtlasCountryFeature;
    path: string;
  }>;
  countryVisitorCount: Map<string, number>;
  getCountryFill: (countryId: string) => string;
  maxCountryVisitors: number;
};

type AdminDashboardWorldMapTabProps = {
  mapDateRange: MapDateRange;
  onSetMapDateRange: (range: MapDateRange) => void;
  worldMap: WorldMapComputed;
  filteredWorldMapVisitorsCount: number;
};

export function AdminDashboardWorldMapTab({
  mapDateRange,
  onSetMapDateRange,
  worldMap,
  filteredWorldMapVisitorsCount,
}: AdminDashboardWorldMapTabProps) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "flex-start", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {([
          { key: "allTime", label: "All time" },
          { key: "today", label: "Today" },
          { key: "thisWeek", label: "This week" },
          { key: "thisMonth", label: "This month" },
          { key: "thisYear", label: "This year" },
        ] as Array<{ key: MapDateRange; label: string }>).map(({ key, label }) => (
          <button
            key={`map-range-${key}`}
            type="button"
            onClick={() => onSetMapDateRange(key)}
            style={{
              borderRadius: 999,
              border: `1px solid ${mapDateRange === key ? "rgba(255,77,77,0.8)" : "rgba(255,255,255,0.2)"}`,
              background: mapDateRange === key ? "rgba(255,0,0,0.16)" : "rgba(0,0,0,0.35)",
              color: mapDateRange === key ? "#ff5a5a" : "rgba(255,255,255,0.82)",
              padding: "6px 11px",
              cursor: "pointer",
              fontSize: 11,
              letterSpacing: "0.03em",
              textTransform: "uppercase",
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${worldMap.width} ${worldMap.height}`}
        role="img"
        aria-label="World map of visitor geolocation points"
        style={{
          width: "100%",
          height: "auto",
          borderRadius: 10,
          background: "radial-gradient(circle at 20% 10%, rgba(95,193,255,0.2), rgba(7,16,25,0.96))",
        }}
      >
        <defs>
          <linearGradient id="map-grid" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.12)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.04)" />
          </linearGradient>
        </defs>
        {worldMap.parallels.map((y) => (
          <line key={`parallel-${y.toFixed(2)}`} x1="0" y1={String(y)} x2={String(worldMap.width)} y2={String(y)} stroke="url(#map-grid)" strokeWidth="1" />
        ))}
        {worldMap.meridians.map((x) => (
          <line key={`meridian-${x.toFixed(2)}`} x1={String(x)} y1="0" x2={String(x)} y2={String(worldMap.height)} stroke="url(#map-grid)" strokeWidth="1" />
        ))}
        {worldMap.countries.map((country) => (
          <path
            key={`country-${country.renderKey}`}
            d={country.path}
            fill={worldMap.getCountryFill(country.id)}
            stroke="rgba(255,255,255,0.34)"
            strokeWidth="0.85"
            strokeLinejoin="round"
            strokeLinecap="round"
          >
            <title>{`${country.name}: ${worldMap.countryVisitorCount.get(country.id) ?? 0} visitors`}</title>
          </path>
        ))}
      </svg>
      <div className="statusMetrics">
        <div><strong>Tracked Visitors</strong><p>{filteredWorldMapVisitorsCount}</p></div>
        <div><strong>Regions With Traffic</strong><p>{Array.from(worldMap.countryVisitorCount.values()).filter((count) => count > 0).length}</p></div>
        <div><strong>Max Visitors / Region</strong><p>{worldMap.maxCountryVisitors}</p></div>
      </div>
    </div>
  );
}
