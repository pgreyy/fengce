import { Fragment } from "react";

/** A heading split into words (each a span with its index), for the word-by-word reveal. */
export function Words({ text, onLoad = false, start = 0 }: { text: string; onLoad?: boolean; start?: number }) {
  const words = text.split(" ");
  return (
    <span className={onLoad ? "words words-load" : "words words-scroll"}>
      {words.map((w, i) => (
        <Fragment key={i}>
          <span className="w" style={{ ["--d" as string]: `${start + i * 80}ms` }}>
            {w}
          </span>
          {i < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </span>
  );
}

/** A number that counts up when it scrolls into view (the final value is always in the markup). */
export function Count({ to }: { to: number }) {
  return (
    <span className="count" data-to={to}>
      {to}
    </span>
  );
}

/** Landing-page motion (part 5). */
export function useLandingMotion() {}
