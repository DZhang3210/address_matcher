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
  const renderLine = (line: string) =>
    otherSet
      ? line.split(/(\s+)/).map((w, i) =>
          wordDiffers(w, otherSet) ? (
            <mark key={i} className="diffword">
              {w}
            </mark>
          ) : (
            w
          )
        )
      : line;
  return (
    <div className="card">
      <div className="card-source">{source}</div>
      {record.name && <div className="card-name">{record.name}</div>}
      <address>
        {record.lines.map((l, i) => (
          <div key={i}>{renderLine(l)}</div>
        ))}
      </address>
    </div>
  );
}
