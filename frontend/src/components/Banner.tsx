import React from "react";
import "./Banner.css";

interface BannerProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export default function Banner({ message, actionLabel, onAction }: BannerProps) {
  return (
    <div className="banner">
      <p className="banner__message">{message}</p>
      <span className="banner__spacer" />
      {actionLabel && (
        <button className="banner__action" onClick={onAction} type="button">
          {actionLabel}
        </button>
      )}
    </div>
  );
}
