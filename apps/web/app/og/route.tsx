import { ImageResponse } from "next/og";

export const runtime = "edge";

const WIDTH = 1200;
const HEIGHT = 630;

const BG = "#1a1a2e";
const ACCENT = "#e67e22";
const TEXT = "#f5f5f5";
const MUTED = "#a0a0b0";

const BRAND = "YehThatRocks";

function OgVideo({
  artist,
  title,
  genre,
}: {
  artist: string;
  title: string;
  genre: string;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "flex-start",
        padding: "64px 80px",
        backgroundColor: BG,
        backgroundImage:
          "radial-gradient(ellipse at 80% 20%, rgba(230,126,34,0.12) 0%, transparent 50%), radial-gradient(ellipse at 20% 80%, rgba(230,126,34,0.06) 0%, transparent 50%)",
        color: TEXT,
        fontFamily: "sans-serif",
        position: "relative",
      }}
    >
      {/* Top accent bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "6px",
          backgroundColor: ACCENT,
        }}
      />

      {/* Genre pill */}
      {genre && (
        <div
          style={{
            display: "flex",
            padding: "8px 24px",
            backgroundColor: "rgba(230,126,34,0.15)",
            border: `1px solid ${ACCENT}`,
            borderRadius: "999px",
            color: ACCENT,
            fontSize: "20px",
            fontWeight: 600,
            marginBottom: "32px",
          }}
        >
          {genre}
        </div>
      )}

      {/* Main text */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          fontSize: "64px",
          fontWeight: 700,
          lineHeight: 1.15,
          maxWidth: "900px",
        }}
      >
        <span style={{ color: ACCENT }}>{artist}</span>
        <span style={{ color: TEXT, marginTop: "8px" }}>{title}</span>
      </div>

      {/* CTA */}
      <div
        style={{
          marginTop: "48px",
          fontSize: "26px",
          color: MUTED,
          fontWeight: 500,
        }}
      >
        Watch on {BRAND}
      </div>

      {/* Bottom-right branding */}
      <div
        style={{
          position: "absolute",
          bottom: "40px",
          right: "60px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          fontSize: "28px",
          fontWeight: 700,
          color: ACCENT,
        }}
      >
        <span
          style={{
            display: "flex",
            width: "36px",
            height: "36px",
            backgroundColor: ACCENT,
            borderRadius: "6px",
          }}
        />
        {BRAND}
      </div>
    </div>
  );
}

function OgArtist({ name, genre }: { name: string; genre: string }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "flex-start",
        padding: "64px 80px",
        backgroundColor: BG,
        backgroundImage:
          "radial-gradient(ellipse at 70% 30%, rgba(230,126,34,0.10) 0%, transparent 50%), radial-gradient(ellipse at 30% 70%, rgba(230,126,34,0.05) 0%, transparent 50%)",
        color: TEXT,
        fontFamily: "sans-serif",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "6px",
          backgroundColor: ACCENT,
        }}
      />

      {genre && (
        <div
          style={{
            display: "flex",
            padding: "8px 24px",
            backgroundColor: "rgba(230,126,34,0.15)",
            border: `1px solid ${ACCENT}`,
            borderRadius: "999px",
            color: ACCENT,
            fontSize: "20px",
            fontWeight: 600,
            marginBottom: "32px",
          }}
        >
          {genre}
        </div>
      )}

      <div
        style={{
          display: "flex",
          fontSize: "72px",
          fontWeight: 700,
          lineHeight: 1.1,
          color: ACCENT,
          maxWidth: "950px",
        }}
      >
        {name}
      </div>

      <div
        style={{
          marginTop: "32px",
          fontSize: "26px",
          color: MUTED,
          fontWeight: 500,
        }}
      >
        Watch music videos on {BRAND}
      </div>

      <div
        style={{
          position: "absolute",
          bottom: "40px",
          right: "60px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          fontSize: "28px",
          fontWeight: 700,
          color: ACCENT,
        }}
      >
        <span
          style={{
            display: "flex",
            width: "36px",
            height: "36px",
            backgroundColor: ACCENT,
            borderRadius: "6px",
          }}
        />
        {BRAND}
      </div>
    </div>
  );
}

function OgMagazine({
  title,
  kicker,
}: {
  title: string;
  kicker: string;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "flex-start",
        padding: "64px 80px",
        backgroundColor: BG,
        backgroundImage:
          "radial-gradient(ellipse at 60% 40%, rgba(230,126,34,0.08) 0%, transparent 50%)",
        color: TEXT,
        fontFamily: "sans-serif",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "6px",
          backgroundColor: ACCENT,
        }}
      />

      {/* Kicker */}
      {kicker && (
        <div
          style={{
            display: "flex",
            padding: "8px 24px",
            backgroundColor: "rgba(230,126,34,0.15)",
            border: `1px solid ${ACCENT}`,
            borderRadius: "999px",
            color: ACCENT,
            fontSize: "20px",
            fontWeight: 600,
            marginBottom: "32px",
          }}
        >
          {kicker}
        </div>
      )}

      {/* Magazine label */}
      <div
        style={{
          fontSize: "22px",
          fontWeight: 600,
          color: MUTED,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          marginBottom: "20px",
        }}
      >
        Yeh Magazine
      </div>

      {/* Title */}
      <div
        style={{
          display: "flex",
          fontSize: "58px",
          fontWeight: 700,
          lineHeight: 1.15,
          color: TEXT,
          maxWidth: "900px",
        }}
      >
        {title}
      </div>

      <div
        style={{
          position: "absolute",
          bottom: "40px",
          right: "60px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          fontSize: "28px",
          fontWeight: 700,
          color: ACCENT,
        }}
      >
        <span
          style={{
            display: "flex",
            width: "36px",
            height: "36px",
            backgroundColor: ACCENT,
            borderRadius: "6px",
          }}
        />
        {BRAND}
      </div>
    </div>
  );
}

function OgGenre({ name }: { name: string }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: "64px 80px",
        backgroundColor: BG,
        backgroundImage:
          "radial-gradient(ellipse at 50% 40%, rgba(230,126,34,0.12) 0%, transparent 50%), radial-gradient(ellipse at 50% 70%, rgba(230,126,34,0.05) 0%, transparent 50%)",
        color: TEXT,
        fontFamily: "sans-serif",
        position: "relative",
        textAlign: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "6px",
          backgroundColor: ACCENT,
        }}
      />

      <div
        style={{
          display: "flex",
          fontSize: "68px",
          fontWeight: 700,
          lineHeight: 1.1,
          color: ACCENT,
          maxWidth: "950px",
        }}
      >
        {name}
      </div>

      <div
        style={{
          marginTop: "28px",
          fontSize: "30px",
          color: MUTED,
          fontWeight: 500,
        }}
      >
        Best Rock &amp; Metal
      </div>

      <div
        style={{
          position: "absolute",
          bottom: "40px",
          right: "60px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          fontSize: "28px",
          fontWeight: 700,
          color: ACCENT,
        }}
      >
        <span
          style={{
            display: "flex",
            width: "36px",
            height: "36px",
            backgroundColor: ACCENT,
            borderRadius: "6px",
          }}
        />
        {BRAND}
      </div>
    </div>
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "video";

  const headers = new Headers({
    "Cache-Control": "public, max-age=604800, immutable",
    "Content-Type": "image/png",
  });

  const commonOptions = {
    width: WIDTH,
    height: HEIGHT,
    headers,
  };

  switch (type) {
    case "artist": {
      const name = searchParams.get("name") || "Artist";
      const genre = searchParams.get("genre") || "";
      return new ImageResponse(
        <OgArtist name={name} genre={genre} />,
        commonOptions,
      );
    }

    case "magazine": {
      const title = searchParams.get("title") || "Article";
      const kicker = searchParams.get("kicker") || "";
      return new ImageResponse(
        <OgMagazine title={title} kicker={kicker} />,
        commonOptions,
      );
    }

    case "genre": {
      const name = searchParams.get("name") || "Genre";
      return new ImageResponse(<OgGenre name={name} />, commonOptions);
    }

    case "video":
    default: {
      const artist = searchParams.get("artist") || "Artist";
      const title = searchParams.get("title") || "Track";
      const genre = searchParams.get("genre") || "";
      return new ImageResponse(
        <OgVideo artist={artist} title={title} genre={genre} />,
        commonOptions,
      );
    }
  }
}
