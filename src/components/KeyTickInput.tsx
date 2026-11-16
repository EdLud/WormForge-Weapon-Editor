import React, { useState } from 'react';

/**
 * A tick field that commits on blur.
 *
 * The animation clip sorts its keys by tick, so writing the `1` of "16" into a
 * controlled input re-sorted the table under the typist and the field lost the
 * `6`. A draft value keeps the keystrokes, and the commit happens once, on blur
 * or Enter. `Escape` throws the draft away.
 */
export const KeyTickInput: React.FC<{
  value: number;
  label: string;
  className: string;
  onCommit: (value: number) => void;
}> = ({ value, label, className, onCommit }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const text = draft.trim();
    setDraft(null);
    if (text === '') return;
    const next = Number(text);
    if (Number.isNaN(next) || next === value) return;
    onCommit(Math.max(0, next));
  };
  return (
    <input
      type="number"
      min={0}
      aria-label={label}
      value={draft ?? String(value)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        } else if (event.key === 'Escape') {
          setDraft(null);
        }
      }}
      className={className}
    />
  );
};
