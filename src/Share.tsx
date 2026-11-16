import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import qrcode from "qrcode-generator";

/*
 * Top-right "Share" button: opens a dialog with a QR code of this page's address, so someone can
 * point their phone camera at your screen and land on the game. Also a copy-link button and,
 * where the device has one, the native share sheet.
 */

function qrSvg(text: string): string {
  const qr = qrcode(0, "M"); // 0 = smallest version that fits; M = ~15% error correction
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}

export function ShareButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="share-btn" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span aria-hidden>▦</span> Share
      </button>
      {open && <ShareDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function ShareDialog({ onClose }: { onClose: () => void }) {
  const url = window.location.origin + window.location.pathname;
  const svg = useMemo(() => qrSvg(url), [url]);
  const [copied, setCopied] = useState(false);
  // A localhost address only works on this computer, so a QR of it would lead nowhere on another phone.
  const isLocal = /^(localhost|127\.|\[?::1\]?$|0\.0\.0\.0)/.test(window.location.hostname);
  const canShare = typeof navigator !== "undefined" && "share" in navigator;

  useEffect(() => {
    // Capture phase, so the game's own shortcuts (Enter = start, E = end, Y/N = answer) don't fire under the dialog.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") return;
      e.stopImmediatePropagation();
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: the link is still shown to select by hand */
    }
  };

  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal share-modal" role="dialog" aria-modal="true" aria-labelledby="share-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="share-title">Play on your phone</h2>
        <p>Point a phone camera at the code.</p>
        <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="share-url">{url}</div>
        {isLocal && (
          <p className="share-note">
            This is a local address, so it only opens on this computer. The code works for others once the site is deployed.
          </p>
        )}
        <div className="modal-actions">
          {canShare && (
            <button className="ghost" onClick={() => navigator.share({ title: "Same Place?", url }).catch(() => {})}>
              Share…
            </button>
          )}
          <button className="ghost" onClick={copy}>
            {copied ? "Copied ✓" : "Copy link"}
          </button>
          <button className="next" onClick={onClose} autoFocus>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
