import MobileHomePageClient from "./home-client";
import { fetchChatMessages } from "@/lib/chat-data";
import type { MappedChatMessage } from "@/lib/chat-data";

/** Adapt a server-fetched MappedChatMessage to the shape the client expects. */
function toClientMessage(msg: MappedChatMessage) {
  return {
    id: msg.id,
    content: msg.content,
    createdAt: msg.createdAt,
    user: {
      id: msg.user.id,
      name: msg.user.name,
      avatarUrl: msg.user.avatarUrl,
    },
  };
}

export default async function MobileHomePage() {
  let initialChatMessages: ReturnType<typeof toClientMessage>[] | undefined;

  try {
    const messages = await fetchChatMessages("global", undefined);
    if (messages.length > 0) {
      initialChatMessages = messages.map(toClientMessage);
    }
  } catch {
    // Preload is best-effort; client will fetch on mount if this fails
  }

  return <MobileHomePageClient initialChatMessages={initialChatMessages} />;
}
