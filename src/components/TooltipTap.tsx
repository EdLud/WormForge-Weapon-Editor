import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Tap-to-read tooltips.
 *
 * The editor explains most fields through an element's `title` attribute: fine
 * on a desktop (hover shows the native tooltip) and useless on a touch screen,
 * where nothing ever hovers. This mounts one listener for the whole app and
 * turns a tap on any `title` into a small bubble with the same text, so the
 * explanations are reachable on a phone without a per-field component.
 *
 * - The `title` is moved to `data-tip-tap` while the bubble is open, so the
 *   native tooltip cannot pop up on top of it.
 * - Real controls (`button`, `input`, `select`, `textarea`, `a`) keep their
 *   own click; their `title` is not a tooltip the user is trying to read.
 * - A `<label>`'s own text keeps its activation too: a thumb aims at the words
 *   to tick a box or focus a field, and swallowing that reads as broken. On a
 *   touch screen the text is shown as well, because there is no hover to read
 *   it with; with a mouse the native tooltip already covers it, so a click
 *   there does not pop a bubble.
 * - A titled element *inside* a label (the help icon beside a label's text) is
 *   the tip's own target, so the label's click is swallowed once for it.
 */
const CONTROLS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A', 'OPTION']);

interface Tip {
  text: string;
  /** Viewport coordinates of the tapped element. */
  left: number;
  top: number;
  bottom: number;
  width: number;
}

export const TooltipTap: React.FC = () => {
  const [tip, setTip] = useState<Tip | null>(null);
  const holder = useRef<HTMLElement | null>(null);

  // At component scope, because the bubble's own `onClick` needs it too: inside
  // the effect, that JSX `close` resolved to the global `window.close`.
  const close = useCallback(() => {
    const element = holder.current;
    if (element) {
      const text = element.getAttribute('data-tip-tap');
      if (text !== null) {
        element.setAttribute('title', text);
        element.removeAttribute('data-tip-tap');
      }
    }
    holder.current = null;
    setTip(null);
  }, []);

  useEffect(() => {

    const onPointerDown = (event: Event) => {
      const target = event.target as HTMLElement | null;
      // A tap that lands on a control is that control's, even when a wrapped
      // `label` or row carries the explanation: tapping a checkbox must toggle
      // it rather than open the tip its card happens to hold.
      if (target?.closest?.('button, input, select, textarea, a, option')) {
        close();
        return;
      }
      const element = target?.closest?.('[title], [data-tip-tap]') as HTMLElement | null;
      if (!element) {
        close();
        return;
      }
      if (holder.current === element) {
        close();
        return;
      }
      close();
      if (CONTROLS.has(element.tagName)) return;
      const text = element.getAttribute('title') ?? element.getAttribute('data-tip-tap') ?? '';
      if (!text.trim()) return;
      // A label's own click would focus its input (or toggle a checkbox card);
      // the tip is what was tapped, so the activation is cancelled. This covers
      // the help icon inside a label too, not just the label itself. Stopping
      // `pointerdown` only suppresses the focus: label activation rides on the
      // click that follows, so that click is swallowed once, in the capture
      // phase, before the label can see it.
      const pointerType = (event as PointerEvent).pointerType;
      const touch = pointerType === 'touch' || pointerType === 'pen';
      if (element.tagName === 'LABEL') {
        // The label's own text: let its activation through (tick the box, focus
        // the field), and only add the bubble for a finger.
        if (!touch) return;
      } else if (element.closest('label')) {
        // A titled element inside a label, so the tip is the target: swallow the
        // label's click once, in the capture phase. `preventDefault` on
        // pointerdown only stops the focus, and label activation rides on the
        // click that follows. A cancelled gesture sends no click, so the
        // listener is dropped again.
        event.preventDefault();
        const swallow = (clickEvent: Event) => {
          clickEvent.preventDefault();
          clickEvent.stopPropagation();
        };
        document.addEventListener('click', swallow, { capture: true, once: true });
        window.setTimeout(
          () => document.removeEventListener('click', swallow, true),
          500,
        );
      }
      element.setAttribute('data-tip-tap', text);
      element.removeAttribute('title');
      const box = element.getBoundingClientRect();
      holder.current = element;
      setTip({ text, left: box.left, top: box.top, bottom: box.bottom, width: box.width });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [close]);

  if (!tip) return null;

  const MARGIN = 8;
  const MAX_WIDTH = Math.min(340, window.innerWidth - MARGIN * 2);
  // Below the element when there is room, otherwise above it.
  const below = tip.bottom + 12 + 96 < window.innerHeight;
  const left = Math.min(
    Math.max(MARGIN, tip.left + tip.width / 2 - MAX_WIDTH / 2),
    window.innerWidth - MAX_WIDTH - MARGIN,
  );
  return (
    <div
      role="tooltip"
      onClick={close}
      style={{
        position: 'fixed',
        left,
        top: below ? tip.bottom + 8 : undefined,
        bottom: below ? undefined : window.innerHeight - tip.top + 8,
        maxWidth: MAX_WIDTH,
        zIndex: 80,
      }}
      className="pointer-events-auto rounded-lg border border-stone-700 bg-stone-900/97 px-2.5 py-2 text-[11px] leading-snug text-stone-100 shadow-xl dark:border-stone-600 dark:bg-stone-800"
    >
      {tip.text}
    </div>
  );
};
