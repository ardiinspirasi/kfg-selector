// ================================================
// KFG API - Cloudflare Worker
// ================================================

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.readonly"
];

const SHEET_PROJECT   = "PROJECT_DB";
const SHEET_SELECTION = "SELECTION_DB";
const SHEET_PREVIEW   = "PREVIEW_DB";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

function ok(data)    { return new Response(JSON.stringify({ success: true, data }),    { headers: CORS }); }
function err(msg)    { return new Response(JSON.stringify({ success: false, error: msg }), { headers: CORS }); }

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url    = new URL(request.url);
    const action = url.searchParams.get("action") || "";

    let body = {};
    if (request.method === "POST") {
      try { body = await request.json(); } catch(e) {}
    }

    return handleAction(action || body.action || "", url, body, env);
  }
};

async function handleAction(action, url, body, env) {
  try {
    const token   = await getAccessToken(env.CLIENT_EMAIL, env.PRIVATE_KEY);
    const sheetId = env.SPREADSHEET_ID;
    const p = (key) => url.searchParams.get(key) ?? body[key] ?? null;

    switch (action) {

      // ── SELECTOR (lama) ──
      case "getProjects":       return ok(await getProjects(token, sheetId));
      case "getProject":        return ok(await getProject(token, sheetId, p("id")));
      case "getImages":         return ok(await getImages(token, p("id"), sheetId));
      case "getSelections":     return ok(await getSelections(token, sheetId, p("id")));
      case "getAllProjects":     return ok(await getAllProjects(token, sheetId));
      case "checkSubmitted":    return ok(await checkSubmitted(token, sheetId, p("id")));
      case "saveSelection":     return ok(await saveSelection(token, sheetId, p("projectId"), body.list ?? JSON.parse(p("list")||"[]")));
      case "createProject":     return ok(await createProject(token, sheetId, { project: p("project"), client: p("client"), folderUrl: p("folderUrl"), maxSelect: p("maxSelect"), additionalFolders: p("additionalFolders")||"" }));
      case "updateProject":     return ok(await updateProject(token, sheetId, { id: p("id"), project: p("project"), client: p("client"), maxSelect: p("maxSelect"), additionalFolders: p("additionalFolders")||"" }));
      case "deleteProject":     return ok(await deleteProject(token, sheetId, p("projectId")));
      case "autoCopy":          return ok(await autoCopyToFinal(token, sheetId, env, p("projectId")));

      // ── PREVIEW (baru) ──
      case "createPreviewProject":  return ok(await createPreviewProject(token, sheetId, { project: p("project"), client: p("client"), driveUrl: p("driveUrl") }));
      case "getPreviewProject":     return ok(await getPreviewProject(token, sheetId, p("id")));
      case "getPreviewProjects":    return ok(await getPreviewProjects(token, sheetId));
      case "deletePreviewProject":  return ok(await deletePreviewProject(token, sheetId, p("id")));

      // ── FOLDER CONTENTS (preview navigator) ──
      case "getPreviewImages":      return ok(await getPreviewImages(token, sheetId, p("id")));
      case "getFolderContents":     return ok(await getFolderContents(token, p("folderId")));

      default: return err("Action tidak dikenali: " + action);
    }
  } catch(e) {
    console.error(e);
    return err(e.message || "Terjadi kesalahan");
  }
}

// ═══════════════════════════════════════════════
//  GOOGLE AUTH
// ═══════════════════════════════════════════════
async function getAccessToken(clientEmail, privateKey) {
  const now     = Math.floor(Date.now() / 1000);
  const header  = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = btoa(JSON.stringify({ iss: clientEmail, scope: SCOPES.join(" "), aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now }));
  const sigInput = `${header}.${payload}`;

  const pem       = privateKey.replace(/\\n/g,"\n").replace("-----BEGIN PRIVATE KEY-----","").replace("-----END PRIVATE KEY-----","").replace(/\s/g,"");
  const keyBuf    = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey("pkcs8", keyBuf, { name:"RSASSA-PKCS1-v1_5", hash:"SHA-256" }, false, ["sign"]);
  const sig       = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(sigInput));
  const sigB64    = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");

  const tokenRes  = await fetch("https://oauth2.googleapis.com/token", { method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"}, body:`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${sigInput}.${sigB64}` });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error("Gagal mendapat access token Google");
  return tokenData.access_token;
}

// ═══════════════════════════════════════════════
//  SHEETS HELPERS
// ═══════════════════════════════════════════════
async function sheetsGet(token, sheetId, range) {
  const res  = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}`, { headers:{ Authorization:`Bearer ${token}` } });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.values || [];
}

async function sheetsAppend(token, sheetId, range, values) {
  const res  = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`, { method:"POST", headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json" }, body: JSON.stringify({ values }) });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json;
}

async function sheetsUpdate(token, sheetId, range, values) {
  const res  = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, { method:"PUT", headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json" }, body: JSON.stringify({ values }) });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json;
}

async function sheetsGetAll(token, sheetId) {
  const res  = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`, { headers:{ Authorization:`Bearer ${token}` } });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json;
}

async function sheetsBatchDelete(token, sheetId, sheetGid, rowIndices) {
  const requests = rowIndices.sort((a,b)=>b-a).map(i=>({ deleteDimension:{ range:{ sheetId:sheetGid, dimension:"ROWS", startIndex:i, endIndex:i+1 } } }));
  const res  = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, { method:"POST", headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json" }, body: JSON.stringify({ requests }) });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json;
}

async function ensureSheet(token, sheetId, sheetName, headers) {
  const meta   = await sheetsGetAll(token, sheetId);
  const exists = meta.sheets.some(s => s.properties.title === sheetName);
  if (exists) return;
  const res  = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, { method:"POST", headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json" }, body: JSON.stringify({ requests:[{ addSheet:{ properties:{ title:sheetName } } }] }) });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  await sheetsAppend(token, sheetId, `${sheetName}!A1`, [headers]);
}

// ═══════════════════════════════════════════════
//  DRIVE HELPERS
// ═══════════════════════════════════════════════
function extractFolderId(url) {
  if (!url || typeof url !== "string") return null;
  const m = url.match(/\/folders\/([-\w]{25,})/);
  if (m) return m[1];
  const m2 = url.match(/[-\w]{25,}/);
  return m2 ? m2[0] : null;
}

function generateSlug(text, existingIds = []) {
  if (!text?.trim()) return "project-" + Date.now();
  let slug = text.toLowerCase().trim().replace(/[^a-z0-9\s-]/g,"").replace(/\s+/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"");
  if (!slug || slug.length < 3) slug = "project-" + Date.now();
  let final = slug, n = 1;
  while (existingIds.includes(final)) final = slug + "-" + (n++);
  return final;
}

function getMimeCategory(mimeType) {
  if (!mimeType) return "other";
  if (mimeType === "application/vnd.google-apps.folder") return "folder";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return "other";
}

// ── getFolderContents: returns folders + images + videos in one call ──
async function getFolderContents(token, folderId) {
  if (!folderId) throw new Error("Folder ID diperlukan");

  const fields = "files(id,name,mimeType,thumbnailLink,videoMediaMetadata,size)";
  const query  = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const url    = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=${fields}&pageSize=500&orderBy=folder,name`;

  const res  = await fetch(url, { headers:{ Authorization:`Bearer ${token}` } });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);

  const files = data.files || [];
  return files.map(f => {
    const cat = getMimeCategory(f.mimeType);
    const item = { id: f.id, name: f.name, mimeType: f.mimeType, category: cat };

    if (cat === "image") {
      item.url     = `https://drive.google.com/thumbnail?id=${f.id}&sz=w400`;
      item.fullUrl = `https://drive.google.com/thumbnail?id=${f.id}&sz=w1600`;
      item.downloadUrl = `https://drive.google.com/uc?export=download&id=${f.id}`;
    } else if (cat === "video") {
      item.url         = f.thumbnailLink || `https://drive.google.com/thumbnail?id=${f.id}&sz=w400`;
      item.fullUrl     = `https://drive.google.com/file/d/${f.id}/preview`;
      item.downloadUrl = `https://drive.google.com/uc?export=download&id=${f.id}`;
      item.viewUrl     = `https://drive.google.com/file/d/${f.id}/view`;
    } else if (cat === "folder") {
      item.url = null;
    }

    return item;
  });
}

// ═══════════════════════════════════════════════
//  PREVIEW SYSTEM
// ═══════════════════════════════════════════════
async function createPreviewProject(token, sheetId, data) {
  const { project, client, driveUrl } = data;
  if (!project?.trim())  throw new Error("Nama project wajib diisi");
  if (!client?.trim())   throw new Error("Nama client wajib diisi");
  if (!driveUrl?.trim()) throw new Error("Link Google Drive wajib diisi");

  const folderId = extractFolderId(driveUrl);
  if (!folderId) throw new Error("Format link Google Drive tidak valid");

  await ensureSheet(token, sheetId, SHEET_PREVIEW, ["ID","Project","Client","FolderID","DriveUrl","CreatedAt"]);

  const rows       = await sheetsGet(token, sheetId, `${SHEET_PREVIEW}!A:A`);
  const existing   = rows.slice(1).map(r => r[0]).filter(Boolean);
  const id         = generateSlug(client + "-" + project, existing);

  await sheetsAppend(token, sheetId, `${SHEET_PREVIEW}!A:F`, [[id, project.trim(), client.trim(), folderId, driveUrl.trim(), new Date().toISOString()]]);
  return { id };
}

async function getPreviewProject(token, sheetId, id) {
  if (!id) throw new Error("ID project diperlukan");
  await ensureSheet(token, sheetId, SHEET_PREVIEW, ["ID","Project","Client","FolderID","DriveUrl","CreatedAt"]);
  const rows = await sheetsGet(token, sheetId, `${SHEET_PREVIEW}!A:F`);
  const row  = rows.slice(1).find(r => r[0] == id);
  if (!row) throw new Error("Project preview tidak ditemukan");
  return { id: row[0], project: row[1], client: row[2], folderId: row[3], driveUrl: row[4] };
}

async function getPreviewProjects(token, sheetId) {
  await ensureSheet(token, sheetId, SHEET_PREVIEW, ["ID","Project","Client","FolderID","DriveUrl","CreatedAt"]);
  const rows = await sheetsGet(token, sheetId, `${SHEET_PREVIEW}!A:F`);
  if (rows.length <= 1) return [];
  return rows.slice(1).filter(r => r[0]).map(r => ({ id:r[0], project:r[1], client:r[2], folderId:r[3], driveUrl:r[4], createdAt: r[5] ? r[5].substring(0,10) : "-" }));
}

async function getPreviewImages(token, sheetId, id) {
  if (!id) throw new Error("ID project diperlukan");
  const proj = await getPreviewProject(token, sheetId, id);
  return getFolderContents(token, proj.folderId);
}

async function deletePreviewProject(token, sheetId, id) {
  if (!id) throw new Error("ID diperlukan");
  const rows     = await sheetsGet(token, sheetId, `${SHEET_PREVIEW}!A:A`);
  const rowIndex = rows.findIndex((r,i) => i > 0 && r[0] == id);
  if (rowIndex === -1) throw new Error("Project preview tidak ditemukan");
  const meta  = await sheetsGetAll(token, sheetId);
  const sheet = meta.sheets.find(s => s.properties.title === SHEET_PREVIEW);
  if (!sheet) throw new Error("Sheet PREVIEW_DB tidak ditemukan");
  await sheetsBatchDelete(token, sheetId, sheet.properties.sheetId, [rowIndex]);
  return true;
}

// ═══════════════════════════════════════════════
//  SELECTOR SYSTEM (lama — tidak berubah)
// ═══════════════════════════════════════════════
async function getProjects(token, sheetId) {
  const rows = await sheetsGet(token, sheetId, `${SHEET_PROJECT}!A:F`);
  if (rows.length <= 1) return [];
  return rows.slice(1).map(r => ({ id:r[0]||"", project:r[1]||"-", client:r[2]||"-", maxSelect:r[4]||0, additionalFolders:r[5]||"" })).filter(p=>p.id);
}

async function getProject(token, sheetId, projectId) {
  if (!projectId) throw new Error("Project ID diperlukan");
  const rows = await sheetsGet(token, sheetId, `${SHEET_PROJECT}!A:E`);
  const p    = rows.slice(1).find(r => r[0] == projectId);
  if (!p) throw new Error("Project tidak ditemukan");
  return { id:p[0], project:p[1], client:p[2], maxSelect:p[4] };
}

async function getAllProjects(token, sheetId) {
  const [pr, sr] = await Promise.all([sheetsGet(token, sheetId, `${SHEET_PROJECT}!A:F`), sheetsGet(token, sheetId, `${SHEET_SELECTION}!A:C`)]);
  if (pr.length <= 1) return [];
  const totalMap = {};
  sr.slice(1).forEach(r => { if (r[1]) totalMap[r[1]] = (totalMap[r[1]]||0) + 1; });
  return pr.slice(1).filter(r=>r[0]).map(r => ({ id:r[0], project:r[1], client:r[2], total:totalMap[r[0]]||0 }));
}

async function checkSubmitted(token, sheetId, projectId) {
  const rows = await sheetsGet(token, sheetId, `${SHEET_SELECTION}!A:C`);
  return rows.slice(1).some(r => r[1] == projectId);
}

async function getSelections(token, sheetId, projectId) {
  if (!projectId) throw new Error("Project ID diperlukan");
  const rows = await sheetsGet(token, sheetId, `${SHEET_SELECTION}!A:C`);
  return rows.slice(1).filter(r => r[1] == projectId).map(r => [r[0],r[1],r[2]]);
}

async function getImages(token, projectId, sheetId) {
  if (!projectId) throw new Error("Project ID diperlukan");
  const rows = await sheetsGet(token, sheetId, `${SHEET_PROJECT}!A:F`);
  const proj = rows.slice(1).find(r => r[0] == projectId);
  if (!proj) throw new Error("Project tidak ditemukan");
  const folders = [];
  if (proj[3]) folders.push(proj[3]);
  if (proj[5]) proj[5].split(",").map(f=>f.trim()).filter(f=>f).forEach(f=>folders.push(f));
  const allImages = [], imageNames = new Set();
  for (const fid of folders) {
    try {
      const items = await getFolderContents(token, fid);
      items.filter(f => f.category === "image").forEach(f => {
        if (!imageNames.has(f.name)) { imageNames.add(f.name); allImages.push(f); }
      });
    } catch(e) { console.error("Folder error:", fid, e); }
  }
  return allImages.sort((a,b) => a.name.localeCompare(b.name));
}

async function saveSelection(token, sheetId, projectId, list) {
  if (!projectId)            throw new Error("Project ID diperlukan");
  if (!list || !list.length) throw new Error("Tidak ada file yang dipilih");
  if (list.length > 100)     throw new Error("Terlalu banyak file (maks 100)");
  const now = new Date().toISOString();
  await sheetsAppend(token, sheetId, `${SHEET_SELECTION}!A:C`, list.map(name => [now, projectId, name]));
  return true;
}

async function createProject(token, sheetId, data) {
  const { project, client, folderUrl, maxSelect, additionalFolders } = data;
  if (!project?.trim())   throw new Error("Nama project wajib diisi");
  if (!client?.trim())    throw new Error("Nama client wajib diisi");
  if (!folderUrl?.trim()) throw new Error("Link folder wajib diisi");
  const maxNum = parseInt(maxSelect);
  if (isNaN(maxNum) || maxNum <= 0) throw new Error("Max Select harus angka positif");
  const folderId = extractFolderId(folderUrl);
  if (!folderId) throw new Error("Link Google Drive tidak valid");
  let additionalIds = "";
  if (additionalFolders?.trim()) additionalIds = additionalFolders.split("\n").map(f=>extractFolderId(f.trim())).filter(f=>f).join(",");
  const rows = await sheetsGet(token, sheetId, `${SHEET_PROJECT}!A:A`);
  const projectId = generateSlug(client, rows.slice(1).map(r=>r[0]).filter(Boolean));
  await sheetsAppend(token, sheetId, `${SHEET_PROJECT}!A:F`, [[projectId, project.trim(), client.trim(), folderId, maxNum, additionalIds]]);
  return projectId;
}

async function updateProject(token, sheetId, data) {
  const { id, project, client, maxSelect, additionalFolders } = data;
  if (!id)              throw new Error("Project ID diperlukan");
  if (!project?.trim()) throw new Error("Nama project wajib diisi");
  if (!client?.trim())  throw new Error("Nama client wajib diisi");
  const maxNum = parseInt(maxSelect);
  if (isNaN(maxNum) || maxNum <= 0) throw new Error("Max Select harus angka positif");
  let additionalIds = "";
  if (additionalFolders?.trim()) additionalIds = additionalFolders.split("\n").map(f=>extractFolderId(f.trim())).filter(f=>f).join(",");
  const rows = await sheetsGet(token, sheetId, `${SHEET_PROJECT}!A:F`);
  const rowIndex = rows.findIndex((r,i) => i > 0 && r[0] == id);
  if (rowIndex === -1) throw new Error("Project tidak ditemukan");
  await sheetsUpdate(token, sheetId, `${SHEET_PROJECT}!B${rowIndex+1}:F${rowIndex+1}`, [[project.trim(), client.trim(), rows[rowIndex][3], maxNum, additionalIds]]);
  return true;
}

async function deleteProject(token, sheetId, projectId) {
  if (!projectId) throw new Error("Project ID diperlukan");
  const rows     = await sheetsGet(token, sheetId, `${SHEET_PROJECT}!A:A`);
  const rowIndex = rows.findIndex((r,i) => i > 0 && r[0] == projectId);
  if (rowIndex === -1) throw new Error("Project tidak ditemukan");
  const meta  = await sheetsGetAll(token, sheetId);
  const sheet = meta.sheets.find(s => s.properties.title === SHEET_PROJECT);
  if (!sheet) throw new Error("Sheet tidak ditemukan");
  await sheetsBatchDelete(token, sheetId, sheet.properties.sheetId, [rowIndex]);
  return true;
}

async function autoCopyToFinal(token, sheetId, env, projectId) {
  const selections = await getSelections(token, sheetId, projectId);
  if (!selections.length) throw new Error("Belum ada submission");
  const groups = {};
  selections.forEach(r => { if (!groups[r[0]]) groups[r[0]]=[]; groups[r[0]].push(r[2]); });
  const latest = Object.keys(groups).sort().reverse()[0];
  const files  = [...new Set(groups[latest])];
  return `📋 ${files.length} file dari submission terakhir:\n${files.join(", ")}`;
}
