/**
 * Admin Dashboard Shared UI Components
 * Reusable UI primitives used across tabs
 */

export function Dial({
  label,
  value,
  color,
  detail,
}: {
  label: string;
  value: number | null;
  color: string;
  detail?: string | null;
}) {
  const radius = 34;
  const stroke = 8;
  const size = 90;
  const circumference = 2 * Math.PI * radius;
  const safeValue = value === null ? 0 : Math.max(0, Math.min(100, value));
  const offset = circumference * (1 - safeValue / 100);
  const dialWidthPx = 132;

  return (
    <div style={{ display: "grid", justifyItems: "center", gap: 6, width: dialWidthPx, minWidth: dialWidthPx }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${label} ${value === null ? "n/a" : `${Math.round(safeValue)} percent`}`}
      >
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.14)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          x="50%"
          y="50%"
          dominantBaseline="middle"
          textAnchor="middle"
          fill="#fff"
          style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}
        >
          {value === null ? "n/a" : `${Math.round(safeValue)}%`}
        </text>
      </svg>
      <span className="authMessage" style={{ margin: 0 }}>
        {label}
      </span>
      {detail ? (
        <span className="authMessage" style={{ margin: 0, width: "100%", textAlign: "center", whiteSpace: "pre-line", fontVariantNumeric: "tabular-nums" }}>
          {detail}
        </span>
      ) : null}
    </div>
  );
}
