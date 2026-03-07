/* =========================================
   KFG PROJECT SYSTEM - GITHUB PAGES VERSION
   Backend: Google Apps Script (pure API)
   Frontend: GitHub Pages
   ========================================= */

const SHEET_PROJECT   = "PROJECT_DB";
const SHEET_SELECTION = "SELECTION_DB";
const SHEET_ERROR     = "ERROR_LOG";
const SHEET_PREVIEW   = "PREVIEW_DB";

// ================ CORS HELPER ================
function makeResponse(data) {
  const json = JSON.stringify(data);
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function makeError(message) {
  return makeResponse({ success: false, error: message });
}

function makeSuccess(data) {
  return makeResponse({ success: true, data: data });
}

// ================ ROUTER UTAMA (API) ================
function doGet(e) {
  const param = e && e.parameter ? e.parameter : {};
  const action = param.action || "";

  try {
    switch (action) {

      // ── PROJECT SELECTOR (sistem lama) ──
      case "getProjects":
        return makeSuccess(getProjects());
      case "getProject":
        return makeSuccess(getProject(param.id));
      case "getImages":
        return makeSuccess(getImages(param.id));
      case "getSelections":
        return makeSuccess(getSelections(param.id));
      case "getAllProjects":
        return makeSuccess(getAllProjects());
      case "checkSubmitted":
        return makeSuccess(checkSubmitted(param.id));

      // ── PREVIEW SYSTEM (sistem baru) ──
      case "getPreviewProject":
        return makeSuccess(getPreviewProject(param.id));
      case "getPreviewImages":
        return makeSuccess(getPreviewImages(param.id));
      case "getPreviewProjects":
        return makeSuccess(getPreviewProjects());

      default:
        return makeError("Action tidak dikenali: " + action);
    }
  } catch (err) {
    logError(err);
    return makeError(getUserFriendlyMessage(err));
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action || "";

    switch (action) {

      // ── PROJECT SELECTOR (sistem lama) ──
      case "saveSelection":
        return makeSuccess(saveSelection(body.projectId, body.list));
      case "createProject":
        return makeSuccess(createProject(body.project, body.client, body.folderUrl, body.maxSelect, body.additionalFolders));
      case "updateProject":
        return makeSuccess(createOrUpdateProject(body.id, body.project, body.client, body.maxSelect, body.additionalFolders));
      case "deleteProject":
        return makeSuccess(deleteProject(body.projectId));
      case "autoCopy":
        return makeSuccess(autoCopyToFinal(body.projectId));

      // ── PREVIEW SYSTEM (sistem baru) ──
      case "createPreviewProject":
        return makeSuccess(createPreviewProject(body.project, body.client, body.driveUrl));
      case "deletePreviewProject":
        return makeSuccess(deletePreviewProject(body.id));

      default:
        return makeError("Action tidak dikenali: " + action);
    }
  } catch (err) {
    logError(err);
    return makeError(getUserFriendlyMessage(err));
  }
}

// ================ ERROR HANDLER ================
function runWithErrorHandler(callback) {
  try {
    return callback();
  } catch (e) {
    logError(e);
    throw new Error(getUserFriendlyMessage(e));
  }
}

function logError(error) {
  try {
    const ss = SpreadsheetApp.getActive();
    let errorSheet = ss.getSheetByName(SHEET_ERROR);

    if (!errorSheet) {
      errorSheet = ss.insertSheet(SHEET_ERROR);
      errorSheet.getRange(1, 1, 1, 5).setValues([["Timestamp", "Error", "Stack", "User", "Project"]]);
    }

    const stack = error.stack || "";
    errorSheet.appendRow([
      new Date(),
      error.toString(),
      stack.substring(0, 500),
      "",
      "-"
    ]);
  } catch (e) {}
}

function getUserFriendlyMessage(error) {
  const msg = error.toString();
  if (msg.includes("Folder tidak ditemukan"))   return "Folder Google Drive tidak valid.";
  if (msg.includes("exceeded"))                 return "Batas penggunaan tercapai. Coba lagi nanti.";
  if (msg.includes("permission"))               return "Tidak punya akses ke folder.";
  if (msg.includes("Project ID"))               return "Project tidak ditemukan.";
  return "Error: " + msg;
}

// ================ SLUG GENERATOR ================
function generateSlug(text, existingIds) {
  existingIds = existingIds || [];
  if (!text || !text.trim()) return "";

  var slug = text.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!slug || slug.length < 3) slug = "project-" + new Date().getTime();

  var finalSlug = slug;
  var counter = 1;
  while (existingIds.indexOf(finalSlug) !== -1) {
    finalSlug = slug + "-" + counter;
    counter++;
  }

  return finalSlug;
}

function getAllExistingSlugs() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_PROJECT);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  return data.slice(1).map(r => r[0]).filter(id => id && id.toString().trim());
}

// ================ FOLDER FUNCTIONS ================
function getAllProjectFolders(projectId) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_PROJECT);
  const data = sheet.getDataRange().getValues();
  const project = data.find(r => r[0] == projectId);
  if (!project) return [];

  const folders = [];
  if (project[3]) folders.push(project[3]);
  if (project[5] && project[5].trim()) {
    const additional = project[5].split(',').map(f => f.trim()).filter(f => f);
    folders.push(...additional);
  }
  return folders;
}

// ================ API: GET IMAGES (sistem lama) ================
function getImages(projectId) {
  if (!projectId) throw new Error("Project ID diperlukan");

  const folders = getAllProjectFolders(projectId);
  const allImages = [];
  const imageNames = new Set();

  folders.forEach(folderId => {
    try {
      const folder = DriveApp.getFolderById(folderId);
      const files = folder.getFiles();
      while (files.hasNext()) {
        const f = files.next();
        if (f.getMimeType().includes("image")) {
          const imageName = f.getName();
          if (!imageNames.has(imageName)) {
            imageNames.add(imageName);
            const fileId = f.getId();
            allImages.push({
              name: imageName,
              url: "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w800",
              fullUrl: "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w1600"
            });
          }
        }
      }
    } catch (e) {
      Logger.log("Folder error: " + folderId + " - " + e);
    }
  });

  return allImages.sort((a, b) => a.name.localeCompare(b.name));
}

// ================ API: GET PROJECT (sistem lama) ================
function getProject(projectId) {
  if (!projectId) throw new Error("Project ID diperlukan");

  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_PROJECT);
  const data = sheet.getDataRange().getValues();
  const project = data.find(r => r[0] == projectId);

  if (!project) throw new Error("Project tidak ditemukan");

  return {
    id: project[0],
    project: project[1],
    client: project[2],
    maxSelect: project[4]
  };
}

// ================ API: GET PROJECTS ADMIN (sistem lama) ================
function getProjects() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_PROJECT);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  return data.slice(1).map(r => ({
    id: r[0] || "",
    project: r[1] || "-",
    client: r[2] || "-",
    maxSelect: r[4] || 0,
    additionalFolders: r[5] || ""
  })).filter(p => p.id);
}

// ================ API: GET ALL PROJECTS INDEX (sistem lama) ================
function getAllProjects() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_PROJECT);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  return data.slice(1).map(r => ({
    id: r[0],
    project: r[1],
    client: r[2],
    total: getSelectionCount(r[0])
  }));
}

function getSelectionCount(projectId) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_SELECTION);
  const data = sheet.getDataRange().getValues();
  return data.slice(1).filter(r => r[1] == projectId).length;
}

// ================ API: CHECK SUBMITTED (sistem lama) ================
function checkSubmitted(projectId) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_SELECTION);
  const data = sheet.getDataRange().getValues();
  return data.slice(1).some(r => r[1] == projectId);
}

// ================ API: GET SELECTIONS (sistem lama) ================
function getSelections(projectId) {
  if (!projectId) throw new Error("Project ID diperlukan");

  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_SELECTION);
  const data = sheet.getDataRange().getValues();

  return data.slice(1)
    .filter(r => r[1] == projectId)
    .map(r => [r[0], r[1], r[2]]);
}

// ================ API: SAVE SELECTION (sistem lama) ================
function saveSelection(projectId, list) {
  if (!projectId)            throw new Error("Project ID diperlukan");
  if (!list || !list.length) throw new Error("Tidak ada file yang dipilih");
  if (list.length > 100)     throw new Error("Terlalu banyak file (maks 100)");

  const projectSheet = SpreadsheetApp.getActive().getSheetByName(SHEET_PROJECT);
  const projectExists = projectSheet.getDataRange().getValues().slice(1).some(r => r[0] == projectId);
  if (!projectExists) throw new Error("Project tidak valid");

  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_SELECTION);
  list.forEach(name => sh.appendRow([new Date(), projectId, name]));

  try { notifyAdmin(projectId, list.length); } catch (e) {}

  return true;
}

// ================ API: CREATE PROJECT (sistem lama) ================
function createProject(project, client, folderUrl, maxSelect, additionalFolders) {
  if (!project || !project.trim())     throw new Error("Nama project wajib diisi");
  if (!client || !client.trim())       throw new Error("Nama client wajib diisi");
  if (!folderUrl || !folderUrl.trim()) throw new Error("Link folder wajib diisi");

  const maxNum = parseInt(maxSelect);
  if (isNaN(maxNum) || maxNum <= 0)    throw new Error("Max Select harus angka positif");

  const folderId = extractFolderId(folderUrl);
  if (!folderId) throw new Error("Link Google Drive tidak valid");

  try { DriveApp.getFolderById(folderId); }
  catch (e) { throw new Error("Folder tidak ditemukan atau tidak bisa diakses"); }

  let additionalIds = "";
  if (additionalFolders && additionalFolders.trim()) {
    const folders = additionalFolders.split('\n').map(f => f.trim()).filter(f => f);
    const validFolders = [];
    folders.forEach(url => {
      const id = extractFolderId(url);
      if (id) {
        try { DriveApp.getFolderById(id); validFolders.push(id); }
        catch (e) { throw new Error("Folder tambahan tidak valid: " + url); }
      }
    });
    additionalIds = validFolders.join(',');
  }

  const existingSlugs = getAllExistingSlugs();
  let projectId = generateSlug(client, existingSlugs);
  if (!projectId || projectId.length < 3) projectId = generateSlug(project + "-" + client, existingSlugs);
  if (!projectId) projectId = "project-" + new Date().getTime();

  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_PROJECT);
  sheet.appendRow([projectId, project.trim(), client.trim(), folderId, maxNum, additionalIds]);

  return projectId;
}

// ================ API: UPDATE PROJECT (sistem lama) ================
function createOrUpdateProject(id, project, client, maxSelect, additionalFolders) {
  if (!id)                           throw new Error("Project ID diperlukan");
  if (!project || !project.trim())   throw new Error("Nama project wajib diisi");
  if (!client || !client.trim())     throw new Error("Nama client wajib diisi");

  const maxNum = parseInt(maxSelect);
  if (isNaN(maxNum) || maxNum <= 0)  throw new Error("Max Select harus angka positif");

  let additionalIds = "";
  if (additionalFolders && additionalFolders.trim()) {
    const folders = additionalFolders.split('\n').map(f => f.trim()).filter(f => f);
    const validFolders = [];
    folders.forEach(url => {
      const fid = extractFolderId(url);
      if (fid) {
        try { DriveApp.getFolderById(fid); validFolders.push(fid); }
        catch (e) { throw new Error("Folder tambahan tidak valid: " + url); }
      }
    });
    additionalIds = validFolders.join(',');
  }

  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_PROJECT);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == id) {
      sheet.getRange(i + 1, 2).setValue(project.trim());
      sheet.getRange(i + 1, 3).setValue(client.trim());
      sheet.getRange(i + 1, 5).setValue(maxNum);
      sheet.getRange(i + 1, 6).setValue(additionalIds);
      return true;
    }
  }

  throw new Error("Project tidak ditemukan");
}

// ================ API: DELETE PROJECT (sistem lama) ================
function deleteProject(projectId) {
  if (!projectId) throw new Error("Project ID diperlukan");

  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_PROJECT);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == projectId) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }

  throw new Error("Project tidak ditemukan");
}

// ================ API: AUTO COPY TO FINAL (sistem lama) ================
function autoCopyToFinal(projectId) {
  const finalFolderId = PropertiesService.getScriptProperties().getProperty("FINAL_FOLDER_ID");
  if (!finalFolderId) throw new Error("Folder FINAL belum dikonfigurasi.");

  const projectSheet = SpreadsheetApp.getActive().getSheetByName(SHEET_PROJECT);
  const project = projectSheet.getDataRange().getValues().find(r => r[0] == projectId);
  if (!project) throw new Error("Project tidak ditemukan");

  const sourceFolders = getAllProjectFolders(projectId);
  const selectionSheet = SpreadsheetApp.getActive().getSheetByName(SHEET_SELECTION);
  const selectionData = selectionSheet.getDataRange().getValues();

  const submissions = {};
  selectionData.slice(1).forEach(row => {
    if (row[1] == projectId) {
      const ts = row[0].getTime();
      if (!submissions[ts]) submissions[ts] = [];
      submissions[ts].push(row[2]);
    }
  });

  const timestamps = Object.keys(submissions).sort().reverse();
  if (!timestamps.length) throw new Error("Belum ada submission");

  const uniqueFiles = [...new Set(submissions[timestamps[0]])];
  const finalFolder = DriveApp.getFolderById(finalFolderId);

  let totalCopied = 0, totalSkipped = 0, totalNotFound = 0;

  uniqueFiles.forEach(fileName => {
    let fileFound = false;

    for (const folderId of sourceFolders) {
      try {
        const folder = DriveApp.getFolderById(folderId);
        const files = folder.getFilesByName(fileName);
        if (files.hasNext()) {
          fileFound = true;
          const file = files.next();
          const existing = finalFolder.getFilesByName(fileName);
          if (existing.hasNext()) {
            totalSkipped++;
          } else {
            file.makeCopy(fileName, finalFolder);
            totalCopied++;
          }
          break;
        }
      } catch (e) {}
    }

    if (!fileFound) totalNotFound++;
  });

  return "✅ Selesai! Dicopy: " + totalCopied + ", Sudah ada: " + totalSkipped + ", Tidak ditemukan: " + totalNotFound;
}

// ================ NOTIFICATION ================
function notifyAdmin(projectId, count) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_PROJECT);
  const project = sheet.getDataRange().getValues().find(r => r[0] == projectId);

  if (project) {
    const adminEmail =
      PropertiesService.getScriptProperties().getProperty("ADMIN_EMAIL") || "";
    if (adminEmail) {
      MailApp.sendEmail({
        to: adminEmail,
        subject: "📸 Submission Baru: " + project[1],
        body: "Client " + project[2] + " telah memilih " + count + " foto.\n\nCek di spreadsheet: " + SpreadsheetApp.getActive().getUrl()
      });
    }
  }
}

// ================ MAINTENANCE ================
function dailyMaintenance() {
  try {
    cleanOrphanRecords();
    validateAllProjects();
    const adminEmail = PropertiesService.getScriptProperties().getProperty("ADMIN_EMAIL") || "";
    if (adminEmail) {
      MailApp.sendEmail({
        to: adminEmail,
        subject: "📊 Laporan Daily Maintenance KFG",
        body: "Maintenance selesai.\n\nCek spreadsheet: " + SpreadsheetApp.getActive().getUrl()
      });
    }
  } catch (e) { logError(e); }
}

function cleanOrphanRecords() {
  const ss = SpreadsheetApp.getActive();
  const projectSheet   = ss.getSheetByName(SHEET_PROJECT);
  const selectionSheet = ss.getSheetByName(SHEET_SELECTION);
  const validIds = projectSheet.getDataRange().getValues().slice(1).map(r => r[0]);
  const selectionData = selectionSheet.getDataRange().getValues();
  if (selectionData.length <= 1) return;

  const rowsToDelete = [];
  for (let i = 1; i < selectionData.length; i++) {
    if (validIds.indexOf(selectionData[i][1]) === -1) rowsToDelete.push(i + 1);
  }
  rowsToDelete.sort((a, b) => b - a).forEach(row => selectionSheet.deleteRow(row));
}

function validateAllProjects() {
  // placeholder — bisa diisi validasi tambahan jika diperlukan
}

// ================ SETUP ================
function setupProperties() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty("FINAL_FOLDER_ID", "12O7ZldvgjchF_p8IGmoFdcqIyhu_gt49");
  props.setProperty("BACKUP_FOLDER_ID", "1RdAzL7Jw4esZFyVgi7c9HXSZyNamD6qn");
  props.setProperty("ADMIN_EMAIL", "emailkamu@gmail.com");
  Logger.log("✅ Properties siap");
  return "Properties siap!";
}

function setupAutomation() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("dailyMaintenance").timeBased().atHour(2).everyDays(1).create();
  Logger.log("✅ Automation siap");
  return "Trigger automation sudah dibuat!";
}

// ================ HELPER ================
function extractFolderId(url) {
  if (!url || typeof url !== "string") return null;
  const patterns = [/\/folders\/([-\w]{25,})/, /[-\w]{25,}/];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1] || match[0];
  }
  return null;
}

// ================================================================
//  PREVIEW SYSTEM — fungsi-fungsi baru untuk sistem preview & download
// ================================================================

// ── Setup sheet PREVIEW_DB (auto-create jika belum ada) ──
function ensurePreviewSheet() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET_PREVIEW);

  if (!sh) {
    sh = ss.insertSheet(SHEET_PREVIEW);
    sh.getRange(1, 1, 1, 6).setValues([[
      "ID", "Project", "Client", "FolderID", "DriveUrl", "CreatedAt"
    ]]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 6)
      .setBackground("#0d1420")
      .setFontColor("#22c55e")
      .setFontWeight("bold");
    sh.setColumnWidth(1, 180);
    sh.setColumnWidth(2, 200);
    sh.setColumnWidth(3, 160);
    sh.setColumnWidth(4, 220);
    sh.setColumnWidth(5, 320);
    sh.setColumnWidth(6, 160);
    Logger.log("✅ Sheet PREVIEW_DB dibuat");
  }

  return sh;
}

// ── Generate ID unik untuk preview project ──
function generatePreviewId(client, project) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET_PREVIEW);
  const existing = sh
    ? sh.getDataRange().getValues().slice(1).map(r => r[0]).filter(Boolean)
    : [];

  let base = (client + "-" + project)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 40);

  if (!base || base.length < 3) base = "preview-" + Date.now();

  let slug = base, n = 1;
  while (existing.indexOf(slug) !== -1) { slug = base + "-" + n; n++; }
  return slug;
}

// ================ API: CREATE PREVIEW PROJECT ================
function createPreviewProject(project, client, driveUrl) {
  if (!project  || !project.trim())  throw new Error("Nama project wajib diisi");
  if (!client   || !client.trim())   throw new Error("Nama client wajib diisi");
  if (!driveUrl || !driveUrl.trim()) throw new Error("Link Google Drive wajib diisi");

  const folderId = extractFolderId(driveUrl);
  if (!folderId) throw new Error("Format link Google Drive tidak valid");

  // validasi folder bisa diakses
  try {
    DriveApp.getFolderById(folderId);
  } catch (e) {
    throw new Error("Folder tidak bisa diakses. Pastikan sudah di-share 'Anyone with the link can view'.");
  }

  const sh = ensurePreviewSheet();
  const id = generatePreviewId(client, project);

  sh.appendRow([
    id,
    project.trim(),
    client.trim(),
    folderId,
    driveUrl.trim(),
    new Date()
  ]);

  Logger.log("✅ Preview project dibuat: " + id);
  return { id: id };
}

// ================ API: GET PREVIEW PROJECT ================
function getPreviewProject(id) {
  if (!id) throw new Error("ID project diperlukan");

  const sh   = ensurePreviewSheet();
  const data = sh.getDataRange().getValues();
  const row  = data.find(r => r[0] == id);

  if (!row) throw new Error("Project preview tidak ditemukan");

  return {
    id:       row[0],
    project:  row[1],
    client:   row[2],
    folderId: row[3],
    driveUrl: row[4]
  };
}

// ================ API: GET ALL PREVIEW PROJECTS ================
function getPreviewProjects() {
  const sh   = ensurePreviewSheet();
  const data = sh.getDataRange().getValues();
  if (data.length <= 1) return [];

  return data.slice(1)
    .filter(r => r[0])
    .map(r => ({
      id:        r[0],
      project:   r[1],
      client:    r[2],
      folderId:  r[3],
      driveUrl:  r[4],
      createdAt: r[5] ? new Date(r[5]).toLocaleDateString("id-ID") : "-"
    }));
}

// ================ API: GET PREVIEW IMAGES ================
function getPreviewImages(id) {
  if (!id) throw new Error("ID project diperlukan");

  const proj   = getPreviewProject(id);
  const folder = DriveApp.getFolderById(proj.folderId);
  const files  = folder.getFiles();
  const images = [];

  while (files.hasNext()) {
    const f = files.next();
    if (!f.getMimeType().includes("image")) continue;
    const fileId = f.getId();
    images.push({
      name:    f.getName(),
      url:     "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w800",
      fullUrl: "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w1600"
    });
  }

  return images.sort((a, b) => a.name.localeCompare(b.name));
}

// ================ API: DELETE PREVIEW PROJECT ================
function deletePreviewProject(id) {
  if (!id) throw new Error("ID diperlukan");

  const sh   = ensurePreviewSheet();
  const data = sh.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == id) {
      sh.deleteRow(i + 1);
      return true;
    }
  }

  throw new Error("Project preview tidak ditemukan");
}
