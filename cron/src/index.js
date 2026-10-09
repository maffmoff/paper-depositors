export default {
  async scheduled(_event, env) {
    const url = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${env.WORKFLOW_FILE}/dispatches`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json",
        "user-agent": "paper-depositors-cron",
      },
      body: JSON.stringify({ ref: "main" }),
    });
    if (res.status !== 204) throw new Error(`workflow_dispatch failed: ${res.status} ${await res.text()}`);
  },
};
