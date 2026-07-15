import { readFile, writeFile } from 'node:fs/promises';

/** Pinned baseline scores per case id, persisted next to the eval spec as JSON. */
export type Baseline = Record<string, number>;

export async function loadBaseline(path: string): Promise<Baseline> {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as Baseline;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

export async function saveBaseline(path: string, baseline: Baseline): Promise<void> {
  const sorted = Object.fromEntries(
    Object.entries(baseline).sort(([a], [b]) => a.localeCompare(b)),
  );
  await writeFile(path, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
}
