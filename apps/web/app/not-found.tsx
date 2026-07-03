import Link from "next/link";

export default function NotFound() {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0a0a0a", color: "#e8e8e8", fontFamily: "system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100dvh" }}>
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <h1 style={{ fontSize: "3rem", color: "#ff7722", margin: "0 0 0.5rem" }}>404</h1>
          <p style={{ fontSize: "1.1rem", color: "#999", margin: "0 0 1.5rem" }}>Page not found</p>
          <Link href="/" style={{ color: "#ff7722", textDecoration: "underline" }}>Back to home</Link>
        </div>
      </body>
    </html>
  );
}
