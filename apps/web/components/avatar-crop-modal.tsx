"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Cropper from "react-easy-crop";
import type { Area, Point } from "react-easy-crop";

type AvatarCropModalProps = {
  imageSrc: string;
  onConfirm: (croppedBlob: Blob) => void;
  onClose: () => void;
};

async function getCroppedBlob(imageSrc: string, pixelCrop: Area): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", reject);
    img.src = imageSrc;
  });

  const canvas = document.createElement("canvas");
  const OUTPUT_SIZE = 256;
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context unavailable.");
  }

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    OUTPUT_SIZE,
    OUTPUT_SIZE,
  );

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Could not produce a canvas blob."));
        }
      },
      "image/webp",
      0.9,
    );
  });
}

export function AvatarCropModal({ imageSrc, onConfirm, onClose }: AvatarCropModalProps) {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  async function handleConfirm() {
    if (!croppedAreaPixels) {
      return;
    }
    setIsProcessing(true);
    try {
      const blob = await getCroppedBlob(imageSrc, croppedAreaPixels);
      onConfirm(blob);
    } catch {
      // Let the parent handle errors after the blob callback.
    } finally {
      setIsProcessing(false);
    }
  }

  const modal = (
    <div
      className="avatarCropModalOverlay"
      onClick={() => {
        if (!isProcessing) onClose();
      }}
    >
      <div className="avatarCropModalContent" onClick={(e) => e.stopPropagation()}>
        <div className="avatarCropModalHeader">
          <h2>Crop avatar</h2>
          <button className="avatarCropCloseButton" onClick={onClose} disabled={isProcessing} aria-label="Close">
            ×
          </button>
        </div>

        <div className="avatarCropArea">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>

        <div className="avatarCropZoomRow">
          <span className="avatarCropZoomLabel">Zoom</span>
          <input
            type="range"
            className="avatarCropZoomSlider"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.currentTarget.value))}
            aria-label="Zoom"
          />
        </div>

        <div className="avatarCropActions">
          <button
            type="button"
            className="avatarCropCancelButton"
            onClick={onClose}
            disabled={isProcessing}
          >
            Cancel
          </button>
          <button
            type="button"
            className="avatarCropConfirmButton"
            onClick={() => { void handleConfirm(); }}
            disabled={isProcessing || !croppedAreaPixels}
          >
            {isProcessing ? "Saving..." : "Save avatar"}
          </button>
        </div>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(modal, document.body);
}
