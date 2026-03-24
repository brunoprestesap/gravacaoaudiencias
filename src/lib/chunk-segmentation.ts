export interface SegmentableChunk {
  chunkIndex: number;
  timestamp: number;
  segmentIndex?: number;
  data: Blob;
}

const CHUNK_INTERVAL_MS = 5000;
const SESSION_GAP_THRESHOLD_MS = CHUNK_INTERVAL_MS * 3;

/**
 * Builds video segments from chunk list.
 *
 * Priority:
 * 1) If segmentIndex exists in any chunk, split by segmentIndex.
 * 2) Otherwise, split by timestamp gaps (fallback for legacy chunks).
 */
export function buildSegmentsFromChunks<T extends SegmentableChunk>(
  chunks: T[]
): Blob[] {
  if (chunks.length === 0) return [];

  const ordered = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
  const hasExplicitSegments = ordered.some(
    (chunk) => chunk.segmentIndex !== undefined
  );

  if (hasExplicitSegments) {
    const bySegment = new Map<number, T[]>();
    for (const chunk of ordered) {
      const segment = chunk.segmentIndex ?? 0;
      const list = bySegment.get(segment) ?? [];
      list.push(chunk);
      bySegment.set(segment, list);
    }

    return [...bySegment.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, group]) => new Blob(group.map((chunk) => chunk.data), { type: "video/webm" }));
  }

  const groups: T[][] = [];
  let currentGroup: T[] = [ordered[0]];

  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const current = ordered[i];
    const gapMs = current.timestamp - prev.timestamp;

    if (gapMs > SESSION_GAP_THRESHOLD_MS) {
      groups.push(currentGroup);
      currentGroup = [current];
      continue;
    }

    currentGroup.push(current);
  }

  groups.push(currentGroup);
  return groups.map((group) => new Blob(group.map((chunk) => chunk.data), { type: "video/webm" }));
}
