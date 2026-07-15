import type { ReactNode } from 'react';

/**
 * Pretty-printed JSON with lightweight syntax coloring. Tokenizes the stringified
 * value into React text nodes (no HTML injection) — keys, strings, numbers,
 * booleans and punctuation each get a CSS class.
 */
export function JsonBlock({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2) ?? 'null';
  return <pre className="code-block">{highlight(text)}</pre>;
}

const TOKEN = /"(?:\\.|[^"\\])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

function highlight(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const i = m.index!;
    if (i > last) {
      out.push(
        <span key={out.length} className="json-punct">
          {text.slice(last, i)}
        </span>,
      );
    }
    const tok = m[0];
    let cls = 'json-num';
    if (tok.startsWith('"')) cls = m[1] ? 'json-key' : 'json-str';
    else if (tok === 'true' || tok === 'false' || tok === 'null') cls = 'json-bool';
    out.push(
      <span key={out.length} className={cls}>
        {tok}
      </span>,
    );
    last = i + tok.length;
  }
  if (last < text.length) {
    out.push(
      <span key={out.length} className="json-punct">
        {text.slice(last)}
      </span>,
    );
  }
  return out;
}
