import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { generateMetadata } from "@/app/(shell)/page";
import { getCurrentVideo } from "@/lib/catalog-data";

// Deterministic origin for the generated card URL builder.
process.env.NEXT_PUBLIC_SITE_ORIGIN = "https://yehthatrocks.com";

vi.mock("next/headers", () => ({
  headers: () => new Headers({ host: "yehthatrocks.com" }),
}));

vi.mock("@/lib/catalog-data", () => ({
  getCurrentVideo: vi.fn(),
}));

const getCurrentVideoMock = getCurrentVideo as unknown as Mock;

function resolvedVideo(id: string) {
  return {
    id,
    title: "Test Track",
    channelTitle: "Test Channel",
    parsedArtist: "Test Artist",
    parsedTrack: "Test Track",
    genre: "Metal",
    description: "A test video",
    favourited: 5,
  };
}

describe("homepage generateMetadata (social share contract)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the real YouTube thumbnail when a ?v= video resolves", async () => {
    getCurrentVideoMock.mockResolvedValue(resolvedVideo("VIDEO123"));

    const meta = await generateMetadata({ searchParams: Promise.resolve({ v: "VIDEO123" }) });

    expect(meta.title).toBe("Test Track | YehThatRocks");
    expect(meta.openGraph?.url).toBe("https://yehthatrocks.com/?v=VIDEO123");
    expect(meta.openGraph?.images).toEqual([
      { url: "https://i.ytimg.com/vi/VIDEO123/hqdefault.jpg", width: 480, height: 360, alt: "Test Track" },
      { url: "https://i.ytimg.com/vi/VIDEO123/maxresdefault.jpg", width: 1280, height: 720, alt: "Test Track" },
    ]);
    expect(meta.twitter?.images).toEqual([
      "https://i.ytimg.com/vi/VIDEO123/hqdefault.jpg",
      "https://i.ytimg.com/vi/VIDEO123/maxresdefault.jpg",
    ]);
  });

  it("never points a ?v= share at the generated /og card", async () => {
    getCurrentVideoMock.mockResolvedValue(resolvedVideo("VIDEO123"));

    const meta = await generateMetadata({ searchParams: Promise.resolve({ v: "VIDEO123" }) });

    const imageUrls = (meta.openGraph?.images ?? [])
      .map((image) => (typeof image === "string" ? image : image.url))
      .filter((url): url is string => Boolean(url));
    expect(imageUrls.length).toBeGreaterThan(0);
    for (const url of imageUrls) {
      expect(url).not.toContain("/og");
      expect(url).toContain("i.ytimg.com/vi/VIDEO123");
    }
  });

  it("uses the generated home card for the base URL (no ?v=)", async () => {
    getCurrentVideoMock.mockResolvedValue(null);

    const meta = await generateMetadata({ searchParams: Promise.resolve({}) });

    expect(meta.openGraph?.type).toBe("website");
    expect(meta.openGraph?.images).toEqual([
      {
        url: "https://yehthatrocks.com/og?type=home",
        width: 1200,
        height: 630,
        alt: "YehThatRocks — Rock & Metal Music Videos",
      },
    ]);
    expect(meta.twitter?.images).toEqual(["https://yehthatrocks.com/og?type=home"]);
  });

  it("falls back to the generated home card when the ?v= id is unknown", async () => {
    getCurrentVideoMock.mockResolvedValue(null);

    const meta = await generateMetadata({ searchParams: Promise.resolve({ v: "UNKNOWN_ID" }) });

    const firstImage = meta.openGraph?.images?.[0];
    expect(firstImage && typeof firstImage !== "string" ? firstImage.url : firstImage).toBe(
      "https://yehthatrocks.com/og?type=home",
    );
  });
});
