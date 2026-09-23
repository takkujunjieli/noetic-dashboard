const LIVE_URL = "https://takkujunjieli.github.io/noetic-dashboard/data/retailflow.json";

// 本地预览不依赖 Git 同步；线上页面仍使用同次部署的数据。
export async function loadRetailData(loadLocal, hostname = globalThis.location?.hostname) {
  if (["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
    try {
      const response = await fetch(`${LIVE_URL}?t=${Date.now()}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.dates) || !data.dates.length ||
          !Array.isArray(data.tickers) || !data.data) throw new Error("Invalid retail data");
      return { data, source: "线上最新数据" };
    } catch {
      return { data: await loadLocal("data/retailflow.json"), source: "本地副本（线上读取失败，可能滞后）" };
    }
  }
  return { data: await loadLocal("data/retailflow.json"), source: "" };
}
