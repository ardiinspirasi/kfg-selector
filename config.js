const API_URL = "https://kfg-api.ardi-inspirasi1987.workers.dev";

async function apiCall(action, params = {}) {
  const url = new URL(API_URL);
  url.searchParams.set("action", action);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) {
      url.searchParams.set(k, typeof v === "object" ? JSON.stringify(v) : v);
    }
  });
  const res = await fetch(url.toString());
  const json = await res.json();
  if (!json.success) throw new Error(json.error || "Terjadi kesalahan");
  return json.data;
}
