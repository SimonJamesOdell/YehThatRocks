"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { parseSharedVideoMessage, parseActivityMessage } from "@/lib/chat-shared-video";
import { useMobilePlayer } from "@/components/mobile/mobile-player-context";
import { formatChatTimestamp } from "@/components/shell-dynamic-utils";
import { getArtistPagePath } from "@/lib/artist-routing";

type Tab = "chat" | "magazine" | "forum";
const MAX_CHAT_LENGTH = 200;

type ChatUser = {
  id: number | null;
  name: string;
  avatarUrl: string | null;
};

type ChatMessage = {
  id: number;
  content: string;
  createdAt: string | null;
  user: ChatUser;
};

type SharedVideo = {
  videoId: string;
  title?: string;
  channelTitle?: string;
};

type MagazineArticle = {
  slug: string;
  videoId: string | null;
  title: string;
  artist: string;
  kicker: string;
  genre: string;
};

type ForumSection = {
  id: string;
  title: string;
  description: string;
  threadCount: number;
  newThreads: number;
  updatedThreads: number;
};

type MobileHomePageClientProps = {
  /** Chat messages preloaded server-side for the initial render. */
  initialChatMessages?: ChatMessage[];
};

const VALID_TABS: Tab[] = ["chat", "magazine", "forum"];

function parseInitialTab(param: string | null): Tab {
  if (param && VALID_TABS.includes(param as Tab)) {
    return param as Tab;
  }
  return "chat";
}

const MAGAZINE_CACHE_KEY = "mobile-magazine-cache";

type MagazineCache = {
  articles: MagazineArticle[];
  hasMore: boolean;
  offset: number;
};

function readMagazineCache(): MagazineCache | null {
  try {
    const raw = sessionStorage.getItem(MAGAZINE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MagazineCache;
    if (Array.isArray(parsed.articles) && typeof parsed.hasMore === "boolean" && typeof parsed.offset === "number") {
      return parsed;
    }
  } catch { /* ignore */ }
  return null;
}

function writeMagazineCache(articles: MagazineArticle[], hasMore: boolean, offset: number) {
  try {
    sessionStorage.setItem(MAGAZINE_CACHE_KEY, JSON.stringify({ articles, hasMore, offset }));
  } catch { /* quota */ }
}

export default function MobileHomePageClient({ initialChatMessages }: MobileHomePageClientProps) {
  const searchParams = useSearchParams();
  const initialTab = parseInitialTab(searchParams.get("tab"));
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const { auth, playVideo } = useMobilePlayer();
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);

  // Tab content state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(initialChatMessages ?? []);
  const [chatLoading, setChatLoading] = useState(!initialChatMessages);
  const [videoPreviews, setVideoPreviews] = useState<Record<string, { parsedArtist?: string | null; parsedTrack?: string | null; genre?: string | null }>>({});
  const [magazineArticles, setMagazineArticles] = useState<MagazineArticle[]>([]);
  const [magazineLoading, setMagazineLoading] = useState(false);
  const [magazineHasMore, setMagazineHasMore] = useState(true);
  const [magazineLoadingMore, setMagazineLoadingMore] = useState(false);
  const magazineOffsetRef = useRef(0);

  // Restore magazine cache from sessionStorage after hydration (client-only).
  // useLayoutEffect fires synchronously before any useEffect, so the tab-switch
  // effect sees the restored articles and skips the unnecessary fetch.
  const magazineCacheRestoredRef = useRef(false);
  useLayoutEffect(() => {
    if (magazineCacheRestoredRef.current) return;
    const cache = readMagazineCache();
    if (cache && cache.articles.length > 0) {
      setMagazineArticles(cache.articles);
      setMagazineHasMore(cache.hasMore);
      magazineOffsetRef.current = cache.offset;
    }
    magazineCacheRestoredRef.current = true;
  }, []);
  const [forumSections, setForumSections] = useState<ForumSection[]>([]);
  const [forumLoading, setForumLoading] = useState(false);
  const chatListRef = useRef<HTMLDivElement>(null);
  const magazineListRef = useRef<HTMLDivElement>(null);
  const magazineSentinelRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  // Track whether initial data was provided — skip first fetch if so
  const hasInitialChat = useRef(initialChatMessages && initialChatMessages.length > 0);

  // Auto-scroll chat to bottom when messages change (only if user is near bottom)
  useEffect(() => {
    const el = chatListRef.current;
    if (!el || !isNearBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [chatMessages]);

  // Track whether user is near bottom of chat
  const handleChatScroll = useCallback(() => {
    const el = chatListRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  // Fetch chat messages (also called after sending)
  const loadChat = useCallback(async () => {
    // Force scroll-to-bottom on manual reload (e.g. after sending)
    isNearBottomRef.current = true;
    setChatLoading(true);
    try {
      const res = await fetch("/api/chat?mode=global");
      if (res.ok) {
        const data = await res.json();
        setChatMessages(data.messages || []);
      }
    } catch { /* silent */ }
    finally { setChatLoading(false); }
  }, []);

  // Send chat message
  const sendChat = useCallback(async () => {
    const trimmed = chatInput.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_CHAT_LENGTH || chatSending) return;
    setChatSending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "global", content: trimmed }),
      });
      if (res.ok) {
        setChatInput("");
        // Reload messages so the new one appears
        await loadChat();
      }
    } catch { /* silent */ }
    finally { setChatSending(false); }
  }, [chatInput, chatSending, loadChat]);

  const handleChatKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  }, [sendChat]);

  // Fetch magazine articles (initial load)
  const loadMagazine = useCallback(async () => {
    setMagazineLoading(true);
    magazineOffsetRef.current = 0;
    try {
      const res = await fetch("/api/magazine/latest?limit=8&offset=0");
      if (res.ok) {
        const data = await res.json();
        setMagazineArticles(data.articles || []);
        setMagazineHasMore(data.hasMore ?? true);
        magazineOffsetRef.current = (data.articles || []).length;
      }
    } catch { /* silent */ }
    finally { setMagazineLoading(false); }
  }, []);

  // Load more magazine articles (infinite scroll)
  const loadMoreMagazine = useCallback(async () => {
    if (!magazineHasMore || magazineLoadingMore) return;
    setMagazineLoadingMore(true);
    try {
      const offset = magazineOffsetRef.current;
      const res = await fetch(`/api/magazine/latest?limit=8&offset=${offset}`);
      if (res.ok) {
        const data = await res.json();
        const newArticles: MagazineArticle[] = data.articles || [];
        if (newArticles.length > 0) {
          setMagazineArticles((prev) => {
            const existingSlugs = new Set(prev.map((a) => a.slug));
            const deduped = newArticles.filter((a) => !existingSlugs.has(a.slug));
            magazineOffsetRef.current = offset + deduped.length;
            return [...prev, ...deduped];
          });
        }
        setMagazineHasMore(data.hasMore ?? false);
      }
    } catch { /* silent */ }
    finally { setMagazineLoadingMore(false); }
  }, [magazineHasMore, magazineLoadingMore]);

  // Fetch forum sections
  const loadForum = useCallback(async () => {
    setForumLoading(true);
    try {
      const res = await fetch("/api/forum/sections");
      if (res.ok) {
        const data = await res.json();
        setForumSections(data.sections || []);
      }
    } catch { /* silent */ }
    finally { setForumLoading(false); }
  }, []);

  // Resolve video previews — use batch endpoint instead of N individual fetches
  useEffect(() => {
    const ids = new Set<string>();
    for (const msg of chatMessages) {
      const shared = parseSharedVideoMessage(msg.content);
      const activity = parseActivityMessage(msg.content);
      const videoId = shared?.videoId || (activity?.videoId && activity.action !== "online" && activity.action !== "offline" ? activity.videoId : null);
      if (videoId && !videoPreviews[videoId]) {
        ids.add(videoId);
      }
    }
    if (ids.size === 0) return;

    const idList = Array.from(ids);
    const fetchBatch = async () => {
      try {
        const res = await fetch(`/api/videos/share-previews?ids=${idList.map(encodeURIComponent).join(",")}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.videos) {
          setVideoPreviews((prev) => {
            const next = { ...prev };
            for (const [videoId, preview] of Object.entries(data.videos as Record<string, { parsedArtist?: string | null; parsedTrack?: string | null; genre?: string | null } | null>)) {
              if (preview) {
                next[videoId] = preview;
              }
            }
            return next;
          });
        }
      } catch { /* silent */ }
    };
    fetchBatch();
  }, [chatMessages, videoPreviews]);

  // Load tab content when tab changes
  useEffect(() => {
    switch (activeTab) {
      case "chat":
        if (!hasInitialChat.current && chatMessages.length === 0) loadChat();
        break;
      case "magazine":
        if (magazineArticles.length === 0) {
          magazineOffsetRef.current = 0;
          loadMagazine();
        }
        break;
      case "forum":
        if (forumSections.length === 0) loadForum();
        break;
    }
  }, [activeTab, chatMessages.length, magazineArticles.length, forumSections.length, loadChat, loadMagazine, loadForum]);

  // Preserve / restore page scroll position when viewing magazine tab
  const MAGAZINE_SCROLL_KEY = "mobile-magazine-scroll";

  // Save window scroll position on scroll (only when magazine tab is active)
  useEffect(() => {
    if (activeTab !== "magazine") return;
    const onScroll = () => {
      try { sessionStorage.setItem(MAGAZINE_SCROLL_KEY, String(window.scrollY)); } catch { /* quota */ }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [activeTab]);

  // Restore window scroll position after magazine articles load
  useEffect(() => {
    if (activeTab !== "magazine" || magazineLoading || magazineArticles.length === 0) return;
    try {
      const saved = sessionStorage.getItem(MAGAZINE_SCROLL_KEY);
      if (saved) {
        const y = parseInt(saved, 10);
        if (!isNaN(y) && y > 0) {
          // Use a short timeout so the browser finishes laying out the
          // restored article list before we try to scroll.
          const id = setTimeout(() => window.scrollTo(0, y), 0);
          return () => clearTimeout(id);
        }
      }
    } catch { /* ignore */ }
  }, [activeTab, magazineLoading, magazineArticles.length]);

  // Persist magazine articles to sessionStorage so back-navigation restores them
  useEffect(() => {
    if (magazineArticles.length > 0) {
      writeMagazineCache(magazineArticles, magazineHasMore, magazineOffsetRef.current);
    }
  }, [magazineArticles, magazineHasMore]);

  // IntersectionObserver for magazine infinite scroll
  const magazineObserverPrimedRef = useRef(false);

  useEffect(() => {
    if (activeTab !== "magazine" || !magazineHasMore || magazineLoading) return;

    const sentinel = magazineSentinelRef.current;
    if (!sentinel) return;

    // Reset the priming flag when the observer is re-created
    magazineObserverPrimedRef.current = false;

    const observer = new IntersectionObserver(
      (entries) => {
        // Skip the initial callback that fires on observe —
        // the sentinel is often already in view when first rendered.
        if (!magazineObserverPrimedRef.current) {
          magazineObserverPrimedRef.current = true;
          return;
        }
        if (entries[0]?.isIntersecting) {
          void loadMoreMagazine();
        }
      },
      { rootMargin: "200px 0px" },
    );

    observer.observe(sentinel);
    return () => {
      observer.disconnect();
    };
  }, [activeTab, magazineHasMore, magazineLoading, loadMoreMagazine]);

  const tabs: { key: Tab; label: string }[] = [
    { key: "chat", label: "Chat" },
    { key: "magazine", label: "Magazine" },
    { key: "forum", label: "Forum" },
  ];

  function renderChatContent(msg: ChatMessage) {
    const activity = parseActivityMessage(msg.content);
    const sharedVideo: SharedVideo | null = activity ? null : parseSharedVideoMessage(msg.content);
    const rawVideoId = activity?.videoId || sharedVideo?.videoId;
    const rawChannel = activity?.channelTitle || sharedVideo?.channelTitle;
    const rawTitle = activity?.title || sharedVideo?.title || "Shared video";
    const preview = rawVideoId ? videoPreviews[rawVideoId] : undefined;
    const artist = preview?.parsedArtist || rawChannel || null;
    const track = preview?.parsedTrack || rawTitle;
    const genre = preview?.genre || null;
    const artistPath = artist ? getArtistPagePath(artist) : null;

    // Activity messages
    if (activity) {
      const label =
        activity.action === "online" ? "joined the chat"
        : activity.action === "offline" ? "exited the chat"
        : activity.action === "favourited" ? "favourited"
        : "is now playing";

      return (
        <div key={msg.id} className="mobile-chat-activity">
          <span className="mobile-chat-activity-label">{label}</span>
          {activity.videoId && (
            <div className="mobile-chat-shared-video">
              <button
                type="button"
                className="mobile-chat-shared-video-main"
                onClick={() => playVideo({
                  id: activity.videoId!,
                  title: track,
                  channelTitle: artist || "",
                  genre: "",
                  favourited: 0,
                })}
              >
                <img
                  src={`https://i.ytimg.com/vi/${encodeURIComponent(activity.videoId)}/mqdefault.jpg`}
                  alt=""
                  className="mobile-chat-shared-thumb"
                  loading="lazy"
                />
                <div className="mobile-chat-shared-info">
                  {genre && (
                    <div className="mobile-chat-shared-genre">{genre}</div>
                  )}
                  {artistPath ? (
                    <Link
                      href={`/m${artistPath}`}
                      className="mobile-chat-shared-artist"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {artist}
                    </Link>
                  ) : artist ? (
                    <span className="mobile-chat-shared-artist">{artist}</span>
                  ) : null}
                  {artist && <span className="mobile-chat-shared-sep"> — </span>}
                  <span className="mobile-chat-shared-track">{track}</span>
                </div>
              </button>
            </div>
          )}
        </div>
      );
    }

    // Shared video messages
    if (sharedVideo) {
      return (
        <div key={msg.id} className="mobile-chat-shared-video">
          <button
            type="button"
            className="mobile-chat-shared-video-main"
            onClick={() => playVideo({
              id: sharedVideo.videoId,
              title: track,
              channelTitle: artist || "",
              genre: genre || "",
              favourited: 0,
            })}
          >
            <img
              src={`https://i.ytimg.com/vi/${encodeURIComponent(sharedVideo.videoId)}/mqdefault.jpg`}
              alt=""
              className="mobile-chat-shared-thumb"
              loading="lazy"
            />
            <div className="mobile-chat-shared-info">
              {genre && (
                <div className="mobile-chat-shared-genre">{genre}</div>
              )}
              {artistPath ? (
                <Link
                  href={`/m${artistPath}`}
                  className="mobile-chat-shared-artist"
                  onClick={(e) => e.stopPropagation()}
                >
                  {artist}
                </Link>
              ) : artist ? (
                <span className="mobile-chat-shared-artist">{artist}</span>
              ) : null}
              {artist && <span className="mobile-chat-shared-sep"> — </span>}
              <span className="mobile-chat-shared-track">{track}</span>
            </div>
          </button>
        </div>
      );
    }

    // Plain text
    return <span className="mobile-chat-text">{msg.content}</span>;
  }

  return (
    <div className="mobile-home-page">
      <div className="mobile-page-header">
        <h1 className="mobile-page-title">Home</h1>
      </div>

      {/* Tab buttons */}
      <div className="mobile-home-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`mobile-home-tab ${activeTab === tab.key ? "mobile-home-tab-active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="mobile-home-tab-content">
        {activeTab === "chat" && (
          <div className="mobile-chat-panel">
          <div className="mobile-chat-list" ref={chatListRef} onScroll={handleChatScroll}>
            {chatLoading ? (
              <div className="mobile-loading"><span className="playerBootBars" aria-hidden="true"><span /><span /><span /><span /><span /></span></div>
            ) : chatMessages.length === 0 ? (
              <p className="mobile-empty-state">No chat messages yet. Start the noise.</p>
            ) : (
              chatMessages.slice(-30).map((msg) => {
                const activity = parseActivityMessage(msg.content);
                if (activity && (activity.action === "online" || activity.action === "offline")) {
                  return null;
                }
                return (
                  <div key={msg.id} className="mobile-chat-message">
                    {msg.user.avatarUrl ? (
                      <img
                        src={msg.user.avatarUrl}
                        alt=""
                        className="mobile-chat-avatar"
                        loading="lazy"
                      />
                    ) : (
                      <div className="mobile-chat-avatar-fallback">{msg.user.name.slice(0, 1)}</div>
                    )}
                    <div className="mobile-chat-body">
                      <span className="mobile-chat-user">
                        {msg.user.name}
                        <span className="mobile-chat-time">{formatChatTimestamp(msg.createdAt)}</span>
                      </span>
                      {renderChatContent(msg)}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Chat input */}
          <div className="mobile-chat-input-wrap">
            {auth.checked && auth.isLoggedIn ? (
              <>
                <input
                  type="text"
                  className="mobile-chat-input"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value.slice(0, MAX_CHAT_LENGTH))}
                  onKeyDown={handleChatKeyDown}
                  placeholder="Type a message..."
                  maxLength={MAX_CHAT_LENGTH}
                  disabled={chatSending}
                />
                <button
                  type="button"
                  className="mobile-chat-send"
                  onClick={sendChat}
                  disabled={chatInput.trim().length === 0 || chatSending}
                >
                  {chatSending ? "..." : "Send"}
                </button>
              </>
            ) : auth.checked ? (
              <Link href="/m/login" className="mobile-chat-login-button">
                Log in to chat
              </Link>
            ) : null}
          </div>
          </div>
        )}

        {activeTab === "magazine" && (
          <div className="mobile-magazine-list" ref={magazineListRef}>
            {(magazineLoading || magazineArticles.length === 0) ? (
              <div className="mobile-loading"><span className="playerBootBars" aria-hidden="true"><span /><span /><span /><span /><span /></span></div>
            ) : (
              magazineArticles.map((article) => (
                <a
                  key={article.slug}
                  href={`/m/magazine/${encodeURIComponent(article.slug)}`}
                  className="mobile-magazine-card"
                >
                  {article.videoId && (
                    <img
                      src={`https://i.ytimg.com/vi/${encodeURIComponent(article.videoId)}/mqdefault.jpg`}
                      alt=""
                      className="mobile-magazine-card-thumb"
                      loading="lazy"
                    />
                  )}
                  <div className="mobile-magazine-card-body">
                    <div className="mobile-magazine-card-kicker">{article.kicker || article.genre}</div>
                    <div className="mobile-magazine-card-title">{article.title}</div>
                  </div>
                </a>
              ))
            )}
            {magazineHasMore && !magazineLoading && (
              <div ref={magazineSentinelRef} style={{ height: 1, width: "100%" }} />
            )}
            {magazineLoadingMore && (
              <div className="mobile-loading" style={{ padding: "16px 0" }}>
                <span className="playerBootBars" aria-hidden="true"><span /><span /><span /><span /><span /></span>
              </div>
            )}
          </div>
        )}

        {activeTab === "forum" && (
          <div className="mobile-forum-list">
            {forumLoading ? (
              <div className="mobile-loading"><span className="playerBootBars" aria-hidden="true"><span /><span /><span /><span /><span /></span></div>
            ) : forumSections.length === 0 ? (
              <p className="mobile-empty-state">No forum sections available.</p>
            ) : (
              forumSections.map((section) => (
                <a
                  key={section.id}
                  href={`/forum?section=${encodeURIComponent(section.id)}`}
                  className="mobile-forum-card"
                >
                  <div className="mobile-forum-card-title">{section.title}</div>
                  <div className="mobile-forum-card-desc">{section.description}</div>
                  <div className="mobile-forum-card-meta">
                    {section.threadCount} threads
                    {section.newThreads > 0 && ` · ${section.newThreads} new`}
                  </div>
                </a>
              ))
            )}
          </div>
        )}
      </div>

    </div>
  );
}
