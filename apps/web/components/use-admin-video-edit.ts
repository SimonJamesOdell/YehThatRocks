"use client";

import { type RefObject, useState } from "react";
import { useRouter } from "next/navigation";

import { fetchWithAuthRetry } from "@/lib/client-auth-fetch";

type AdminEditableVideo = {
  id: number;
  videoId: string;
  title: string;
  parsedArtist: string | null;
  parsedTrack: string | null;
  parsedVideoType: string | null;
  parseConfidence: number | null;
  channelTitle: string | null;
  description: string | null;
  updatedAt: string | Date | null;
};

export type UseAdminVideoEditReturn = {
  showAdminVideoEditModal: boolean;
  setShowAdminVideoEditModal: React.Dispatch<React.SetStateAction<boolean>>;
  adminEditVideoRowId: number | null;
  adminEditTitle: string;
  setAdminEditTitle: React.Dispatch<React.SetStateAction<string>>;
  adminEditChannelTitle: string;
  setAdminEditChannelTitle: React.Dispatch<React.SetStateAction<string>>;
  adminEditParsedArtist: string;
  setAdminEditParsedArtist: React.Dispatch<React.SetStateAction<string>>;
  adminEditParsedTrack: string;
  setAdminEditParsedTrack: React.Dispatch<React.SetStateAction<string>>;
  adminEditParsedVideoType: string;
  setAdminEditParsedVideoType: React.Dispatch<React.SetStateAction<string>>;
  adminEditParseConfidence: string;
  setAdminEditParseConfidence: React.Dispatch<React.SetStateAction<string>>;
  adminEditDescription: string;
  setAdminEditDescription: React.Dispatch<React.SetStateAction<string>>;
  isAdminEditLoading: boolean;
  isAdminEditSaving: boolean;
  isAdminDeleting: boolean;
  setIsAdminDeleting: React.Dispatch<React.SetStateAction<boolean>>;
  showAdminDeleteConfirmModal: boolean;
  setShowAdminDeleteConfirmModal: React.Dispatch<React.SetStateAction<boolean>>;
  adminEditError: string | null;
  setAdminEditError: React.Dispatch<React.SetStateAction<string | null>>;
  adminEditStatus: string | null;
  setAdminEditStatus: React.Dispatch<React.SetStateAction<string | null>>;
  handleOpenAdminVideoEdit: () => Promise<void>;
  handleSaveAdminVideoEdit: () => Promise<void>;
  closeAdminVideoEditModal: () => void;
};

export function useAdminVideoEdit({
  videoId,
  isAdmin,
  playerFrameRef,
  pointerPositionRef,
  onSaveSuccess,
  onShowControls,
}: {
  videoId: string;
  isAdmin: boolean;
  playerFrameRef: RefObject<HTMLDivElement | null>;
  pointerPositionRef: RefObject<{ x: number; y: number } | null>;
  /** Called after a successful save with the new title and channelTitle */
  onSaveSuccess: (title: string, channelTitle: string) => void;
  /** Called from closeAdminVideoEditModal when the pointer is hovering the player */
  onShowControls: () => void;
}): UseAdminVideoEditReturn {
  const router = useRouter();

  const [showAdminVideoEditModal, setShowAdminVideoEditModal] = useState(false);
  const [adminEditVideoRowId, setAdminEditVideoRowId] = useState<number | null>(null);
  const [adminEditTitle, setAdminEditTitle] = useState("");
  const [adminEditChannelTitle, setAdminEditChannelTitle] = useState("");
  const [adminEditParsedArtist, setAdminEditParsedArtist] = useState("");
  const [adminEditParsedTrack, setAdminEditParsedTrack] = useState("");
  const [adminEditParsedVideoType, setAdminEditParsedVideoType] = useState("");
  const [adminEditParseConfidence, setAdminEditParseConfidence] = useState("");
  const [adminEditDescription, setAdminEditDescription] = useState("");
  const [isAdminEditLoading, setIsAdminEditLoading] = useState(false);
  const [isAdminEditSaving, setIsAdminEditSaving] = useState(false);
  const [isAdminDeleting, setIsAdminDeleting] = useState(false);
  const [showAdminDeleteConfirmModal, setShowAdminDeleteConfirmModal] = useState(false);
  const [adminEditError, setAdminEditError] = useState<string | null>(null);
  const [adminEditStatus, setAdminEditStatus] = useState<string | null>(null);

  async function handleOpenAdminVideoEdit() {
    if (!isAdmin) {
      return;
    }

    setShowAdminVideoEditModal(true);
    setIsAdminEditLoading(true);
    setAdminEditError(null);
    setAdminEditStatus(null);

    try {
      const response = await fetchWithAuthRetry(`/api/admin/videos?q=${encodeURIComponent(videoId)}`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAdminEditError("Admin session expired. Please sign in again.");
          return;
        }
        setAdminEditError("Could not load video details.");
        return;
      }

      const payload = (await response.json().catch(() => null)) as { videos?: AdminEditableVideo[] } | null;
      const row = Array.isArray(payload?.videos)
        ? payload.videos.find((video) => video.videoId === videoId) ?? null
        : null;

      if (!row) {
        setAdminEditError("Video record not found.");
        return;
      }

      setAdminEditVideoRowId(row.id);
      setAdminEditTitle(row.title ?? "");
      setAdminEditChannelTitle(row.channelTitle ?? "");
      setAdminEditParsedArtist(row.parsedArtist ?? "");
      setAdminEditParsedTrack(row.parsedTrack ?? "");
      setAdminEditParsedVideoType(row.parsedVideoType ?? "");
      setAdminEditParseConfidence(
        row.parseConfidence === null || row.parseConfidence === undefined
          ? ""
          : String(row.parseConfidence),
      );
      setAdminEditDescription(row.description ?? "");
    } catch {
      setAdminEditError("Could not load video details.");
    } finally {
      setIsAdminEditLoading(false);
    }
  }

  async function handleSaveAdminVideoEdit() {
    if (!isAdmin || !adminEditVideoRowId) {
      return;
    }

    setIsAdminEditSaving(true);
    setAdminEditError(null);
    setAdminEditStatus(null);

    const confidenceValue = adminEditParseConfidence.trim();
    let parseConfidence: number | null = null;

    if (confidenceValue.length > 0) {
      const parsed = Number(confidenceValue);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
        setAdminEditError("Parse confidence must be between 0 and 1.");
        setIsAdminEditSaving(false);
        return;
      }
      parseConfidence = parsed;
    }

    try {
      const response = await fetchWithAuthRetry("/api/admin/videos", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: adminEditVideoRowId,
          title: adminEditTitle,
          channelTitle: adminEditChannelTitle,
          parsedArtist: adminEditParsedArtist,
          parsedTrack: adminEditParsedTrack,
          parsedVideoType: adminEditParsedVideoType,
          parseConfidence,
          description: adminEditDescription,
        }),
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setAdminEditError("Admin session expired. Please sign in again.");
          return;
        }
        setAdminEditError("Could not save video changes.");
        return;
      }

      setAdminEditStatus("Saved.");
      onSaveSuccess(adminEditTitle, adminEditChannelTitle);
      closeAdminVideoEditModal();
      router.refresh();
    } catch {
      setAdminEditError("Could not save video changes.");
    } finally {
      setIsAdminEditSaving(false);
    }
  }

  function closeAdminVideoEditModal() {
    setShowAdminVideoEditModal(false);

    if (typeof window === "undefined") {
      return;
    }

    window.requestAnimationFrame(() => {
      const frame = playerFrameRef.current;
      if (!frame) {
        return;
      }

      const isHoveringFrame = frame.matches(":hover");
      const pointer = pointerPositionRef.current;
      const frameRect = frame.getBoundingClientRect();
      const pointerInsideFrame = Boolean(
        pointer
        && pointer.x >= frameRect.left
        && pointer.x <= frameRect.right
        && pointer.y >= frameRect.top
        && pointer.y <= frameRect.bottom,
      );

      if (isHoveringFrame || pointerInsideFrame) {
        onShowControls();
      }
    });
  }

  return {
    showAdminVideoEditModal,
    setShowAdminVideoEditModal,
    adminEditVideoRowId,
    adminEditTitle,
    setAdminEditTitle,
    adminEditChannelTitle,
    setAdminEditChannelTitle,
    adminEditParsedArtist,
    setAdminEditParsedArtist,
    adminEditParsedTrack,
    setAdminEditParsedTrack,
    adminEditParsedVideoType,
    setAdminEditParsedVideoType,
    adminEditParseConfidence,
    setAdminEditParseConfidence,
    adminEditDescription,
    setAdminEditDescription,
    isAdminEditLoading,
    isAdminEditSaving,
    isAdminDeleting,
    setIsAdminDeleting,
    showAdminDeleteConfirmModal,
    setShowAdminDeleteConfirmModal,
    adminEditError,
    setAdminEditError,
    adminEditStatus,
    setAdminEditStatus,
    handleOpenAdminVideoEdit,
    handleSaveAdminVideoEdit,
    closeAdminVideoEditModal,
  };
}
