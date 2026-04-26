import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { VideoRecord } from "@/lib/catalog";
import { EVENT_NAMES } from "@/lib/events-contract";
import { useTemporaryQueueController } from "@/components/use-temporary-queue-controller";

function createVideo(id: string): VideoRecord {
  return {
    id,
    title: `title-${id}`,
    channelTitle: "channel",
    genre: "genre",
    favourited: 0,
    description: "desc",
  };
}

function QueueHarness({ currentVideoId }: { currentVideoId: string }) {
  const {
    temporaryQueueVideos,
    mutateTemporaryQueue,
    handleAddToTemporaryQueue,
  } = useTemporaryQueueController(currentVideoId);

  return React.createElement(
    "div",
    null,
    React.createElement("button", { type: "button", onClick: () => handleAddToTemporaryQueue(createVideo("v1")) }, "add-v1"),
    React.createElement("button", { type: "button", onClick: () => handleAddToTemporaryQueue(createVideo("v2")) }, "add-v2"),
    React.createElement("button", {
      type: "button",
      onClick: () => mutateTemporaryQueue({ type: "remove", videoId: "v2", reason: "transition-sync" }),
    }, "remove-v2-transition-sync"),
    React.createElement("div", { "data-testid": "queue-ids" }, temporaryQueueVideos.map((video) => video.id).join(",")),
    React.createElement("div", { "data-testid": "queue-count" }, String(temporaryQueueVideos.length)),
  );
}

describe("useTemporaryQueueController (component behavior)", () => {
  it("does not add duplicate queue entries", () => {
    render(React.createElement(QueueHarness, { currentVideoId: "v0" }));

    fireEvent.click(screen.getByRole("button", { name: "add-v1" }));
    fireEvent.click(screen.getByRole("button", { name: "add-v1" }));

    expect(screen.getByTestId("queue-ids")).toHaveTextContent("v1");
    expect(screen.getByTestId("queue-count")).toHaveTextContent("1");
  });

  it("dequeues matching id on video-ended event", () => {
    render(React.createElement(QueueHarness, { currentVideoId: "v0" }));

    fireEvent.click(screen.getByRole("button", { name: "add-v1" }));
    fireEvent.click(screen.getByRole("button", { name: "add-v2" }));

    act(() => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.VIDEO_ENDED, {
        detail: {
          videoId: "v1",
          reason: "ended",
        },
      }));
    });

    expect(screen.getByTestId("queue-ids")).toHaveTextContent("v2");
    expect(screen.getByTestId("queue-count")).toHaveTextContent("1");
  });

  it("dequeues matching id on temp-queue-dequeue event", () => {
    render(React.createElement(QueueHarness, { currentVideoId: "v0" }));

    fireEvent.click(screen.getByRole("button", { name: "add-v1" }));
    fireEvent.click(screen.getByRole("button", { name: "add-v2" }));

    act(() => {
      window.dispatchEvent(new CustomEvent(EVENT_NAMES.TEMP_QUEUE_DEQUEUE, {
        detail: {
          videoId: "v2",
          reason: "manual-next",
        },
      }));
    });

    expect(screen.getByTestId("queue-ids")).toHaveTextContent("v1");
    expect(screen.getByTestId("queue-count")).toHaveTextContent("1");
  });

  it("removes previously playing video when currentVideoId changes", () => {
    const { rerender } = render(React.createElement(QueueHarness, { currentVideoId: "v1" }));

    fireEvent.click(screen.getByRole("button", { name: "add-v1" }));
    fireEvent.click(screen.getByRole("button", { name: "add-v2" }));

    rerender(React.createElement(QueueHarness, { currentVideoId: "v2" }));

    expect(screen.getByTestId("queue-ids")).toHaveTextContent("v2");
    expect(screen.getByTestId("queue-count")).toHaveTextContent("1");
  });

  it("supports direct remove mutation through the unified mutation API", () => {
    render(React.createElement(QueueHarness, { currentVideoId: "v0" }));

    fireEvent.click(screen.getByRole("button", { name: "add-v1" }));
    fireEvent.click(screen.getByRole("button", { name: "add-v2" }));
    fireEvent.click(screen.getByRole("button", { name: "remove-v2-transition-sync" }));

    expect(screen.getByTestId("queue-ids")).toHaveTextContent("v1");
    expect(screen.getByTestId("queue-count")).toHaveTextContent("1");
  });
});
