export default function DesktopOnlyPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "2rem 1.25rem",
        background:
          "radial-gradient(circle at top, rgba(255, 119, 51, 0.22), transparent 48%), linear-gradient(180deg, #151515 0%, #050505 100%)",
        color: "#f2f2f2",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: "42rem",
          border: "1px solid rgba(255, 122, 44, 0.45)",
          borderRadius: "14px",
          padding: "1.5rem",
          background: "rgba(12, 12, 12, 0.9)",
          boxShadow: "0 18px 45px rgba(0, 0, 0, 0.5)",
        }}
      >
        <p style={{ margin: 0, letterSpacing: "0.08em", fontSize: "0.84rem", opacity: 0.92 }}>
          YEH THAT ROCKS
        </p>
        <h1
          style={{
            margin: "0.7rem 0 0",
            fontSize: "clamp(1.6rem, 8vw, 3.1rem)",
            lineHeight: 1.06,
            whiteSpace: "nowrap",
          }}
        >
          Put the toy down.
        </h1>
        <p style={{ margin: "0.8rem 0 0", fontSize: "1.08rem", lineHeight: 1.55, opacity: 0.96 }}>
          This place is built for a real computer. If you are on a phone or tablet, come back on desktop or laptop.
        </p>
        <p style={{ margin: "0.8rem 0 0", fontSize: "1.02rem", lineHeight: 1.55, opacity: 0.9 }}>
          Heavy riffs deserve heavy hardware.
        </p>
      </section>
    </main>
  );
}
