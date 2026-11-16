import { useMemo } from "react";
import { tokenSet, wordDiffers } from "./lib/text";
import type { AddressRecord } from "./types";

/** Address card. With `other`, words that the other record lacks are highlighted. */
export function AddressCard({
  source,
  record,
  other,
}: {
  source: string;
  record: AddressRecord;
  other?: AddressRecord;
}) {
  const otherSet = useMemo(() => (other ? tokenSet(other) : undefined), [other]);
  // Always the same nodes (one <span> per word); peeking only toggles a class. Swapping plain text for
  // <mark> elements made React remove text nodes that mobile Safari had rewrapped, which crashed the app.
  const renderLine = (line: string) =>
    line.split(/(\s+)/).map((w, i) =>
      /^\s*$/.test(w) ? (
        w
      ) : (
        <span key={i} className={otherSet && wordDiffers(w, otherSet) ? "w diffword" : "w"}>
          {w}
        </span>
      )
    );
  return (
    <div className="card">
      <div className="card-source">{source}</div>
      {record.name && <div className="card-name">{record.name}</div>}
      <address translate="no">
        {record.lines.map((l, i) => (
          <div key={i}>{renderLine(l)}</div>
        ))}
      </address>
    </div>
  );
}
