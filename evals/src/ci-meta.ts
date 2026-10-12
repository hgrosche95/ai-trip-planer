// Woher ein Report stammt: In GitHub Actions sind das Lauf-ID und Link zum
// Lauf, lokal bleibt beides null. publish.ts fasst über die Lauf-ID die
// Reports eines Nachtlaufs (Wissens- und Szenario-Evals) zu einem Eintrag
// der Historie zusammen.
export interface RunMeta {
  gitSha: string | null;
  runId: string | null;
  runUrl: string | null;
}

export function runMeta(env: NodeJS.ProcessEnv = process.env): RunMeta {
  const runId = env.GITHUB_RUN_ID ?? null;
  const runUrl =
    runId && env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY
      ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${runId}`
      : null;
  return { gitSha: env.GITHUB_SHA ?? null, runId, runUrl };
}
