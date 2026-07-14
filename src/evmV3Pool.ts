export type V3PoolCandidate = {
  pool: string;
  fee: number;
  liquidity: bigint;
};

export function selectBestV3Pool(candidates: V3PoolCandidate[]): { pool: string; fee: number } | null {
  const best = candidates.reduce<V3PoolCandidate | null>(
    (current, candidate) => !current || candidate.liquidity > current.liquidity ? candidate : current,
    null,
  );
  return best ? { pool: best.pool, fee: best.fee } : null;
}
