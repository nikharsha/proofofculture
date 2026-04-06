const defaultMaxSupply = 1500;
const defaultProjectDays = 365;
const baseStart = new Date("2026-03-17T13:00:00Z");
const defaultActiveEpochNumber = 7;
const protocolStateKey = "proof-of-culture-protocol-state";
const adminSettingsHandleDbName = "proof-of-culture-admin";
const adminSettingsHandleStore = "handles";
const adminSettingsHandleKey = "settings-file";
const galleryAssetSourceHandleKey = "gallery-assets-source";
const galleryAssetTargetHandleKey = "gallery-assets-target";
const hostedAdminSettingsPath = "data/admin_settings_live.json";
const trackerCsvPath = "data/proof_of_culture_tracker_master.csv";
const editionPalette = [69, 42, 33, 25, 11, 5, 1];
const minimumTotalEpochs = 50;
const minimumEditionCounts = {
  1: 10,
  5: 3,
  11: 3,
  25: 2,
  33: 2,
  42: 2,
  69: 2
};
const ludicrousPattern = [10, 18, 31, 12, 46, 14, 57, 21, 69, 11, 38, 16, 63, 24, 52, 13, 41, 27, 58, 19];

const actualEpochHistory = [
  { epoch: 1, phase: "Pilot", eligible: 44, minted: 34, walletNotShared: 10, start: new Date("2026-03-17T13:00:00Z"), end: new Date("2026-03-18T13:00:00Z"), daysNeeded: 1, eligibility: "QRT + Comment" },
  { epoch: 2, phase: "Pilot", eligible: 16, minted: 15, walletNotShared: 1, start: new Date("2026-03-18T13:00:00Z"), end: new Date("2026-03-19T13:00:00Z"), daysNeeded: 1, eligibility: "QRT + Comment" },
  { epoch: 3, phase: "Pilot", eligible: 42, minted: 35, walletNotShared: 6, start: new Date("2026-03-19T13:00:00Z"), end: new Date("2026-03-20T13:00:00Z"), daysNeeded: 1, eligibility: "QRT + Comment" },
  { epoch: 4, phase: "Pilot", eligible: 61, minted: 45, walletNotShared: 16, start: new Date("2026-03-20T13:00:00Z"), end: new Date("2026-03-21T13:00:00Z"), daysNeeded: 1, eligibility: "QRT + Comment" },
  { epoch: 5, phase: "Pilot", eligible: 40, minted: 37, walletNotShared: 3, start: new Date("2026-03-21T13:00:00Z"), end: new Date("2026-03-23T13:00:00Z"), daysNeeded: 2, eligibility: "QRT + Comment" },
  { epoch: 6, phase: "Pilot", eligible: 56, minted: 53, walletNotShared: 13, start: new Date("2026-03-23T13:00:00Z"), end: new Date("2026-03-26T13:00:00Z"), daysNeeded: 3, eligibility: "QRT + Comment" }
];

const specialDrops = [
  { name: "Special 1", source: "Group chat lucky draw", minted: 1, status: "Raffled on March 25, 2026", date: new Date("2026-03-25T13:00:00Z") }
];

const currentEpochOverride = {
  epoch: 7,
  phase: "Pilot",
  daysNeeded: 1,
  eligibility: "QRT + Comment",
  editionSize: 1,
  start: new Date("2026-03-26T13:00:00Z"),
  end: new Date("2026-03-27T13:00:00Z"),
  cumulativePlanned: actualEpochHistory.reduce((sum, item) => sum + item.minted, 0) + specialDrops.reduce((sum, item) => sum + item.minted, 0) + 1,
  actualMinted: null
};

let trackerData = null;
let protocolStateCache = getDefaultProtocolState();
let adminSettingsFileHandle = null;
let galleryAssetSourceDirHandle = null;
let galleryAssetTargetDirHandle = null;
let galleryAssetLastRefreshSummary = "";
let forceEpochPlanRebuild = false;
const materializedSchedule = {
  dirty: true,
  epochPlan: [],
  shiftedEpochs: [],
  mergedEpochs: []
};

function serializeScheduleEntry(entry) {
  return {
    ...entry,
    start: entry.start instanceof Date ? entry.start.toISOString() : entry.start,
    end: entry.end instanceof Date ? entry.end.toISOString() : entry.end
  };
}

function reviveScheduleEntry(entry) {
  return {
    ...entry,
    start: new Date(entry.start),
    end: new Date(entry.end)
  };
}

function buildPersistedPayload() {
  recomputeMaterializedSchedule();
  return {
    exportedAt: new Date().toISOString(),
    protocolState: protocolStateCache,
    materializedSchedule: {
      epochPlan: materializedSchedule.epochPlan.map(serializeScheduleEntry),
      shiftedEpochs: materializedSchedule.shiftedEpochs.map(serializeScheduleEntry),
      mergedEpochs: materializedSchedule.mergedEpochs.map(serializeScheduleEntry)
    }
  };
}

function applyMaterializedScheduleSnapshot(snapshot) {
  if (!snapshot?.epochPlan?.length) {
    materializedSchedule.dirty = true;
    return;
  }

  materializedSchedule.epochPlan = (snapshot.epochPlan || []).map(reviveScheduleEntry);
  materializedSchedule.shiftedEpochs = (snapshot.shiftedEpochs || []).map(reviveScheduleEntry);
  materializedSchedule.mergedEpochs = (snapshot.mergedEpochs || []).map(reviveScheduleEntry);
  materializedSchedule.dirty = true;
}

function parsePersistedPayload(parsed) {
  return {
    protocolState: { ...getDefaultProtocolState(), ...(parsed?.protocolState || parsed || {}) },
    materializedSchedule: parsed?.materializedSchedule || null
  };
}

function getDefaultProtocolState() {
  return {
    currentEpochNumber: defaultActiveEpochNumber,
    liveEntryKey: `epoch-${defaultActiveEpochNumber}`,
    delayDays: 0,
    extensionDays: 0,
    paused: false,
    onChainDraws: false,
    override: null,
    timelineAdjustments: [],
    manualEpochs: [],
    eligibilityOverrides: [],
    tweetRecords: [],
    engagementOverrides: [],
    drawRecords: [],
    galleryOverrides: [],
    projectDays: defaultProjectDays,
    maxSupply: defaultMaxSupply,
    refactorMode: "maxSupply"
  };
}

function getProtocolState() {
  return protocolStateCache;
}

function hasAdminUi() {
  return Boolean(document.getElementById("panel-admin"));
}

function setProtocolState(nextState) {
  protocolStateCache = { ...getDefaultProtocolState(), ...nextState };
  window.localStorage.setItem(protocolStateKey, JSON.stringify(protocolStateCache));
  materializedSchedule.dirty = true;
  syncAdminSettingsStatus();
  void persistProtocolStateToFile();
}

function downloadJsonFile(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadFile(filename, content, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function loadProtocolStateFromLocalStorage() {
  const raw = window.localStorage.getItem(protocolStateKey);
  if (!raw) return getDefaultProtocolState();
  try {
    return { ...getDefaultProtocolState(), ...JSON.parse(raw) };
  } catch (_) {
    return getDefaultProtocolState();
  }
}

function openAdminSettingsDb() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(adminSettingsHandleDbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(adminSettingsHandleStore)) {
        db.createObjectStore(adminSettingsHandleStore);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveHandleToDb(key, handle) {
  if (!window.indexedDB) return;
  const db = await openAdminSettingsDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(adminSettingsHandleStore, "readwrite");
    tx.objectStore(adminSettingsHandleStore).put(handle, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadHandleFromDb(key) {
  if (!window.indexedDB) return null;
  const db = await openAdminSettingsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(adminSettingsHandleStore, "readonly");
    const request = tx.objectStore(adminSettingsHandleStore).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function saveAdminSettingsHandle(handle) {
  return saveHandleToDb(adminSettingsHandleKey, handle);
}

async function loadAdminSettingsHandle() {
  return loadHandleFromDb(adminSettingsHandleKey);
}

async function readProtocolStateFromFileHandle(handle) {
  const file = await handle.getFile();
  const raw = await file.text();
  const parsed = JSON.parse(raw);
  return parsePersistedPayload(parsed);
}

async function loadProtocolStateFromHostedJson() {
  try {
    const response = await fetch(hostedAdminSettingsPath, { cache: "no-store" });
    if (!response.ok) return null;
    const parsed = JSON.parse(await response.text());
    return parsePersistedPayload(parsed);
  } catch (_) {
    return null;
  }
}

async function persistProtocolStateToFile() {
  if (!adminSettingsFileHandle) return;
  try {
    const permission = await adminSettingsFileHandle.queryPermission({ mode: "readwrite" });
    if (permission !== "granted") return;
    const writable = await adminSettingsFileHandle.createWritable();
    await writable.write(JSON.stringify(buildPersistedPayload(), null, 2));
    await writable.close();
    syncAdminSettingsStatus();
  } catch (_) {
    syncAdminSettingsStatus("Connected file could not be updated. Reconnect the settings file.");
  }
}

function syncAdminSettingsStatus(customMessage = "") {
  const node = document.getElementById("admin-settings-status");
  if (!node) return;
  if (customMessage) {
    node.textContent = customMessage;
    return;
  }
  if (adminSettingsFileHandle?.name) {
    node.textContent = `Connected to ${adminSettingsFileHandle.name}. The local site is previewing that file, and admin changes auto-save there.`;
    return;
  }
  node.textContent = "Using browser storage until a settings file is connected.";
}

function getManualEpochs() {
  return (getProtocolState().manualEpochs || []).map((item) => ({
    ...item,
    start: new Date(item.start),
    end: new Date(item.end)
  })).sort((a, b) => a.start - b.start || a.end - b.end);
}

function getLiveEntryKey() {
  return getProtocolState().liveEntryKey || `epoch-${getCurrentEpochNumber()}`;
}

function getTweetRecords() {
  return (getProtocolState().tweetRecords || [])
    .map((item) => ({ ...item, dayNumber: Number(item.dayNumber || 0) }))
    .sort((a, b) => {
      const keyCompare = String(a.targetKey || "").localeCompare(String(b.targetKey || ""));
      if (keyCompare !== 0) return keyCompare;
      return Number(a.dayNumber || 0) - Number(b.dayNumber || 0);
    });
}

function getEffectiveLiveEntryKey() {
  const merged = getMergedEpochs();
  const manualLive = merged.find((item) => item.type === "manual" && item.manualStatus === "live");
  if (manualLive) return manualLive.key;

  const now = Date.now();
  const currentByTime = merged.find((item) => (
    item.start.getTime() <= now &&
    now < item.end.getTime() &&
    !(item.type === "manual" && item.manualStatus === "complete")
  ));
  if (currentByTime) return currentByTime.key;

  return getLiveEntryKey();
}

function getEpochMintedCount(epoch) {
  if (!epoch) return 0;
  if (epoch.type === "manual") return Number(epoch.minted || 0);
  return Number(trackerData?.epochSummary?.[epoch.epoch]?.minted ?? epoch.minted ?? epoch.actualMinted ?? 0);
}

function isEpochInWalletCollection(epoch) {
  if (!epoch || epoch.type === "manual") return false;
  if (Date.now() < epoch.end.getTime()) return false;
  return getEpochMintedCount(epoch) === 0;
}

function getConfiguredProjectDays() {
  return Math.max(1, Number(getProtocolState().projectDays || defaultProjectDays));
}

function getConfiguredMaxSupply() {
  return Math.max(1, Number(getProtocolState().maxSupply || defaultMaxSupply));
}

function getRefactorMode() {
  return getProtocolState().refactorMode || "maxSupply";
}

function getConfiguredTargetEnd() {
  return addDays(baseStart, getConfiguredProjectDays() - 1);
}

function getTimelineAdjustments() {
  return (getProtocolState().timelineAdjustments || []).map((item) => ({ ...item }));
}

function getEngagementOverrides() {
  return (getProtocolState().engagementOverrides || []).map((item) => ({ ...item }));
}

function getEffectiveMaxSupply() {
  const epochPlan = getEpochPlan();
  return epochPlan.length ? epochPlan[epochPlan.length - 1].cumulativePlanned : getConfiguredMaxSupply();
}

function getEffectiveProjectEnd() {
  const merged = getMergedEpochs();
  return merged.length ? merged[merged.length - 1].end : getConfiguredTargetEnd();
}

function getDefaultEligibilityForEditionSize(editionSize) {
  const size = Number(editionSize || 0);
  if (size === 1 || size === 5) return "QRT + Comment";
  if (size >= 10 && size <= 70) return "Comment or QRT";
  return "Comment or QRT";
}

function getEligibilityOverrides() {
  return (getProtocolState().eligibilityOverrides || []).map((item) => ({ ...item }));
}

function getGalleryOverrides() {
  return (getProtocolState().galleryOverrides || []).map((item) => ({ ...item }));
}

function resolveEligibilityOverride(targetKey, fallback) {
  const match = getEligibilityOverrides().find((item) => item.targetKey === targetKey);
  if (!match) return fallback;
  if (match.mode === "Custom") {
    return match.customText?.trim() || fallback;
  }
  return match.mode || fallback;
}

function getEligibilityDisplay(mode, customText = "") {
  return mode === "Custom" ? (customText.trim() || "Custom") : mode;
}

function getEffectiveEligibleCount(eligibilityRule, buckets) {
  const rule = String(eligibilityRule || "").trim().toLowerCase();
  const qrtComment = Number(buckets.qrtComment || 0);
  const onlyQrt = Number(buckets.onlyQrt || 0);
  const onlyComment = Number(buckets.onlyComment || 0);
  const onlyRt = Number(buckets.onlyRt || 0);

  if (rule === "qrt + comment") return qrtComment;
  if (rule === "comment only") return onlyComment;
  if (rule === "qrt only") return onlyQrt;
  if (rule === "rt only") return onlyRt;
  if (rule === "comment or qrt") return qrtComment + onlyQrt + onlyComment;
  if (rule === "rt + comment") return qrtComment || Math.min(onlyRt, qrtComment + onlyComment);
  return qrtComment + onlyQrt + onlyComment;
}

function parseManualRecipients(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|").map((part) => part.trim());
      return {
        user: parts[0] || "",
        wallet: parts[1] || "",
        count: Math.max(1, Number(parts[2] || 1) || 1)
      };
    })
    .filter((item) => item.user);
}

function serializeManualRecipients(list) {
  return (list || [])
    .map((item) => [item.user || "", item.wallet || "", item.count || 1].join(" | "))
    .join("\n");
}

function getMergedEpochs() {
  recomputeMaterializedSchedule();
  return materializedSchedule.mergedEpochs;
}

const openseaBaseUrl = "https://opensea.io/item/ethereum/0x9bb456e4c65e2d017d755e058b1652b1d225a856";
const defaultKnownWebAssets = [
  "web_assets/day1-bw.jpg",
  "web_assets/day1-r.jpg",
  "web_assets/day1-g.jpg",
  "web_assets/day1-b.jpg",
  "web_assets/day2-g1-final.jpg",
  "web_assets/day2-g2-final.jpg",
  "web_assets/day3-g1-final.jpg",
  "web_assets/day3-g2-final.jpg",
  "web_assets/day4-1-final.jpg",
  "web_assets/day4-2-final.jpg",
  "web_assets/day5-1.jpg",
  "web_assets/day5-2.jpg",
  "web_assets/day6-1.jpg",
  "web_assets/day6-2.jpg",
  "web_assets/dm gm 1.jpg",
  "web_assets/epoch7.jpg"
];
let knownWebAssets = [...defaultKnownWebAssets];

function getKnownWebAssets() {
  return [...new Set(knownWebAssets)];
}

function isSupportedImageAsset(path) {
  return /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(String(path || ""));
}

function normalizeWebAssetPath(input) {
  const value = String(input || "").trim();
  if (!value) return "";
  const decoded = value.startsWith("http")
    ? decodeURIComponent(new URL(value, window.location.origin).pathname)
    : decodeURIComponent(value);
  const cleaned = decoded
    .replace(/^\.\//, "")
    .replace(/^\//, "");
  return cleaned.startsWith("web_assets/") ? cleaned : `web_assets/${cleaned.replace(/^web_assets\//, "")}`;
}

function humanizeAssetName(path) {
  const fileName = String(path || "").split("/").pop() || "";
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");
  return withoutExtension
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "Untitled";
}

function getDraftGalleryMetadataFromAsset(path) {
  const fileName = String(path || "").split("/").pop() || "";
  const stem = fileName.replace(/\.[^.]+$/, "");
  const lower = stem.toLowerCase().trim();
  const epochMatch = lower.match(/^epoch\s*(\d+)(?:[^\d]+(\d+))?$/) || lower.match(/^epoch(\d+)(?:[^\d]+(\d+))?$/);
  if (epochMatch) {
    const epochNumber = epochMatch[1];
    const variant = epochMatch[2] || "0";
    return {
      title: `GM ${epochNumber}.${variant}`,
      epochName: epochNumber
    };
  }

  const numberMatches = lower.match(/\d+/g) || [];
  const specialNumber = numberMatches[0] || "1";
  const specialVariant = numberMatches[1] || "0";
  return {
    title: `Special ${specialNumber}.${specialVariant}`,
    epochName: `Special ${specialNumber}`
  };
}

async function fetchWebAssetsFromDirectory() {
  const response = await fetch("web_assets/", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not read web_assets directory (${response.status})`);
  }
  const html = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const assets = Array.from(doc.querySelectorAll("a"))
    .map((link) => normalizeWebAssetPath(link.getAttribute("href") || link.textContent || ""))
    .filter((path) => path.startsWith("web_assets/") && isSupportedImageAsset(path));
  return [...new Set(assets)].sort((a, b) => a.localeCompare(b));
}

function canUseDirectoryPicker() {
  return typeof window.showDirectoryPicker === "function";
}

async function ensureGalleryDirectoryHandles() {
  if (!canUseDirectoryPicker()) {
    throw new Error("Directory picker unsupported in this browser.");
  }

  if (!galleryAssetSourceDirHandle) {
    galleryAssetSourceDirHandle = await loadHandleFromDb(galleryAssetSourceHandleKey);
  }
  if (!galleryAssetTargetDirHandle) {
    galleryAssetTargetDirHandle = await loadHandleFromDb(galleryAssetTargetHandleKey);
  }

  let sourcePermission = galleryAssetSourceDirHandle
    ? await galleryAssetSourceDirHandle.queryPermission({ mode: "read" })
    : "prompt";
  if (!galleryAssetSourceDirHandle || sourcePermission !== "granted") {
    galleryAssetSourceDirHandle = await window.showDirectoryPicker({ mode: "read" });
    await saveHandleToDb(galleryAssetSourceHandleKey, galleryAssetSourceDirHandle);
    sourcePermission = await galleryAssetSourceDirHandle.requestPermission({ mode: "read" });
  }

  let targetPermission = galleryAssetTargetDirHandle
    ? await galleryAssetTargetDirHandle.queryPermission({ mode: "readwrite" })
    : "prompt";
  if (!galleryAssetTargetDirHandle || targetPermission !== "granted") {
    galleryAssetTargetDirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    await saveHandleToDb(galleryAssetTargetHandleKey, galleryAssetTargetDirHandle);
    targetPermission = await galleryAssetTargetDirHandle.requestPermission({ mode: "readwrite" });
  }

  if (sourcePermission !== "granted" || targetPermission !== "granted") {
    throw new Error("Directory permissions were not granted.");
  }

  return {
    source: galleryAssetSourceDirHandle,
    target: galleryAssetTargetDirHandle
  };
}

async function resizeImageForWeb(file) {
  const bitmap = await createImageBitmap(file);
  const targetWidth = Math.min(bitmap.width, 2560);
  const targetHeight = Math.max(1, Math.round((bitmap.height / bitmap.width) * targetWidth));
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d", { alpha: false });
  context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not encode resized image."));
        return;
      }
      resolve(blob);
    }, "image/jpeg", 0.85);
  });
}

async function syncAssetsIntoWebAssets() {
  const { source, target } = await ensureGalleryDirectoryHandles();
  const processed = [];

  for await (const [name, handle] of source.entries()) {
    if (handle.kind !== "file" || !isSupportedImageAsset(name)) continue;
    const baseName = name.replace(/\.[^.]+$/, "");
    const normalizedTargetName = `${baseName}.jpg`;
    let targetExists = false;
    for (const candidateName of [`${baseName}.jpg`, `${baseName}.jpeg`, `${baseName}.png`]) {
      try {
        await target.getFileHandle(candidateName);
        targetExists = true;
        break;
      } catch (_) {}
    }
    if (targetExists) continue;

    const sourceFile = await handle.getFile();
    const resizedBlob = await resizeImageForWeb(sourceFile);
    const writableHandle = await target.getFileHandle(normalizedTargetName, { create: true });
    const writable = await writableHandle.createWritable();
    await writable.write(resizedBlob);
    await writable.close();
    processed.push(`web_assets/${normalizedTargetName}`);
  }

  return processed;
}

function syncGalleryAssetStatus(message = "") {
  const node = document.getElementById("gallery-asset-status");
  if (!node) return;

  if (message) {
    node.textContent = message;
    return;
  }

  const sourceName = galleryAssetSourceDirHandle?.name || "not connected";
  const targetName = galleryAssetTargetDirHandle?.name || "not connected";
  const baseMessage = `Source assets folder: ${sourceName}. Target web_assets folder: ${targetName}.`;
  node.textContent = galleryAssetLastRefreshSummary
    ? `${baseMessage} ${galleryAssetLastRefreshSummary}`
    : `${baseMessage} You can also manually copy processed files into web_assets and then refresh to draft them into the gallery.`;
}

function buildDraftGalleryOverride(token, image) {
  const derived = getDraftGalleryMetadataFromAsset(image);
  return {
    token,
    title: derived.title || humanizeAssetName(image),
    epochName: derived.epochName || "",
    edition: "",
    os: `${openseaBaseUrl}/${token}`,
    image,
    mark: `#${String(token).padStart(3, "0")}`
  };
}

async function refreshGalleryAssetList() {
  syncGalleryAssetStatus("Refreshing assets and gallery list…");

  try {
    let processedAssets = [];
    if (hasAdminUi() && canUseDirectoryPicker()) {
      try {
        processedAssets = await syncAssetsIntoWebAssets();
      } catch (error) {
        console.warn(error);
      }
    }
    const scannedAssets = await fetchWebAssetsFromDirectory();
    knownWebAssets = [...new Set([...defaultKnownWebAssets, ...scannedAssets])];

    const state = getProtocolState();
    const existingItems = getGalleryItems();
    const usedImages = new Set(existingItems.map((item) => item.image).filter(Boolean));
    let nextToken = Math.max(0, ...existingItems.map((item) => Number(item.token) || 0)) + 1;
    const draftOverrides = [];

    getKnownWebAssets().forEach((assetPath) => {
      if (usedImages.has(assetPath)) return;
      draftOverrides.push(buildDraftGalleryOverride(nextToken, assetPath));
      usedImages.add(assetPath);
      nextToken += 1;
    });

    if (draftOverrides.length) {
      setProtocolState({
        ...state,
        galleryOverrides: [...(state.galleryOverrides || []), ...draftOverrides]
      });
    }

    const resizedMessage = processedAssets.length
      ? `Resized ${processedAssets.length} new ${processedAssets.length === 1 ? "image" : "images"} into web_assets.`
      : "No new source images needed resizing.";
    const draftMessage = draftOverrides.length
      ? `Added ${draftOverrides.length} new draft ${draftOverrides.length === 1 ? "entry" : "entries"} for editing.`
      : "No new gallery draft entries were needed.";
    galleryAssetLastRefreshSummary = `${resizedMessage} ${draftMessage}`;
    renderDelayState();
  } catch (error) {
    galleryAssetLastRefreshSummary = "Could not refresh assets automatically. Make sure the site is running from a local web server with directory listing enabled for web_assets.";
    syncGalleryAssetStatus();
    console.error(error);
  }
}

function getSpecialEpochAsset() {
  return getKnownWebAssets().find((path) => {
    const file = path.split("/").pop()?.toLowerCase() || "";
    return file && !file.startsWith("day") && !file.startsWith("epoch");
  }) || "";
}

const galleryBase = [
  { token: 1, title: "First GM - b&w", epochName: "1", image: "web_assets/day1-bw.jpg", editionSize: "1/1" },
  { token: 2, title: "First GM - r", epochName: "1", image: "web_assets/day1-r.jpg", editionSize: "1/1" },
  { token: 3, title: "First GM - g", epochName: "1", image: "web_assets/day1-g.jpg", editionSize: "13 editions" },
  { token: 4, title: "First GM - b", epochName: "1", image: "web_assets/day1-b.jpg", editionSize: "19 editions" },
  { token: 5, title: "GM 2.0", epochName: "2", image: "web_assets/day2-g1-final.jpg", editionSize: "5 editions" },
  { token: 6, title: "GM 2.1", epochName: "2", image: "web_assets/day2-g2-final.jpg", editionSize: "10 editions" },
  { token: 7, title: "GM 3.0", epochName: "3", image: "web_assets/day3-g1-final.jpg", editionSize: "7 editions" },
  { token: 8, title: "GM 3.1", epochName: "3", image: "web_assets/day3-g2-final.jpg", editionSize: "28 editions" },
  { token: 9, title: "GM 4.1", epochName: "4", image: "web_assets/day4-1-final.jpg", editionSize: "7 editions" },
  { token: 10, title: "GM 4.2", epochName: "4", image: "web_assets/day4-2-final.jpg", editionSize: "38 editions" },
  { token: 11, title: "GM 5.1", epochName: "5", image: "web_assets/day5-1.jpg", editionSize: "13 editions" },
  { token: 12, title: "GM 5.2", epochName: "5", image: "web_assets/day5-2.jpg", editionSize: "24 editions" },
  { token: 13, title: "dm gm 1.0", epochName: "Special 1", image: getSpecialEpochAsset(), editionSize: "1/1" },
  { token: 14, title: "GM 6.1", epochName: "6", image: "web_assets/day6-1.jpg", editionSize: "34 editions" },
  { token: 15, title: "GM 6.2", epochName: "6", image: "web_assets/day6-2.jpg", editionSize: "19 editions" },
  { token: 16, title: "GM 7.0", epochName: "7", image: "web_assets/epoch7.jpg", editionSize: "1/1" }
].map((item) => ({
  ...item,
  status: "Issued",
  edition: item.editionSize,
  mark: `#${String(item.token).padStart(3, "0")}`,
  os: `${openseaBaseUrl}/${item.token}`,
  sales: `${openseaBaseUrl}/${item.token}`
}));

function getGalleryItems() {
  const overrides = getGalleryOverrides();
  const overrideMap = new Map(overrides.map((item) => [String(item.token), item]));
  const mergedBase = galleryBase.map((item) => {
    const override = overrideMap.get(String(item.token));
    return override ? {
      ...item,
      ...override,
      token: Number(override.token || item.token),
      edition: override.edition || item.edition
    } : item;
  });
  const extraOverrides = overrides
    .filter((item) => !galleryBase.some((baseItem) => Number(baseItem.token) === Number(item.token)))
    .map((item) => ({
      status: "Issued",
      mark: `#${String(item.token).padStart(3, "0")}`,
      sales: item.os || `${openseaBaseUrl}/${item.token}`,
      ...item,
      token: Number(item.token || 0),
      edition: item.edition || ""
    }));

  return [...mergedBase, ...extraOverrides].sort((a, b) => Number(a.token) - Number(b.token));
}

function getGalleryItemByToken(token) {
  return getGalleryItems().find((item) => Number(item.token) === Number(token)) || null;
}

function getGalleryItemsForEpoch(epochName) {
  return getGalleryItems().filter((item) => String(item.epochName || "") === String(epochName || ""));
}

function buildFlowerEntriesForEpoch(epochName, mintedCount) {
  const count = Number(mintedCount || 0);
  if (count <= 0) return [];
  return [{
    epochName: String(epochName || ""),
    mintedCount: count
  }];
}

function mergeFlowerEntries(existing, incoming) {
  const merged = new Map();
  [...(existing || []), ...(incoming || [])].forEach((item) => {
    const key = String(item.epochName || "");
    if (!merged.has(key)) {
      merged.set(key, { ...item });
      return;
    }
    const previous = merged.get(key);
    merged.set(key, {
      ...previous,
      mintedCount: Math.max(Number(previous.mintedCount || 0), Number(item.mintedCount || 0))
    });
  });
  return Array.from(merged.values()).sort((a, b) => Number(a.token || 0) - Number(b.token || 0));
}

const winners = [
  { wallet: "0x7cf1...913b", epoch: "Epoch 01", edition: "#03 / 44" },
  { wallet: "0x29aa...e182", epoch: "Epoch 02", edition: "#07 / 16" },
  { wallet: "0x901c...4ab1", epoch: "Epoch 03", edition: "#01 / 43" },
  { wallet: "0xa6d2...f0ce", epoch: "Epoch 04", edition: "#05 / 48" },
  { wallet: "0x0be8...19c4", epoch: "Epoch 05", edition: "#15 / 49" }
];

const leaderboard = [];

const summaryCards = [
  { label: "Supply", value: `${defaultMaxSupply.toLocaleString()}`, note: "The supply ceiling is fixed, and each edition size is capped at 69. No extra editions appear just because demand grows." },
  { label: "Pilot phase", value: "Epochs 1-7", note: "The pilot keeps the interaction simple and visible while the process, data collection, and public understanding settle in." },
  { label: "Linear phase", value: "Starts at Epoch 8", note: "The linear phase starts at 4 days in Epoch 8 and then increases by one day each epoch, so the burden rises gradually before the steeper curve begins." },
  { label: "Ludicrous phase", value: "Longer back half", note: "The ludicrous phase swings much harder, with days-needed jumps that stay between 10 and 69 while the social action itself stays simple." }
];

const mechanicsRules = [
  {
    label: "Start with the site",
    value: "Check Current Epoch first",
    note: "The website tells you the active window, the phase, and the exact eligibility pattern before you engage."
  },
  {
    label: "Follow the epoch rule",
    value: "Interact as required",
    note: "For Pilot, that is currently QRT plus Comment. Later phases raise the streak requirement while keeping the action itself simple."
  },
  {
    label: "Share wallet when prompted",
    value: "Only after the roster call",
    note: "If you have already shared a wallet in an earlier epoch, you do not need to do it again unless you want to update it. The latest wallet shared is the one used for airdrops."
  },
  {
    label: "Draw or direct airdrop",
    value: "Overflow decides the luck layer",
    note: "If the final roster fits inside the epoch cap, wallets get the airdrop directly. If it overflows, a draw decides the recipients."
  }
];

const fairnessCards = [
  {
    label: "Trigger",
    value: "wallets > edition size",
    note: "The contract only runs when the frozen valid roster is larger than the epoch cap."
  },
  {
    label: "Input",
    value: "epoch wallet roster",
    note: "You freeze the final wallet list for the epoch and submit that roster to the wallet picker (manual/contract)."
  },
  {
    label: "Output",
    value: "Winners",
    note: "Winners picked at random from the input list to match the edition size limits of the epoch."
  },
  {
    label: "Current Draw Mode",
    value: "Manual",
    note: "On-chain contract will be created in a few days to migrate to provable fairness."
  }
];

const heroQuotes = [
  "GM is Life.",
  "GMs are free.",
  "Flowers for every gm.",
  "Because what are we without culture?",
  "Proof is in the gm.",
  "Culture: if you got it, you say it back.",
  "A ritual is still a ritual when nobody forces it.",
  "Tiny actions. Long memory.",
  "Culture compounds when people come back.",
  "One gm can still mean something.",
  "Presence is the point.",
  "The timeline forgets fast. Ritual does not.",
  "Say it back and mean it.",
  "The gm is small. The culture is not.",
  "A timeline full of gm still feels alive.",
  "Some drops are luck. Showing up is not.",
  "A good morning can be a public good.",
  "Consistency is louder than hype.",
  "This started with a gm and stayed for the people.",
  "Return to sender: 2021 gm energy.",
  "Culture is a habit you practice together.",
  "It is the time you have wasted for your rose that makes your rose so important. - Antoine de Saint-Exupery"
];

const formulaRows = [
  {
    rule: "Pilot rule",
    formula: "Simple eligibility, short windows, manual execution",
    meaning: "The pilot keeps the mechanics legible while participation data and public understanding build up.",
    effect: "Epoch 7 remains inside this simpler operating mode.",
    bound: "Runs through Epoch 7"
  },
  {
    rule: "Linear rule",
    formula: "daysNeeded(e)=e-4 for e=8..19",
    meaning: "Epoch 8 needs 4 consecutive days, and the requirement adds one day each epoch through Epoch 19.",
    effect: "Difficulty rises by exactly one day each epoch",
    bound: "12 epochs only"
  },
  {
    rule: "Ludicrous rule",
    formula: "daysNeeded(e) swings inside [10, 69] after the linear ramp",
    meaning: "After linear, the required streak becomes much less predictable while staying bounded between 10 and 69 days.",
    effect: "Later epochs can jump sharply instead of rising smoothly",
    bound: "Never below 10 and never above 69"
  },
  {
    rule: "Edition schedule",
    formula: "Generated from refactor target + palette constraints",
    meaning: "The cap is rebuilt from the chosen refactor mode while still respecting minimum epoch count and edition-size distribution floors.",
    effect: "No hand-wavy ladder and no palette collapse into only large editions",
    bound: "Max epoch size remains 69"
  },
  {
    rule: "Luck factor",
    formula: "overflow draw + low-signal API edge cases",
    meaning: "Luck mainly enters when valid wallets exceed the cap, but edge-case collection misses also matter at the margin.",
    effect: "The final roster is not purely deterministic even when the action is simple.",
    bound: "Publicly acknowledged on-site"
  }
];

const optionalSchedule = [
  {
    window: "Whenever slot bank > 0",
    use: "Open a manual paid mint",
    slots: "Exactly the current slot bank",
    range: "1 to current bank",
    pricing: "Manual, rising over time"
  },
  {
    window: "Earlier linear phase",
    use: "More frequent paid opportunities",
    slots: "Banked from recent underfills",
    range: "Can support larger paid editions",
    pricing: "Lower than late-stage access"
  },
  {
    window: "Late ludicrous phase",
    use: "Less frequent paid opportunities",
    slots: "Usually smaller because caps are tighter and draws are more likely",
    range: "Can compress to 1/1 or micro-editions",
    pricing: "Higher and scarcer"
  }
];

const adminActions = [
  {
    label: "Add delay",
    value: "Shift current + future windows",
    note: "Use when gm posting, wallet collection, or airdrops slip. The website shifts all later windows forward."
  },
  {
    label: "Record actual mint",
    value: "Update public epoch state",
    note: "Production should let admin store the actual minted count and close out the epoch cleanly once processing is done."
  },
  {
    label: "Publish draw proof",
    value: "Attach contract receipt",
    note: "When a draw runs, the website should link the tx hash and final winner list to that epoch."
  },
  {
    label: "Open paid mint",
    value: "Manual paid mint window",
    note: "The control surface can later be extended so paid mint windows are published and closed from the same admin area."
  }
];

function formatDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function formatDateTimeUTC(date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "UTC"
  }).format(date).replace(":00 ", " ") + " UTC";
}

function diffDaysInclusive(start, end) {
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.floor((end - start) / oneDay) + 1;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function spreadEditionSequence(sequence) {
  const counts = sequence.reduce((map, size) => {
    map.set(size, (map.get(size) || 0) + 1);
    return map;
  }, new Map());
  const result = [];
  let previous = null;

  while (result.length < sequence.length) {
    const nextSize = [...counts.entries()]
      .filter(([, count]) => count > 0)
      .sort((a, b) => {
        if (a[0] === previous) return 1;
        if (b[0] === previous) return -1;
        if (b[1] !== a[1]) return b[1] - a[1];
        return editionPalette.indexOf(a[0]) - editionPalette.indexOf(b[0]);
      })[0]?.[0];
    if (nextSize == null) break;
    result.push(nextSize);
    counts.set(nextSize, counts.get(nextSize) - 1);
    previous = nextSize;
  }

  return result;
}

function buildMinimumBase(minimumCounts) {
  return Object.entries(minimumCounts).flatMap(([size, count]) =>
    Array.from({ length: count }, () => Number(size))
  );
}

function buildEditionSequence(epochCount, totalTarget = null, minimumCounts = minimumEditionCounts) {
  const minimumBase = buildMinimumBase(minimumCounts);
  if (epochCount < minimumBase.length) return null;

  const baseSum = minimumBase.reduce((sum, size) => sum + size, 0);
  const remainingCount = epochCount - minimumBase.length;

  if (totalTarget == null) {
    const filler = Array.from({ length: remainingCount }, (_, index) => editionPalette[index % editionPalette.length]);
    return spreadEditionSequence([...minimumBase, ...filler]);
  }

  const remainingTarget = totalTarget - baseSum;
  if (remainingTarget < remainingCount || remainingTarget > remainingCount * Math.max(...editionPalette)) return null;

  const dp = Array.from({ length: remainingCount + 1 }, () => new Map());
  dp[0].set(0, null);

  for (let count = 0; count < remainingCount; count += 1) {
    for (const [sum] of dp[count].entries()) {
      for (const size of editionPalette) {
        const nextSum = sum + size;
        if (nextSum > remainingTarget || dp[count + 1].has(nextSum)) continue;
        dp[count + 1].set(nextSum, { prevSum: sum, size });
      }
    }
  }

  if (!dp[remainingCount].has(remainingTarget)) return null;

  const filler = [];
  let cursorCount = remainingCount;
  let cursorSum = remainingTarget;
  while (cursorCount > 0) {
    const step = dp[cursorCount].get(cursorSum);
    filler.push(step.size);
    cursorSum = step.prevSum;
    cursorCount -= 1;
  }

  return spreadEditionSequence([...minimumBase, ...filler.reverse()]);
}

function getAdjustedMinimumEditionCounts(epochCount, totalTarget) {
  const scales = [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15, 0.1, 0.05, 0];
  const requiredPresenceSizes = new Set([69, 42, 33, 25, 11, 5, 1]);

  for (const scale of scales) {
    const adjusted = Object.fromEntries(
      Object.entries(minimumEditionCounts).map(([size, count]) => {
        const numericSize = Number(size);
        const floor = requiredPresenceSizes.has(numericSize) ? 1 : 0;
        return [size, Math.max(floor, Math.floor(count * scale))];
      })
    );
    const sequence = buildEditionSequence(epochCount, totalTarget, adjusted);
    if (sequence) {
      return { adjusted, sequence };
    }
  }

  return null;
}

function getLinearDaysForEpochCount(epochCount) {
  const linearLength = Math.min(12, Math.max(0, epochCount));
  return Array.from({ length: linearLength }, (_, index) => 4 + index);
}

function buildLudicrousDays(epochCount, targetSum = null) {
  if (epochCount <= 0) return [];
  const values = Array.from({ length: epochCount }, (_, index) => ludicrousPattern[index % ludicrousPattern.length]);
  if (targetSum == null) return values;

  const minSum = epochCount * 10;
  const maxSum = epochCount * 69;
  const desired = Math.max(minSum, Math.min(maxSum, targetSum));
  let difference = desired - values.reduce((sum, value) => sum + value, 0);
  let cursor = 0;

  while (difference !== 0) {
    const index = cursor % values.length;
    if (difference > 0 && values[index] < 69) {
      values[index] += 1;
      difference -= 1;
    } else if (difference < 0 && values[index] > 10) {
      values[index] -= 1;
      difference += 1;
    }
    cursor += 1;
    if (cursor > 100000) break;
  }

  return values;
}

function getArrayRange(values) {
  if (!values.length) return 0;
  return Math.max(...values) - Math.min(...values);
}

function buildFuturePlan(startEpochNumber, startDate, futureSupplyTarget, targetEndDate, cumulativeStart) {
  const fixedEpochCount = startEpochNumber - 1;
  const minimumFutureEpochCount = Math.max(1, minimumTotalEpochs - fixedEpochCount);
  const mode = getRefactorMode();
  const useSupplyTarget = mode === "maxSupply" || mode === "both";
  const useTimeTarget = mode === "timeframe" || mode === "both";
  const requestedRemainingDays = Math.max(0, Math.round((targetEndDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)));

  const resolveEditionSequence = (epochCount) => {
    if (!useSupplyTarget) return buildEditionSequence(epochCount, null);
    let sequence = buildEditionSequence(epochCount, futureSupplyTarget);
    if (!sequence && mode === "both") {
      sequence = getAdjustedMinimumEditionCounts(epochCount, futureSupplyTarget)?.sequence || null;
    }
    return sequence;
  };

  let epochCount = minimumFutureEpochCount;
  let editionSizes = null;
  let linearDays = [];
  let linearSum = 0;
  let ludicrousCount = 0;
  let ludicrousDays = [];

  if (mode === "both") {
    let bestCandidate = null;

    for (let candidate = 300; candidate >= 1; candidate -= 1) {
      const candidateLinearDays = getLinearDaysForEpochCount(candidate);
      const candidateLinearSum = candidateLinearDays.reduce((sum, value) => sum + value, 0);
      const candidateLudicrousCount = Math.max(0, candidate - candidateLinearDays.length);
      const minRemainingDays = candidateLinearSum + (candidateLudicrousCount * 10);
      const maxRemainingDays = candidateLinearSum + (candidateLudicrousCount * 69);
      if (requestedRemainingDays < minRemainingDays || requestedRemainingDays > maxRemainingDays) continue;

      const candidateEditionSizes = resolveEditionSequence(candidate);
      if (!candidateEditionSizes) continue;

      const candidateLudicrousDays = buildLudicrousDays(candidateLudicrousCount, requestedRemainingDays - candidateLinearSum);
      const candidateScore = {
        uniqueDays: new Set(candidateLudicrousDays).size,
        range: getArrayRange(candidateLudicrousDays),
        epochs: candidate
      };

      if (
        !bestCandidate ||
        candidateScore.uniqueDays > bestCandidate.score.uniqueDays ||
        (candidateScore.uniqueDays === bestCandidate.score.uniqueDays && candidateScore.range > bestCandidate.score.range) ||
        (candidateScore.uniqueDays === bestCandidate.score.uniqueDays && candidateScore.range === bestCandidate.score.range && candidateScore.epochs > bestCandidate.score.epochs)
      ) {
        bestCandidate = {
          epochCount: candidate,
          editionSizes: candidateEditionSizes,
          linearDays: candidateLinearDays,
          linearSum: candidateLinearSum,
          ludicrousCount: candidateLudicrousCount,
          ludicrousDays: candidateLudicrousDays,
          score: candidateScore
        };
      }
    }

    if (bestCandidate) {
      epochCount = bestCandidate.epochCount;
      editionSizes = bestCandidate.editionSizes;
      linearDays = bestCandidate.linearDays;
      linearSum = bestCandidate.linearSum;
      ludicrousCount = bestCandidate.ludicrousCount;
      ludicrousDays = bestCandidate.ludicrousDays;
    }
  } else {
    while (!editionSizes && epochCount < 300) {
      editionSizes = resolveEditionSequence(epochCount);
      if (!editionSizes) epochCount += 1;
    }
    if (editionSizes) {
      linearDays = getLinearDaysForEpochCount(epochCount);
      linearSum = linearDays.reduce((sum, value) => sum + value, 0);
      ludicrousCount = Math.max(0, epochCount - linearDays.length);
      const minimumRemainingDays = linearSum + (ludicrousCount * 10);
      const remainingDays = useTimeTarget
        ? Math.max(requestedRemainingDays, minimumRemainingDays)
        : null;
      ludicrousDays = buildLudicrousDays(ludicrousCount, remainingDays == null ? null : remainingDays - linearSum);
    }
  }

  if (!editionSizes) return [];

  const epochs = [];
  let cursor = new Date(startDate);
  let cumulative = cumulativeStart;

  for (let index = 0; index < epochCount; index += 1) {
    const epochNumber = startEpochNumber + index;
    const linearLength = linearDays.length;
    const phase = index < linearLength ? "Linear" : "Ludicrous";
    const daysNeeded = index < linearLength ? linearDays[index] : ludicrousDays[index - linearLength];
    const editionSize = editionSizes[index];
    const start = new Date(cursor);
    const end = addDays(start, daysNeeded);
    cumulative += editionSize;
    epochs.push({
      epoch: epochNumber,
      phase,
      daysNeeded,
      eligibility: getDefaultEligibilityForEditionSize(editionSize),
      editionSize,
      actualMinted: null,
      start,
      end,
      cumulativePlanned: cumulative
    });
    cursor = new Date(end);
  }

  return epochs;
}

function buildEpochPlan() {
  const fixedEpochs = [
    ...actualEpochHistory.map((item) => ({
      epoch: item.epoch,
      phase: item.phase,
      daysNeeded: item.daysNeeded,
      eligibility: item.eligibility,
      editionSize: item.eligible,
      actualMinted: item.minted,
      start: item.start,
      end: item.end,
      cumulativePlanned: 0
    })),
    {
      ...currentEpochOverride,
      actualMinted: null
    }
  ];

  let cumulative = 0;
  const normalizedFixed = fixedEpochs.map((item) => {
    cumulative += item.editionSize;
    if (item.epoch >= 7) {
      cumulative += specialDrops.reduce((sum, drop) => sum + drop.minted, 0);
    }
    return { ...item, cumulativePlanned: cumulative };
  });

  const storedFutureEpochs = !forceEpochPlanRebuild && materializedSchedule.epochPlan.length
    ? materializedSchedule.epochPlan
        .filter((item) => Number(item.epoch || 0) >= 8)
        .map((item) => ({ ...item }))
    : [];
  const futureStart = new Date(currentEpochOverride.end);
  const futureSupplyTarget = (getRefactorMode() === "maxSupply" || getRefactorMode() === "both")
    ? Math.max(0, getConfiguredMaxSupply() - cumulative)
    : null;
  const futureEpochs = storedFutureEpochs.length
    ? storedFutureEpochs
    : buildFuturePlan(8, futureStart, futureSupplyTarget, getConfiguredTargetEnd(), cumulative);

  const normalizedFuture = futureEpochs.map((item) => {
    if (item.epoch === 12) return { ...item, editionSize: 15 };
    if (item.epoch === 15) return { ...item, editionSize: 5 };
    return item;
  });

  let runningFutureCumulative = cumulative;
  const recalcFuture = normalizedFuture.map((item) => {
    runningFutureCumulative += item.editionSize;
    return {
      ...item,
      cumulativePlanned: runningFutureCumulative
    };
  });

  return [...normalizedFixed, ...recalcFuture];
}

function getEpochPlan() {
  recomputeMaterializedSchedule();
  return materializedSchedule.epochPlan;
}

function getCurrentEpochNumber() {
  return getProtocolState().currentEpochNumber;
}

function getDelayDays() {
  const adjustmentTotal = getTimelineAdjustments().reduce((sum, item) => {
    if (item.type === "delay") return sum + Number(item.days || 0);
    if (item.type === "backtrack") return sum - Number(item.days || 0);
    return sum;
  }, 0);
  return Number(getProtocolState().delayDays || 0) + adjustmentTotal;
}

function getExtensionDays() {
  const adjustmentTotal = getTimelineAdjustments().reduce((sum, item) => (
    item.type === "extend" ? sum + Number(item.days || 0) : sum
  ), 0);
  return Number(getProtocolState().extensionDays || 0) + adjustmentTotal;
}

function getOverrideShiftDays() {
  const state = getProtocolState();
  if (!state.override) return 0;
  const baseEpoch = buildEpochPlan().find((item) => item.epoch === state.currentEpochNumber);
  if (!baseEpoch) return 0;
  const overrideEnd = new Date(state.override.end);
  return Math.round((overrideEnd.getTime() - baseEpoch.end.getTime()) / (24 * 60 * 60 * 1000));
}

function getActiveEpochConfig() {
  const merged = getMergedEpochs();
  return merged.find((item) => item.key === getEffectiveLiveEntryKey()) || merged[0];
}

function applyDelay(epoch, delayDays) {
  const currentEpochNumber = getCurrentEpochNumber();
  const extensionDays = getExtensionDays();
  const overrideShiftDays = getOverrideShiftDays();
  if (epoch.epoch < currentEpochNumber) {
    return epoch;
  }

  const totalShift = delayDays + extensionDays + overrideShiftDays;
  return {
    ...epoch,
    start: addDays(epoch.start, totalShift),
    end: addDays(epoch.end, totalShift)
  };
}

function getShiftedEpochs() {
  recomputeMaterializedSchedule();
  return materializedSchedule.shiftedEpochs;
}

function recomputeMaterializedSchedule() {
  if (!materializedSchedule.dirty) return;

  const epochPlan = buildEpochPlan();
  const delayDays = getDelayDays();
  const shiftedEpochs = epochPlan.map((epoch) => applyDelay(epoch, delayDays));

  let standardEpochs = shiftedEpochs.map((epoch) => ({
    ...epoch,
    key: `epoch-${epoch.epoch}`,
    name: `Epoch ${epoch.epoch}`,
    eligibility: resolveEligibilityOverride(`epoch-${epoch.epoch}`, epoch.eligibility),
    minted: trackerData?.epochSummary?.[epoch.epoch]?.minted ?? epoch.actualMinted ?? 0,
    eligible: trackerData?.epochSummary?.[epoch.epoch]?.eligible ?? epoch.actualMinted ?? 0,
    type: "standard"
  }));

  const manualEpochs = getManualEpochs().map((epoch) => ({
    ...epoch,
    key: epoch.id,
    eligibility: resolveEligibilityOverride(epoch.id, epoch.eligibility),
    type: "manual",
    manualStatus: epoch.manualStatus || "future"
  }));

  for (const manual of manualEpochs) {
    if (manual.manualStatus === "complete") continue;
    const shiftMs = Math.max(0, manual.end.getTime() - manual.start.getTime());
    standardEpochs = standardEpochs.map((epoch) => {
      if (epoch.end <= manual.start) return epoch;
      return {
        ...epoch,
        start: new Date(epoch.start.getTime() + shiftMs),
        end: new Date(epoch.end.getTime() + shiftMs)
      };
    });
  }

  materializedSchedule.epochPlan = epochPlan;
  materializedSchedule.shiftedEpochs = shiftedEpochs;
  materializedSchedule.mergedEpochs = [...standardEpochs, ...manualEpochs]
    .sort((a, b) => a.start - b.start || a.end - b.end || a.name.localeCompare(b.name));
  materializedSchedule.dirty = false;
  forceEpochPlanRebuild = false;
}

function getSlotBank() {
  const rawBank = actualEpochHistory.reduce((sum, item) => sum + item.walletNotShared, 0);
  const usedBySpecials = specialDrops.reduce((sum, item) => sum + item.minted, 0);
  return rawBank - usedBySpecials;
}

function getTotalMintedSoFar() {
  const manualMinted = getManualEpochs().reduce((sum, item) => sum + Number(item.minted || 0), 0);
  if (trackerData?.currentSupplyTotal != null) {
    return trackerData.currentSupplyTotal + manualMinted;
  }
  return actualEpochHistory.reduce((sum, item) => sum + item.minted, 0) + specialDrops.reduce((sum, item) => sum + item.minted, 0) + manualMinted;
}

function getEpochDayProgress(epoch) {
  const totalDays = Math.max(1, Number(epoch.daysNeeded || diffDaysInclusive(epoch.start, epoch.end)));
  if (isEpochInWalletCollection(epoch)) {
    return `${totalDays} / ${totalDays}`;
  }
  const now = Date.now();
  if (now < epoch.start.getTime()) {
    return `0 / ${totalDays}`;
  }
  if (now >= epoch.end.getTime()) {
    return `${totalDays} / ${totalDays}`;
  }
  const elapsed = Math.floor((now - epoch.start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  return `${Math.max(1, Math.min(totalDays, elapsed))} / ${totalDays}`;
}

function getEpochCurrentDayNumber(epoch) {
  const totalDays = Math.max(1, Number(epoch.daysNeeded || diffDaysInclusive(epoch.start, epoch.end)));
  const now = Date.now();
  if (now < epoch.start.getTime()) return 0;
  if (now >= epoch.end.getTime()) return totalDays;
  const elapsed = Math.floor((now - epoch.start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  return Math.max(1, Math.min(totalDays, elapsed));
}

function getTweetRowsForEpoch(epochKey) {
  return getTweetRecords()
    .filter((item) => item.targetKey === epochKey)
    .sort((a, b) => {
      const kindA = a.kind === "wallet" ? 1 : 0;
      const kindB = b.kind === "wallet" ? 1 : 0;
      if (kindA !== kindB) return kindA - kindB;
      const dayDiff = Number(a.dayNumber || 0) - Number(b.dayNumber || 0);
      if (dayDiff !== 0) return dayDiff;
      return Number(a.variant || 1) - Number(b.variant || 1);
    });
}

function getTweetEditorTargets() {
  const merged = getMergedEpochs();
  const mergedByKey = new Map(merged.map((epoch) => [epoch.key, epoch]));
  const tweetTargets = [];

  merged.forEach((epoch) => {
    tweetTargets.push({
      key: epoch.key,
      label: epoch.name || `Epoch ${epoch.epoch}`,
      status: getHeroStatus(epoch.key),
      sortValue: Number(epoch.epoch || 0),
      totalDays: Math.max(1, Number(epoch.daysNeeded || diffDaysInclusive(epoch.start, epoch.end)))
    });
  });

  const seenKeys = new Set(tweetTargets.map((item) => item.key));
  const groupedRecords = new Map();
  getTweetRecords().forEach((record) => {
    if (!groupedRecords.has(record.targetKey)) {
      groupedRecords.set(record.targetKey, []);
    }
    groupedRecords.get(record.targetKey).push(record);
  });

  groupedRecords.forEach((records, key) => {
    if (seenKeys.has(key)) return;
    const epochMatch = String(key).match(/^epoch-(\d+)$/i);
    const epochNumber = epochMatch ? Number(epochMatch[1]) : Number.POSITIVE_INFINITY;
    const maxDay = records.reduce((max, item) => (
      item.kind === "wallet" ? max : Math.max(max, Number(item.dayNumber || 0))
    ), 0);
    tweetTargets.push({
      key,
      label: epochMatch ? `Epoch ${epochNumber}` : key,
      status: "Completed",
      sortValue: epochNumber,
      totalDays: Math.max(1, maxDay || 1)
    });
  });

  return tweetTargets.sort((a, b) => {
    if (a.sortValue !== b.sortValue) return a.sortValue - b.sortValue;
    return a.label.localeCompare(b.label);
  });
}

function getSuggestedLiveEpochNumber() {
  if (trackerData?.epochSummary) {
    const suggested = Object.entries(trackerData.epochSummary)
      .map(([epoch, summary]) => ({ epoch: Number(epoch), ...summary }))
      .sort((a, b) => a.epoch - b.epoch)
      .find((item) => item.eligibleWallets > 0 && item.minted === 0);
    if (suggested) return suggested.epoch;
  }
  return getCurrentEpochNumber();
}

let heroDeckIndex = defaultActiveEpochNumber - 1;
let heroFlipDirection = "right";
let heroQuoteIndex = 0;
let heroQuoteTimer = null;
const heroQuoteColorClasses = [
  "hero-quote__text--default",
  "hero-quote__text--green",
  "hero-quote__text--yellow",
  "hero-quote__text--red"
];

function syncHeroDeckIndex(preferredKey = null) {
  const epochs = getMergedEpochs();
  if (!epochs.length) {
    heroDeckIndex = 0;
    return;
  }

  const targetKey = preferredKey && epochs.some((item) => item.key === preferredKey)
    ? preferredKey
    : getEffectiveLiveEntryKey();

  const nextIndex = epochs.findIndex((item) => item.key === targetKey);
  heroDeckIndex = Math.max(0, nextIndex === -1 ? 0 : nextIndex);
}

function getHeroStatus(entryKey) {
  const merged = getMergedEpochs();
  const activeKey = getEffectiveLiveEntryKey();
  const activeIndex = Math.max(0, merged.findIndex((item) => item.key === activeKey));
  const entryIndex = merged.findIndex((item) => item.key === entryKey);
  if (entryIndex < activeIndex) {
    const entry = merged[entryIndex];
    if (isEpochInWalletCollection(entry)) return "Wallet Collection";
    return "Completed";
  }
  if (entryIndex === activeIndex) {
    const activeEpoch = merged[activeIndex];
    if (isEpochInWalletCollection(activeEpoch)) return "Wallet Collection";
    return getProtocolState().paused ? "Paused" : "Live";
  }
  if (entryIndex === activeIndex + 1) return "Up Next";
  return "Future";
}

function getHeroAction(epoch) {
  const status = getHeroStatus(epoch.key);
  if (status === "Paused") {
    return "This epoch is paused. Wait for the schedule update before engaging.";
  }
  if (status === "Wallet Collection") {
    return "The gm window is closed. If you are tagged, share your wallet before wallet collection closes.";
  }
  if (status === "Completed") {
    return "Closed. Check stats, winners, and issued supply.";
  }
  if (status === "Live") {
    if (epoch.epoch <= 7) {
      return "QRT + Comment before the window closes.";
    }
    return `Show up for ${epoch.daysNeeded} consecutive days once this epoch opens.`;
  }
  if (status === "Up Next") {
    return `Be ready to start on ${formatDateTimeUTC(epoch.start)} and stay consistent for ${epoch.daysNeeded} days.`;
  }
  return `Not live yet. This epoch will need ${epoch.daysNeeded} consecutive days once it opens.`;
}

function getHeroNote(epoch) {
  const status = getHeroStatus(epoch.key);
  if (status === "Paused") {
    return "The live epoch is paused right now. Check back after the schedule is updated or the pause is lifted.";
  }
  if (status === "Wallet Collection") {
    return "This epoch is in wallet collection now. The next stage is compiling the wallet roster and preparing the airdrop.";
  }
  if (status === "Completed") {
    return "This epoch has already closed. Use the rest of the site if you want the fuller context or stats.";
  }
  if (status === "Live") {
    return "If you only read one card on the site, this is the one. It tells you the action, the deadline, and what counts right now.";
  }
  if (status === "Up Next") {
    return "This is the next live window after the current epoch. If you want to prepare early, this is the next one to watch.";
  }
  return "This one is further out. The schedule can still shift if the experiment gets delayed, so treat this as the forward plan.";
}

function renderHeroDeck() {
  const epochs = getMergedEpochs();
  const heroEpoch = epochs[heroDeckIndex];

  if (!heroEpoch) return;

  const card = document.getElementById("hero-epoch-card");
  const status = getHeroStatus(heroEpoch.key);
  const heroTweetRows = getTweetRowsForEpoch(heroEpoch.key);
  card.classList.remove("is-completed", "is-live", "is-up-next", "is-future");
  card.classList.add(status === "Completed" ? "is-completed" : status === "Live" ? "is-live" : status === "Up Next" ? "is-up-next" : "is-future");
  card.classList.remove("is-flipping-left", "is-flipping-right");
  void card.offsetWidth;
  card.classList.add(heroFlipDirection === "left" ? "is-flipping-left" : "is-flipping-right");

  document.getElementById("hero-epoch-name").textContent = heroEpoch.name || `Epoch ${heroEpoch.epoch}`;
  const heroDayLabel = document.getElementById("hero-epoch-day-label");
  if (heroDayLabel) {
    heroDayLabel.innerHTML = status === "Live" && heroTweetRows.length
      ? `Current day<span class="metric-note">(click day number to go to the tweet)</span>`
      : "Current day";
  }
  document.getElementById("hero-epoch-status").textContent = status;
  document.getElementById("hero-epoch-window").textContent = `${formatDateTimeUTC(heroEpoch.start)} - ${formatDateTimeUTC(heroEpoch.end)}`;
  const heroDayNode = document.getElementById("hero-epoch-day");
  const totalDays = Math.max(1, Number(heroEpoch.daysNeeded || diffDaysInclusive(heroEpoch.start, heroEpoch.end)));
  const currentDay = getEpochCurrentDayNumber(heroEpoch);
  const matchingDayTweet = heroTweetRows.find((item) => item.kind !== "wallet" && Number(item.dayNumber || 0) === currentDay);
  const walletTweet = heroTweetRows.find((item) => item.kind === "wallet");
  const totalDaysNode = status === "Live" && heroTweetRows.length
    ? `<a class="metric-link" href="#current-epoch-tweets" data-switch-tab="current" data-switch-target="current-epoch-tweets">${totalDays}</a>`
    : String(totalDays);
  if (status === "Wallet Collection") {
    const walletText = `<span class="metric-note">(Share your Wallet)</span>`;
    heroDayNode.innerHTML = `${totalDays} / ${totalDays} ${walletText}`;
  } else if (status === "Live" && matchingDayTweet && currentDay > 0) {
    heroDayNode.innerHTML = `<a class="metric-link" href="${escapeHtml(matchingDayTweet.link)}" target="_blank" rel="noreferrer">${currentDay}</a> / ${totalDaysNode}`;
  } else {
    heroDayNode.innerHTML = `${currentDay} / ${totalDaysNode}`;
  }
  document.getElementById("hero-epoch-phase").textContent = heroEpoch.phase;
  document.getElementById("hero-epoch-eligibility").textContent = heroEpoch.eligibility;
  document.getElementById("hero-epoch-action").textContent = getHeroAction(heroEpoch);
  document.getElementById("hero-epoch-deadline").textContent = status === "Completed" ? `Closed ${formatDateTimeUTC(heroEpoch.end)}` : formatDateTimeUTC(heroEpoch.end);
  document.getElementById("hero-epoch-edition-label").textContent = status === "Completed"
    ? "Edition Size / Eligible / Minted"
    : "Edition size";
  const heroEdition = document.getElementById("hero-epoch-edition");
  if (status === "Completed") {
    const trackedEligible = trackerData?.epochSummary?.[heroEpoch.epoch]?.eligible;
    const isPilotEpoch = heroEpoch.type !== "manual" && Number(heroEpoch.epoch || 0) <= 6;
    const editionSize = heroEpoch.type === "manual"
      ? heroEpoch.editionSize
      : (isPilotEpoch && trackedEligible && trackedEligible > 0 ? trackedEligible : heroEpoch.editionSize);
    const eligible = heroEpoch.type === "manual" ? heroEpoch.editionSize : ((trackedEligible && trackedEligible > 0) ? trackedEligible : heroEpoch.editionSize);
    const minted = heroEpoch.type === "manual" ? Number(heroEpoch.minted || 0) : (trackerData?.epochSummary?.[heroEpoch.epoch]?.minted ?? 0);
    if (heroEpoch.type !== "manual" && (!trackedEligible || trackedEligible === 0)) {
      heroEdition.innerHTML = `${editionSize} / <span class="pending-accent">pending</span> / <span class="pending-accent">pending</span>`;
    } else if (minted === 0) {
      heroEdition.innerHTML = `${editionSize} / ${eligible} / <span class="pending-accent">pending</span>`;
    } else {
      heroEdition.textContent = `${editionSize} / ${eligible} / ${minted} minted`;
    }
  } else {
    heroEdition.textContent = `${heroEpoch.editionSize} ${heroEpoch.editionSize === 1 ? "edition" : "editions"}`;
  }
  document.getElementById("hero-epoch-supply").textContent = `${getTotalMintedSoFar()} / ${getEffectiveMaxSupply()} minted`;
  document.getElementById("hero-epoch-note").textContent = getHeroNote(heroEpoch);

  document.getElementById("epoch-prev").disabled = heroDeckIndex === 0;
  document.getElementById("epoch-next").disabled = heroDeckIndex === epochs.length - 1;
}

function renderHeroQuote(nextIndex, animate = true) {
  const node = document.getElementById("hero-quote-text");
  if (!node || !heroQuotes.length) return;
  const normalizedIndex = ((nextIndex % heroQuotes.length) + heroQuotes.length) % heroQuotes.length;
  const nextColorClass = heroQuoteColorClasses[Math.floor(Math.random() * heroQuoteColorClasses.length)];

  const applyQuoteState = () => {
    heroQuoteIndex = normalizedIndex;
    node.textContent = heroQuotes[heroQuoteIndex];
    heroQuoteColorClasses.forEach((className) => node.classList.remove(className));
    node.classList.add(nextColorClass);
  };

  if (!animate) {
    applyQuoteState();
    return;
  }

  node.classList.add("is-changing");
  window.setTimeout(() => {
    applyQuoteState();
    node.classList.remove("is-changing");
  }, 180);
}

function setupHeroQuotes() {
  renderHeroQuote(0, false);
  if (heroQuoteTimer) {
    window.clearInterval(heroQuoteTimer);
  }
  heroQuoteTimer = window.setInterval(() => {
    renderHeroQuote(heroQuoteIndex + 1, true);
  }, 2800);
}

function fillSummaryStrip() {
  const active = getActiveEpochConfig();
  const container = document.getElementById("summary-strip");
  container.innerHTML = summaryCards.map((item) => {
    const value = item.label === "Supply"
      ? getEffectiveMaxSupply().toLocaleString()
      : item.label === "Pilot phase" && active.phase === "Pilot"
        ? `${active.name || `Epoch ${active.epoch}`} live now`
        : item.value;
    return `
    <article class="stat-card">
      <p class="manifesto-card__label">${item.label}</p>
      <strong>${value}</strong>
      <p>${item.note}</p>
    </article>
  `;
  }).join("");
}

function accent(text) {
  return `<span class="current-accent">${escapeHtml(text)}</span>`;
}

function accentNowrap(text) {
  return `<span class="current-accent current-accent--nowrap">${escapeHtml(text)}</span>`;
}

function accentLink(text, tab) {
  if (tab === "stats-wallet") {
    return `<a class="current-accent current-accent--link" href="#panel-wallet" data-switch-tab="wallet">${escapeHtml(text)}</a>`;
  }
  return `<a class="current-accent current-accent--link" href="#panel-stats" data-switch-tab="stats" data-switch-subtab="${escapeHtml(tab)}">${escapeHtml(text)}</a>`;
}

function highlightRunbookSteps() {
  const current = getActiveEpochConfig();
  const flowSteps = Array.from(document.querySelectorAll("#panel-mechanics .flow-step p"));
  const deadline = formatDateTimeUTC(current.end);
  const replacements = [
    `See the TL;DR card for the current epoch on the home page top right. Start there.`,
    `Right now the required action is ${accent(current.eligibility)}.`,
    `If the epoch runs multiple days, repeat it every day until ${accentNowrap(deadline)}.`,
    `Only reply again if you need to update your ${accentLink("latest shared wallet", "stats-wallet")}.`,
    `Overflow triggers a draw. If not, airdrops follow after ${accentNowrap(deadline)}.`
  ];
  flowSteps.forEach((step, index) => {
    if (replacements[index]) step.innerHTML = replacements[index];
  });
}

function fillFairnessCards() {
  const container = document.getElementById("fairness-cards");
  const currentMode = getProtocolState().onChainDraws ? "On-chain" : "Manual";
  container.innerHTML = fairnessCards.map((item) => `
    <article class="stat-card">
      <p class="manifesto-card__label">${item.label}</p>
      <strong>${item.label === "Current Draw Mode" ? currentMode : item.value}</strong>
      <p>${item.label === "Current Draw Mode" && currentMode === "On-chain" ? "Draws are now using the on-chain contract and verifiable randomness." : item.note}</p>
    </article>
  `).join("");
}

function fillCurrentEpoch() {
  const epochs = getMergedEpochs();
  const current = getActiveEpochConfig();
  const currentStatus = getHeroStatus(current.key);
  const activeIndex = Math.max(0, epochs.findIndex((item) => item.key === current.key));
  const nextFive = epochs.slice(activeIndex + 1, activeIndex + 6);
  const metrics = document.getElementById("current-epoch-metrics");
  const currentTweetRows = getTweetRowsForEpoch(current.key);
  const walletTweet = currentTweetRows.find((item) => item.kind === "wallet");
  const currentDayDisplay = currentStatus === "Wallet Collection"
    ? `${getEpochDayProgress(current)} ${walletTweet ? `<a class="metric-link" href="${escapeHtml(walletTweet.link)}" target="_blank" rel="noreferrer">(Share your Wallet)</a>` : `<span class="metric-note">(Share your Wallet)</span>`}`
    : getEpochDayProgress(current);

  metrics.innerHTML = `
    <div><dt>Window <span class="metric-note-inline">(tentative)</span></dt><dd>${formatDateTimeUTC(current.start)} - ${formatDateTimeUTC(current.end)}</dd></div>
    <div><dt>Phase</dt><dd>${current.phase}</dd></div>
    <div><dt>Eligibility</dt><dd>${current.eligibility}</dd></div>
    <div><dt>Current day / days needed</dt><dd>${currentDayDisplay}</dd></div>
    <div><dt>Draw mechanism</dt><dd>${getProtocolState().onChainDraws ? "On-chain / verifiable" : "Manual for now"}</dd></div>
    <div><dt>Edition size</dt><dd>${current.editionSize}</dd></div>
  `;

  document.getElementById("draw-title").textContent = current.name || `Epoch ${current.epoch}`;
  const fairnessHeading = document.getElementById("fairness-live-heading");
  if (fairnessHeading) {
    fairnessHeading.textContent = "Latest draw records";
  }

  const checklist = currentStatus === "Wallet Collection"
    ? [
        walletTweet
          ? `Posting is closed. Use ${accent("Share your Wallet")} to open the wallet collection tweet.`
          : `Posting is closed. Watch for the wallet collection tweet.`,
        `If you are tagged and not already mapped, reply before ${accentNowrap(formatDateTimeUTC(current.end))}.`,
        current.editionSize === 1
          ? `If more than ${accent("1 user")} qualifies, admin will run a ${accent(getProtocolState().onChainDraws ? "verifiable on-chain" : "manual")} lucky draw.`
          : `If more than ${accent(String(current.editionSize))} users qualify, a lucky draw decides the final roster.`,
        `Eligible users with wallets submitted in time receive airdrops after ${accentNowrap(formatDateTimeUTC(current.end))}.`
      ]
    : [
        `Engage before ${accentNowrap(formatDateTimeUTC(current.end))}.`,
        `Required action: ${accent(current.eligibility)}.`,
        `After close, watch for the wallet prompt. If tagged and not already mapped, reply before ${accentNowrap(formatDateTimeUTC(current.end))}.`,
        current.editionSize === 1
          ? `If more than ${accent("1 user")} qualifies, admin will run a ${accent(getProtocolState().onChainDraws ? "verifiable on-chain" : "manual")} lucky draw.`
          : `If more than ${accent(String(current.editionSize))} users qualify, a lucky draw decides the final roster.`,
        `Eligible users with wallets submitted in time receive airdrops after ${accentNowrap(formatDateTimeUTC(current.end))}.`
      ];

  document.getElementById("ops-checklist").innerHTML = checklist.map((item) => `<li>${item}</li>`).join("");

  document.getElementById("upcoming-epochs").innerHTML = nextFive.map((item) => `
    <div class="timeline-table__row timeline-table__row--upcoming" role="row">
      <span role="cell">${item.name || `Epoch ${item.epoch}`}</span>
      <span role="cell">${item.phase}</span>
      <span role="cell">${formatDate(item.start)} - ${formatDate(item.end)}</span>
      <span role="cell">${item.daysNeeded}</span>
      <span role="cell">${item.editionSize}</span>
    </div>
  `).join("");

  const tweetsContainer = document.getElementById("current-epoch-tweets");
  if (tweetsContainer) {
    if (!currentTweetRows.length) {
      tweetsContainer.innerHTML = `<div class="chart-empty">No tweets added for this epoch yet.</div>`;
    } else {
      tweetsContainer.innerHTML = currentTweetRows.map((item) => `
        <div class="timeline-table__row" role="row">
          <span role="cell">${item.kind === "wallet"
            ? `Wallet collection${Number(item.variant || 1) > 1 ? ` ${escapeHtml(String(item.variant))}` : ""}`
            : `Day ${escapeHtml(String(item.dayNumber || 0))}${Number(item.variant || 1) > 1 ? `.${escapeHtml(String(item.variant))}` : ""}`}</span>
          <span role="cell"><a href="${escapeHtml(item.link)}" target="_blank" rel="noreferrer">${escapeHtml(item.link)}</a></span>
        </div>
      `).join("");
    }
  }
}

function fillProgression() {
  const container = document.getElementById("progression-body");
  const epochs = getMergedEpochs().filter((item) => item.type !== "manual");
  const linearEpochs = epochs.filter((item) => item.phase === "Linear");
  const ludicrousEpochs = epochs.filter((item) => item.phase === "Ludicrous");
  const linearStart = linearEpochs[0]?.name || "Linear start";
  const linearEnd = linearEpochs[linearEpochs.length - 1]?.name || linearStart;
  const ludicrousStart = ludicrousEpochs[0]?.name || "Ludicrous start";
  const rows = [
    {
      phase: "Pilot",
      logic: "Epochs 1-7 keep the social action simple while the live process, audience understanding, and collection behavior settle in.",
      eligibility: "Currently QRT + Comment, with short live windows and manual confirmation.",
      edition: "Open pilot sizing, including the current 1/1 Epoch 7."
    },
    {
      phase: "Linear",
      logic: "Linear starts after Epoch 7 and increases the required consecutive participation by one day each epoch.",
      eligibility: `${linearStart} starts at ${linearEpochs[0]?.daysNeeded || 4} consecutive days and builds steadily through ${linearEnd}.`,
      edition: "Upcoming ladder includes 69, 69, 42, 33, 25, 11, 5, 1, 42, 25, 1"
    },
    {
      phase: "Ludicrous",
      logic: "Ludicrous takes over after the linear ramp and lets days needed swing hard while staying inside a fixed band.",
      eligibility: `${ludicrousStart} and beyond can jump wildly from epoch to epoch, but never below 10 and never above 69.`,
      edition: "The back half keeps the full edition palette in play, with 1/1s and larger cuts both guaranteed."
    }
  ];

  container.innerHTML = rows.map((item) => `
    <div class="progression-table__row" role="row">
      <span role="cell">${item.phase}</span>
      <span role="cell">${item.logic}</span>
      <span role="cell">${item.eligibility}</span>
      <span role="cell">${item.edition}</span>
    </div>
  `).join("");
}

function fillPilotTable() {
  const container = document.getElementById("bootstrap-body");
  container.innerHTML = getMergedEpochs().filter((item) => {
    const status = getHeroStatus(item.key);
    return ["Completed", "Wallet Collection", "Live", "Paused"].includes(status);
  }).map((item) => {
    const heroStatus = getHeroStatus(item.key);
    const summary = trackerData?.epochSummary?.[item.epoch];
    const minted = item.type === "manual" ? Number(item.minted || 0) : (summary?.minted ?? item.actualMinted ?? 0);
    const walletNotShared = item.type === "manual" ? 0 : (summary?.walletNotShared ?? 0);
    const eligibleWallets = item.type === "manual" ? 0 : (summary?.eligibleWallets ?? 0);
    const status = (heroStatus === "Completed" || heroStatus === "Wallet Collection") && item.type !== "manual"
      ? (eligibleWallets === 0 ? "Compile pending" : minted === 0 ? "Wallet Collection" : "Completed")
      : heroStatus;
    const edition = heroStatus === "Completed"
      ? `${minted} minted${walletNotShared ? ` / ${walletNotShared} wallet not shared` : ""}`
      : `${item.editionSize} ${item.editionSize === 1 ? "edition" : "editions"} / ${item.eligibility}`;
    return `
    <div class="timeline-table__row" role="row">
      <span role="cell">${item.name || `Epoch ${item.epoch}`}</span>
      <span role="cell">${item.phase}</span>
      <span role="cell">${formatDate(item.start)} - ${formatDate(item.end)}</span>
      <span role="cell">${edition}</span>
      <span role="cell">${status}</span>
    </div>
  `;
  }).join("");
}

function fillTimeline() {
  const container = document.getElementById("timeline-body");
  const epochs = getMergedEpochs();
  let runningCumulative = 0;

  container.innerHTML = epochs.map((item) => {
    const editionBasis = Number(item.type === "manual" ? item.editionSize : item.editionSize || 0);
    runningCumulative += editionBasis;
    return `
      <div class="timeline-table__row timeline-table__row--epochs" role="row">
        <span role="cell">${item.name || `Epoch ${item.epoch}`}</span>
        <span role="cell">${formatDate(item.start)} - ${formatDate(item.end)}</span>
        <span role="cell">${item.phase}</span>
        <span role="cell">${item.daysNeeded}</span>
        <span role="cell">${item.editionSize} ${item.editionSize === 1 ? "edition" : "editions"}</span>
        <span role="cell">${runningCumulative}</span>
      </div>
    `;
  }).join("");

  document.getElementById("timeline-start").textContent = formatDate(baseStart);
  const effectiveEnd = getEffectiveProjectEnd();
  document.getElementById("timeline-end").textContent = formatDate(effectiveEnd);
  document.getElementById("timeline-duration").textContent = `${diffDaysInclusive(baseStart, effectiveEnd).toLocaleString()} days`;
  document.getElementById("timeline-auto-supply").textContent = getActiveEpochConfig().phase;
}

function fillFormulaCards() {
  const container = document.getElementById("formula-cards");
  const active = getActiveEpochConfig();
  const cards = [
    {
      label: "Current state",
      value: `${active.name || `Epoch ${active.epoch}`} is ${getHeroStatus(active.key).toLowerCase()}`,
      note: `The project is currently in ${active.phase}. The schedule and live instructions below are computed from the same active epoch state.`
    },
    {
      label: "Current eligibility",
      value: active.eligibility,
      note: `${active.name || `Epoch ${active.epoch}`} uses this rule right now. Future phases can raise the burden without changing the site-wide sync model.`
    },
    {
      label: "Phase progression",
      value: "Pilot -> Linear -> Ludicrous",
      note: "The project starts with simple pilot windows, then moves into a linear ramp, then into the longer ludicrous curve."
    },
    {
      label: "Max edition size",
      value: "69",
      note: "No epoch exceeds 69 editions. Smaller sizes stay in the mix to keep the schedule varied and culturally textured."
    }
  ];
  container.innerHTML = cards.map((item) => `
    <article class="stat-card">
      <p class="manifesto-card__label">${item.label}</p>
      <strong>${item.value}</strong>
      <p>${item.note}</p>
    </article>
  `).join("");
}

function fillFormulaTable() {
  const container = document.getElementById("formula-table");
  container.innerHTML = formulaRows.map((item) => `
    <div class="timeline-table__row" role="row">
      <span role="cell">${item.rule}</span>
      <span role="cell">${item.formula}</span>
      <span role="cell">${item.meaning}</span>
      <span role="cell">${item.effect}</span>
      <span role="cell">${item.bound}</span>
    </div>
  `).join("");
}

function getDrawRecords() {
  return (getProtocolState().drawRecords || []).map((item) => ({
    ...item,
    drawDate: item.drawDate ? new Date(item.drawDate) : null
  })).sort((a, b) => {
    const aTime = a.drawDate ? a.drawDate.getTime() : 0;
    const bTime = b.drawDate ? b.drawDate.getTime() : 0;
    return bTime - aTime;
  });
}

function fillFairnessResult() {
  const container = document.getElementById("fairness-result-table");
  if (!container) return;
  const records = getDrawRecords();
  if (!records.length) {
    container.innerHTML = `<div class="chart-empty">No draw records added yet.</div>`;
    return;
  }
  container.innerHTML = records.map((item) => `
    <div class="timeline-table__row" role="row">
      <span role="cell">${escapeHtml(item.epoch || "")}</span>
      <span role="cell">${escapeHtml(String(item.editionSize || 0))}</span>
      <span role="cell">${escapeHtml(String(item.eligibleCount || 0))}</span>
      <span role="cell">${escapeHtml(item.drawOutput || "")}</span>
      <span role="cell">${item.drawDate ? escapeHtml(formatDateTimeUTC(item.drawDate)) : ""}</span>
      <span role="cell">${escapeHtml(item.drawMode || "Manual")}</span>
      <span role="cell">${escapeHtml(item.winnerList || "")}</span>
    </div>
  `).join("");
}

function fillOptionalTable() {
  const container = document.getElementById("optional-table");
  const sourceContainer = document.getElementById("unclaimed-source-table");
  const manualEpochs = getManualEpochs().filter((item) => Number(item.editionSize || 0) > 0 || Number(item.minted || 0) > 0);
  const mergedEpochs = getMergedEpochs();
  const rows = manualEpochs.map((item) => {
    const editionSize = Number(item.editionSize || 0);
    const minted = Number(item.minted || 0);
    const unminted = Math.max(0, editionSize - minted);
    return {
      name: item.name || `Manual Epoch`,
      window: `${formatDate(item.start)} - ${formatDate(item.end)}`,
      status: item.manualStatus === "complete" ? "Completed" : getHeroStatus(item.id),
      editionSize,
      minted,
      unminted
    };
  });

  const chartRowMap = new Map((trackerData?.chartRows || []).map((row) => [row.label, row]));
  const poolSourceRows = mergedEpochs.reduce((acc, item) => {
    if (getHeroStatus(item.key) !== "Completed") return acc;

    const chartRow = chartRowMap.get(item.name || `Epoch ${item.epoch}`);
    if (chartRow) {
      const eligible = Number(chartRow.eligible || 0);
      const editionSize = Number(chartRow.edition_size || 0);
      const minted = Number(chartRow.minted || 0);
      const unminted = item.epoch >= 8
        ? Math.max(0, editionSize - minted)
        : Number(chartRow.wallet_not_shared || 0);

      if (eligible === 0 || minted === 0 || unminted <= 0) return acc;

      acc.push({
        name: item.name || `Epoch ${item.epoch}`,
        basis: `${editionSize}`,
        minted,
        unminted,
        reason: "Closed epoch finished below edition size"
      });
      return acc;
    }

    if (item.type === "manual") {
      const editionSize = Number(item.editionSize || 0);
      const minted = Number(item.minted || 0);
      const unminted = Math.max(0, editionSize - minted);
      if (editionSize > 0 && minted > 0 && unminted > 0) {
        acc.push({
          name: item.name || "Manual Epoch",
          basis: `${editionSize}`,
          minted,
          unminted,
          reason: "Closed epoch finished below edition size"
        });
      }
    }
    return acc;
  }, []);
  const pool = poolSourceRows.reduce((sum, item) => sum + item.unminted, 0);
  const totalManualEditions = rows.reduce((sum, item) => sum + item.editionSize, 0);
  const totalManualMinted = rows.reduce((sum, item) => sum + item.minted, 0);
  const poolNode = document.getElementById("unclaimed-pool-count");
  const editionsNode = document.getElementById("manual-epoch-editions");
  const mintedNode = document.getElementById("manual-epoch-minted");
  if (poolNode) poolNode.textContent = `${pool} slots`;
  if (editionsNode) editionsNode.textContent = `${totalManualEditions} editions`;
  if (mintedNode) mintedNode.textContent = `${totalManualMinted} minted`;

  if (!rows.length) {
    container.innerHTML = `<div class="chart-empty">No manual epochs added yet.</div>`;
  } else {
    container.innerHTML = rows.map((item) => `
      <div class="timeline-table__row" role="row">
        <span role="cell">${item.name}</span>
        <span role="cell">${item.window}</span>
        <span role="cell">${item.status}</span>
        <span role="cell">${item.editionSize}</span>
        <span role="cell">${item.minted}</span>
        <span role="cell">${item.unminted > 0 ? item.unminted : ""}</span>
      </div>
    `).join("");
  }

  if (!sourceContainer) return;
  if (!poolSourceRows.length) {
    sourceContainer.innerHTML = `<div class="chart-empty">No finalized unclaimed slot sources yet.</div>`;
    return;
  }

  sourceContainer.innerHTML = poolSourceRows.map((item) => `
    <div class="timeline-table__row" role="row">
      <span role="cell">${item.name}</span>
      <span role="cell">${item.basis}</span>
      <span role="cell">${item.minted}</span>
      <span role="cell">${item.unminted}</span>
      <span role="cell">${item.reason}</span>
    </div>
  `).join("");
}

function fillGallery() {
  const container = document.getElementById("gallery-grid");
  const epochFilter = document.getElementById("gallery-epoch-filter");
  const editionFilter = document.getElementById("gallery-edition-filter");
  const galleryItems = getGalleryItems();
  const selectedEpoch = epochFilter?.value || "all";
  const selectedEdition = editionFilter?.value || "all";
  const epochOptions = ["all", ...new Set(galleryItems.map((item) => item.epochName))];
  const editionOptions = ["all", ...new Set(galleryItems.map((item) => item.edition))];
  if (epochFilter && (
    epochFilter.options.length !== epochOptions.length ||
    Array.from(epochFilter.options).some((option, index) => option.value !== epochOptions[index])
  )) {
    const previousValue = epochFilter.value;
    epochFilter.innerHTML = epochOptions.map((value) => `
      <option value="${escapeHtml(value)}">${value === "all" ? "All epochs" : `Epoch ${value}`}</option>
    `).join("");
    epochFilter.value = epochOptions.includes(previousValue) ? previousValue : "all";
  }
  if (editionFilter && (
    editionFilter.options.length !== editionOptions.length ||
    Array.from(editionFilter.options).some((option, index) => option.value !== editionOptions[index])
  )) {
    const previousValue = editionFilter.value;
    editionFilter.innerHTML = editionOptions.map((value) => `
      <option value="${escapeHtml(value)}">${value === "all" ? "All edition sizes" : escapeHtml(value)}</option>
    `).join("");
    editionFilter.value = editionOptions.includes(previousValue) ? previousValue : "all";
  }

  const items = galleryItems.filter((item) => {
    const epochMatch = selectedEpoch === "all" || item.epochName === selectedEpoch;
    const editionMatch = selectedEdition === "all" || item.edition === selectedEdition;
    return epochMatch && editionMatch;
  });

  if (!items.length) {
    container.innerHTML = `<div class="chart-empty">No gallery items match the current filters.</div>`;
    return;
  }

  container.innerHTML = items.map((item) => `
    <article class="gallery-card">
      <div class="gallery-card__image">
        ${item.image ? `<img src="${item.image}" alt="${escapeHtml(item.title)}">` : `<div class="gallery-card__fallback">Image pending</div>`}
      </div>
      <p class="manifesto-card__label">${item.status}</p>
      <h3>${item.title}</h3>
      <div class="gallery-card__details">
        <p>Epoch: ${item.epochName}</p>
        <span class="gallery-card__edition">${item.edition}</span>
      </div>
      <div class="gallery-card__links">
        <a href="${item.os}" target="_blank" rel="noreferrer">OS listing</a>
      </div>
    </article>
  `).join("");
}

function fillOverviewStats() {
  const active = getActiveEpochConfig();
  const epochs = getMergedEpochs().filter((item) => item.type !== "manual");
  const linearEpochs = epochs.filter((item) => item.phase === "Linear");
  const ludicrousEpochs = epochs.filter((item) => item.phase === "Ludicrous");
  const overviewStats = [
    { label: "Supply", value: getEffectiveMaxSupply().toLocaleString(), note: "The ceiling is recomputed from the active refactor target and the generated future schedule. Each edition size is still capped at 69." },
    { label: "Pilot phase", value: active.phase === "Pilot" ? `${active.name || `Epoch ${active.epoch}`} live now` : "Epochs 1-7", note: "The pilot keeps eligibility simple while people absorb the concept and the process gets tested in public." },
    { label: "Linear phase", value: linearEpochs.length ? `${linearEpochs[0].name} - ${linearEpochs[linearEpochs.length - 1].name}` : "Not scheduled", note: "After pilot, the consecutive-day requirement starts at 4 days and rises by one day each epoch." },
    { label: "Ludicrous phase", value: ludicrousEpochs.length ? `${ludicrousEpochs[0].name} onward` : "Not scheduled", note: "The back half swings harder, with days-needed jumps that stay bounded but much less predictable." }
  ];

  const container = document.getElementById("overview-stats");
  if (!container) return;
  container.innerHTML = overviewStats.map((item) => `
    <article class="stat-card">
      <p class="manifesto-card__label">${item.label}</p>
      <strong>${item.value}</strong>
      <p>${item.note}</p>
    </article>
  `).join("");
}

function fillLeaderboard() {
  const container = document.getElementById("leaderboard");
  const rows = trackerData?.topMinters?.length ? trackerData.topMinters : leaderboard;
  if (!rows.length) {
    container.innerHTML = `<div class="chart-empty">No top minter data found yet.</div>`;
    return;
  }

  renderDataTable("leaderboard", [
    { key: "user", label: "User" },
    { key: "wallet", label: "Wallet" },
    { key: "totalMints", label: "Total Mints" }
  ], rows);
}

function fillAdminActions() {
  const container = document.getElementById("admin-actions");
  if (!container) return;
  container.innerHTML = adminActions.map((item) => `
    <article class="stat-card">
      <p class="manifesto-card__label">${item.label}</p>
      <strong>${item.value}</strong>
      <p>${item.note}</p>
    </article>
  `).join("");
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((item) => item.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((item) => item.trim());
    return headers.reduce((record, header, index) => {
      record[header] = values[index] ?? "";
      return record;
    }, {});
  });
}

function asNumber(value) {
  if (value === "") return 0;
  return Number(String(value).replace(/%/g, "").trim()) || 0;
}

function getMintCellValue(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return 0;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : 0;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderDataTable(containerId, headers, rows) {
  const container = document.getElementById(containerId);
  container.innerHTML = `
    <div class="stats-data-table">
      <table>
        <thead>
          <tr>${headers.map((header) => `<th>${escapeHtml(header.label)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>${headers.map((header) => `<td>${escapeHtml(row[header.key] ?? "")}</td>`).join("")}</tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderStackedBarChart(containerId, data, options) {
  const container = document.getElementById(containerId);
  if (!data.length) {
    container.innerHTML = `<div class="chart-empty">No data found for this chart yet.</div>`;
    return;
  }

  const width = 980;
  const height = 420;
  const margin = { top: 26, right: 18, bottom: 78, left: 52 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const totals = data.map((row) => options.series.reduce((sum, item) => sum + asNumber(row[item.key]), 0));
  const maxValue = Math.max(...totals, options.minMax ?? 0);
  const steps = 4;
  const stepValue = Math.max(1, Math.ceil(maxValue / steps));
  const yMax = stepValue * steps;
  const band = plotWidth / data.length;
  const barWidth = Math.min(86, band * 0.62);

  const gridLines = Array.from({ length: steps + 1 }, (_, index) => {
    const value = index * stepValue;
    const y = margin.top + plotHeight - (value / yMax) * plotHeight;
    return { value, y };
  });

  const bars = data.map((row, index) => {
    const x = margin.left + band * index + (band - barWidth) / 2;
    let yCursor = margin.top + plotHeight;
    const segments = options.series.map((item) => {
      const value = asNumber(row[item.key]);
      const h = yMax === 0 ? 0 : (value / yMax) * plotHeight;
      yCursor -= h;
      return { ...item, value, x, y: yCursor, height: h };
    });

    return {
      label: row[options.labelKey],
      total: totals[index],
      x,
      totalY: yCursor,
      segments,
      topVisibleSegmentIndex: (() => {
        for (let i = segments.length - 1; i >= 0; i -= 1) {
          if (segments[i].height > 0) return i;
        }
        return -1;
      })()
    };
  });

  container.innerHTML = `
    <div class="chart-shell">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(options.title)}">
        ${gridLines.map((line) => `
          <line x1="${margin.left}" y1="${line.y}" x2="${width - margin.right}" y2="${line.y}" stroke="var(--line)" stroke-width="1" />
          <text x="${margin.left - 10}" y="${line.y + 5}" text-anchor="end" fill="var(--muted)" font-size="12">${line.value}</text>
        `).join("")}
        <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotHeight}" stroke="var(--line-strong)" stroke-width="1.3" />
        <line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${width - margin.right}" y2="${margin.top + plotHeight}" stroke="var(--line-strong)" stroke-width="1.3" />
        ${bars.map((bar) => `
          ${bar.segments.map((segment, segmentIndex) => segment.height > 0 ? `
            ${segmentIndex === bar.topVisibleSegmentIndex
              ? `<path d="${getTopRoundedBarPath(segment.x, segment.y, barWidth, segment.height, 18)}" fill="${segment.color}" />`
              : `<rect
                  x="${segment.x}"
                  y="${segment.y}"
                  width="${barWidth}"
                  height="${segment.height}"
                  fill="${segment.color}"
                />`
            }
            ${segment.height > 20 ? `<text x="${segment.x + barWidth / 2}" y="${segment.y + segment.height / 2 + 5}" text-anchor="middle" fill="${segment.textColor || "#fff"}" font-size="13">${segment.value}</text>` : ""}
          ` : "").join("")}
          <text x="${bar.x + barWidth / 2}" y="${Math.max(margin.top - 6, bar.totalY - 10)}" text-anchor="middle" fill="var(--ink)" font-size="15">${bar.total}</text>
          <text x="${bar.x + barWidth / 2}" y="${margin.top + plotHeight + 24}" text-anchor="middle" fill="var(--ink)" font-size="12">${escapeHtml(bar.label)}</text>
        `).join("")}
      </svg>
      <div class="chart-legend">
        ${options.series.map((item) => `<span><i style="background:${item.color}"></i>${escapeHtml(item.label)}</span>`).join("")}
      </div>
    </div>
  `;
}

function getTopRoundedBarPath(x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height));
  const right = x + width;
  const bottom = y + height;

  if (r === 0) {
    return `M ${x} ${y} H ${right} V ${bottom} H ${x} Z`;
  }

  return [
    `M ${x} ${bottom}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `L ${right - r} ${y}`,
    `Q ${right} ${y} ${right} ${y + r}`,
    `L ${right} ${bottom}`,
    `L ${x} ${bottom}`,
    "Z"
  ].join(" ");
}

async function loadCsv(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`);
  }
  return parseCsv(await response.text());
}

function summarizeTracker(rows) {
  if (!rows.length) {
    return {
      dayRows: [],
      chartRows: [],
      topMinters: [],
      walletLookup: [],
      epochSummary: {},
      mintedTotal: 0,
      currentSupplyTotal: 0
    };
  }

  const headers = Object.keys(rows[0]);
  const dayKeys = headers
    .filter((key) => /day\d+_engagement/.test(key))
    .map((key) => Number(key.match(/day(\d+)_engagement/)[1]))
    .sort((a, b) => a - b);

  const engagementOverrideMap = new Map(getEngagementOverrides().map((item) => [item.targetKey, item]));
  const epochMap = new Map(getMergedEpochs().map((item) => [item.epoch, item]));

  const dayRows = dayKeys.map((dayNumber) => {
    const engagementKey = `day${dayNumber}_engagement`;
    const airdropKey = `day${dayNumber}_airdrop`;
    const epochConfig = epochMap.get(dayNumber);
    let qrt = 0;
    let rt = 0;
    let comment = 0;
    let minted = 0;
    let eligibleWallets = 0;
    let engagedEntries = 0;

    rows.forEach((row) => {
      const engagement = (row[engagementKey] || "").trim().toUpperCase();
      const hasWallet = Boolean((row.wallet || "").trim());
      const mintedValue = hasWallet ? getMintCellValue(row[airdropKey]) : 0;
      if (engagement) engagedEntries += 1;
      if (engagement === "QRT") qrt += 1;
      if (engagement === "RT") rt += 1;
      if (engagement === "COMMENT") comment += 1;
      if (engagement && hasWallet) eligibleWallets += 1;
      minted += mintedValue;
    });

    const override = engagementOverrideMap.get(`epoch-${dayNumber}`);
    const qrtComment = override ? Number(override.qrtComment || 0) : 0;
    const onlyQrt = override ? Number(override.onlyQrt || 0) : qrt;
    const onlyComment = override ? Number(override.onlyComment || 0) : comment;
    const editionSize = Number(epochConfig?.editionSize || 0);
    const pilotMode = dayNumber <= 6;
    const rawEligible = engagedEntries;
    const eligible = rawEligible;
    const effectiveEditionSize = pilotMode ? rawEligible : editionSize;
    const isPreviousEpoch = dayNumber < getCurrentEpochNumber();
    return {
      label: `Epoch ${dayNumber}`,
      tableLabel: isPreviousEpoch && minted === 0 ? `Epoch ${dayNumber} (pending)` : `Epoch ${dayNumber}`,
      qrt_comment: qrtComment,
      only_qrt: onlyQrt,
      only_comment: onlyComment,
      total: qrtComment + onlyQrt + onlyComment,
      eligible,
      edition_size: effectiveEditionSize,
      eligible_wallets: eligibleWallets,
      minted,
      unfilled: Math.max(0, effectiveEditionSize - eligible),
      wallet_not_shared: Math.max(0, eligible - minted),
      success_pct: `${eligible ? Math.round((minted / eligible) * 100) : 0}%`
    };
  });

  const epochSummary = Object.fromEntries(dayRows.map((row, index) => [dayKeys[index], {
    eligible: row.eligible,
    eligibleWallets: row.eligible_wallets,
    minted: row.minted,
    unfilled: row.unfilled,
    walletNotShared: row.wallet_not_shared
  }]));

  const mintMap = new Map();
  rows.forEach((row) => {
    const key = String(row.username || "").trim().toLowerCase();
    if (!key) return;
    const totalMinted = dayKeys.reduce((sum, dayNumber) => sum + getMintCellValue(row[`day${dayNumber}_airdrop`]), 0);
    const flowers = dayKeys.flatMap((dayNumber) => buildFlowerEntriesForEpoch(String(dayNumber), getMintCellValue(row[`day${dayNumber}_airdrop`])));
    mintMap.set(key, {
      user: row.username,
      wallet: row.wallet || "",
      totalMints: totalMinted,
      status: row.wallet ? "Mapped" : "Not mapped",
      flowers
    });
  });

  getManualEpochs().forEach((epoch) => {
    parseManualRecipients(epoch.recipients).forEach((recipient) => {
      const key = recipient.user.toLowerCase();
      const existing = mintMap.get(key) || {
        user: recipient.user,
        wallet: recipient.wallet || "",
        totalMints: 0,
        status: recipient.wallet ? "Mapped" : "Not mapped",
        flowers: []
      };
      const flowers = buildFlowerEntriesForEpoch(epoch.name || "", recipient.count || 0);
      mintMap.set(key, {
        user: existing.user || recipient.user,
        wallet: existing.wallet || recipient.wallet || "",
        totalMints: Number(existing.totalMints || 0) + Number(recipient.count || 0),
        status: existing.wallet || recipient.wallet ? "Mapped" : "Not mapped",
        flowers: mergeFlowerEntries(existing.flowers, flowers)
      });
    });
  });

  const topMinters = Array.from(mintMap.values())
    .sort((a, b) => Number(b.totalMints) - Number(a.totalMints) || a.user.localeCompare(b.user))
    .slice(0, 25)
    .map((item) => ({
      user: item.user,
      wallet: item.wallet || "Not mapped",
      totalMints: String(item.totalMints)
    }));

  const walletLookup = Array.from(mintMap.values()).map((item) => ({
    user: item.user,
    wallet: item.wallet || "",
    status: item.status,
    totalMints: String(item.totalMints),
    flowers: item.flowers || []
  }));

  return {
    dayRows,
    chartRows: buildChronologicalChartRows(dayRows),
    topMinters,
    walletLookup,
    epochSummary,
    mintedTotal: dayRows.reduce((sum, row) => sum + row.minted, 0),
    currentSupplyTotal: rows.reduce((sum, row) => (
      sum + dayKeys.reduce((inner, dayNumber) => inner + getMintCellValue(row[`day${dayNumber}_airdrop`]), 0)
    ), 0)
  };
}

function buildChronologicalChartRows(dayRows) {
  const dayRowMap = new Map(dayRows.map((row, index) => [index + 1, row]));
  const engagementOverrideMap = new Map(getEngagementOverrides().map((item) => [item.targetKey, item]));
  const now = Date.now();
  const scheduledRows = getMergedEpochs()
    .filter((item) => {
      if (item.type === "manual") {
        return item.manualStatus === "complete" || item.start.getTime() <= now || Number(item.minted || 0) > 0;
      }
      return dayRowMap.has(item.epoch);
    })
    .map((item) => {
      if (item.type === "manual") {
        const minted = Number(item.minted || 0);
        const eligible = Number(item.editionSize || 0);
        const editionSize = Number(item.editionSize || 0);
        const isCompleted = getHeroStatus(item.key) === "Completed";
        const override = engagementOverrideMap.get(item.key);
        const qrtComment = override ? Number(override.qrtComment || 0) : 0;
        const onlyQrt = override ? Number(override.onlyQrt || 0) : 0;
        const onlyComment = override ? Number(override.onlyComment || 0) : eligible;
        return {
          label: item.name || `Epoch ${item.epoch}`,
          tableLabel: item.name || `Epoch ${item.epoch}`,
          qrt_comment: qrtComment,
          only_qrt: onlyQrt,
          only_comment: onlyComment,
          total: qrtComment + onlyQrt + onlyComment,
          eligible,
          edition_size: editionSize,
          eligible_wallets: eligible,
          minted,
          unfilled: Math.max(0, editionSize - eligible),
          wallet_not_shared: Math.max(0, eligible - minted),
          success_pct: `${eligible ? Math.round((minted / eligible) * 100) : 0}%`,
          sortTime: item.start.getTime(),
          isCompleted
        };
      }

      const row = dayRowMap.get(item.epoch);
      return {
        ...row,
        label: item.name || row.label,
        sortTime: item.start.getTime(),
        isCompleted: getHeroStatus(item.key) === "Completed"
      };
    });
  return scheduledRows
    .sort((a, b) => a.sortTime - b.sortTime || a.label.localeCompare(b.label));
}

async function fillStatsVisuals() {
  try {
    const trackerRows = await loadCsv(trackerCsvPath);
    trackerData = summarizeTracker(trackerRows);
    materializedSchedule.dirty = true;
    trackerData.chartRows = buildChronologicalChartRows(trackerData.dayRows);

    renderStackedBarChart("engagement-chart", trackerData.chartRows, {
      title: "Proof of Culture engagement mix",
      labelKey: "label",
      minMax: 70,
      series: [
        { key: "qrt_comment", label: "QRT + Comment", color: "#4a97e8" },
        { key: "only_qrt", label: "Only QRT", color: "#cc1976" },
        { key: "only_comment", label: "Only Comment", color: "#f4b348", textColor: "#fff" }
      ]
    });

    renderDataTable("engagement-table", [
      { key: "tableLabel", label: "Epoch" },
      { key: "qrt_comment", label: "QRT + Comment" },
      { key: "only_qrt", label: "Only QRT" },
      { key: "only_comment", label: "Only Comment" },
      { key: "total", label: "Total" }
    ], trackerData.chartRows);

    renderStackedBarChart("minting-chart", trackerData.chartRows, {
      title: "Proof of Culture minting stats",
      labelKey: "label",
      minMax: 70,
      series: [
        { key: "minted", label: "Minted", color: "#57de24", textColor: "#111" },
        { key: "wallet_not_shared", label: "Wallet Not Shared", color: "#ff5f4d", textColor: "#111" },
        { key: "unfilled", label: "Unfilled", color: "#d3cfbf", textColor: "#111" }
      ]
    });

    renderDataTable("minting-table", [
      { key: "tableLabel", label: "Epoch" },
      { key: "eligible", label: "Eligible" },
      { key: "edition_size", label: "Edition Size" },
      { key: "minted", label: "Minted" },
      { key: "wallet_not_shared", label: "Wallet Not Shared" },
      { key: "unfilled", label: "Unfilled" },
      { key: "success_pct", label: "Success%" }
    ], trackerData.chartRows);

    fillLeaderboard();
    renderHeroDeck();
    renderDelayState();
  } catch (error) {
    const message = "The tracker CSV could not be loaded. Serve the site over a local web server and keep proof_of_culture_tracker_master.csv in /data.";
    document.getElementById("engagement-chart").innerHTML = `<div class="chart-empty">${message}</div>`;
    document.getElementById("minting-chart").innerHTML = `<div class="chart-empty">${message}</div>`;
    document.getElementById("engagement-table").innerHTML = "";
    document.getElementById("minting-table").innerHTML = "";
  }
}

function setupTabs() {
  const tabLists = Array.from(document.querySelectorAll('[role="tablist"]'));

  tabLists.forEach((tabList) => {
    const tabs = Array.from(tabList.querySelectorAll(".tab"));
    const root = tabList.parentElement;
    const panels = Array.from(root.querySelectorAll(":scope > .tab-panels > .tab-panel"));

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const target = tab.dataset.tab;
        tabs.forEach((item) => {
          const active = item === tab;
          item.classList.toggle("is-active", active);
          item.setAttribute("aria-selected", String(active));
        });

        panels.forEach((panel) => {
          panel.classList.toggle("is-active", panel.dataset.panel === target);
        });
      });
    });
  });
}

function activateTab(target) {
  const tab = document.querySelector(`.tab[data-tab="${target}"]`);
  if (tab) tab.click();
  return tab;
}

function activatePanelFromHash(hash) {
  if (!hash) return;
  const panelId = hash.replace(/^#/, "");
  const panel = document.getElementById(panelId);
  if (!panel) return;

  const protocolPanel = panel.closest(".tab-panels--protocol > .tab-panel");
  if (protocolPanel?.dataset.panel) {
    activateTab(protocolPanel.dataset.panel);
  }

  const nestedPanel = panel.closest(".tab-panels > .tab-panel");
  if (nestedPanel?.dataset.panel && nestedPanel !== protocolPanel) {
    activateTab(nestedPanel.dataset.panel);
  }

  window.setTimeout(() => {
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 60);
}

function setTheme(theme) {
  document.body.setAttribute("data-theme", theme);
  const button = document.getElementById("theme-toggle");
  const isDark = theme === "dark";
  button.textContent = isDark ? "Light mode" : "Dark mode";
  button.setAttribute("aria-pressed", String(isDark));
  window.localStorage.setItem("proof-of-culture-theme", theme);
}

function setupThemeToggle() {
  const savedTheme = window.localStorage.getItem("proof-of-culture-theme");
  setTheme(savedTheme || "light");

  document.getElementById("theme-toggle").addEventListener("click", () => {
    const nextTheme = document.body.getAttribute("data-theme") === "dark" ? "light" : "dark";
    setTheme(nextTheme);
  });
}

function setupTabShortcuts() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-switch-tab]");
    if (!button) return;
    event.preventDefault();
    const target = button.dataset.switchTab;
    const subtab = button.dataset.switchSubtab;
    const targetId = button.dataset.switchTarget;
    const tab = activateTab(target);
    if (tab) {
      if (subtab) {
        window.setTimeout(() => activateTab(subtab), 20);
      }
      if (targetId) {
        window.setTimeout(() => {
          const node = document.getElementById(targetId);
          if (node) {
            node.scrollIntoView({ behavior: "smooth", block: "start" });
          } else {
            document.querySelector(".section--tabs").scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }, 40);
      } else {
        document.querySelector(".section--tabs").scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  });
}

function renderDelayState() {
  const delayDays = getDelayDays();
  const state = getProtocolState();
  const delayDaysNode = document.getElementById("delay-days");
  const currentEpochNode = document.getElementById("admin-current-epoch");
  const pauseToggle = document.getElementById("epoch-pause-toggle");
  if (delayDaysNode) delayDaysNode.textContent = `${delayDays} days`;
  if (currentEpochNode) currentEpochNode.textContent = getActiveEpochConfig().name || `Epoch ${getCurrentEpochNumber()}`;
  if (pauseToggle) pauseToggle.textContent = state.paused ? "Resume" : "Pause";
  const drawModeSwitch = document.getElementById("draw-mode-switch");
  const drawModeLabel = document.getElementById("draw-mode-label");
  if (drawModeSwitch) {
    drawModeSwitch.checked = Boolean(state.onChainDraws);
    drawModeSwitch.setAttribute("aria-checked", String(Boolean(state.onChainDraws)));
  }
  if (drawModeLabel) {
    drawModeLabel.textContent = state.onChainDraws ? "On-chain" : "Manual";
  }
  const projectDaysInput = document.getElementById("refactor-project-days");
  const maxSupplyInput = document.getElementById("refactor-max-supply");
  const refactorModeSelect = document.getElementById("refactor-mode");
  const liveEpochSelect = document.getElementById("admin-live-epoch-select");
  if (projectDaysInput) projectDaysInput.value = String(getConfiguredProjectDays());
  if (maxSupplyInput) maxSupplyInput.value = String(getConfiguredMaxSupply());
  if (refactorModeSelect) {
    refactorModeSelect.value = getRefactorMode();
    const mode = refactorModeSelect.value;
    const byTimeframe = mode === "timeframe";
    const byMaxSupply = mode === "maxSupply";
    if (projectDaysInput) projectDaysInput.disabled = byMaxSupply;
    if (maxSupplyInput) maxSupplyInput.disabled = byTimeframe;
  }
  if (liveEpochSelect) {
    const epochs = getMergedEpochs();
    const activeKey = getEffectiveLiveEntryKey();
    liveEpochSelect.innerHTML = epochs.map((epoch) => {
      const summary = trackerData?.epochSummary?.[epoch.epoch];
      const status = epoch.type === "manual" ? ` · ${epoch.manualStatus}` : "";
      const extra = summary ? ` · wallets ${summary.eligibleWallets} · minted ${summary.minted}${status}` : epoch.type === "manual" ? ` · minted ${epoch.minted || 0}${status}` : "";
      return `<option value="${epoch.key}">${epoch.name || `Epoch ${epoch.epoch}`}${extra}</option>`;
    }).join("");
    liveEpochSelect.value = activeKey;
  }
  const eligibilityEpochSelect = document.getElementById("eligibility-epoch-select");
  if (eligibilityEpochSelect) {
    const epochs = getMergedEpochs();
    const activeKey = getEffectiveLiveEntryKey();
    eligibilityEpochSelect.innerHTML = epochs.map((epoch) => (
      `<option value="${epoch.key}">${epoch.name || `Epoch ${epoch.epoch}`}</option>`
    )).join("");
    if (!eligibilityEpochSelect.value || !epochs.some((item) => item.key === eligibilityEpochSelect.value)) {
      eligibilityEpochSelect.value = activeKey;
    }
  }
  const engagementEpochSelect = document.getElementById("engagement-epoch-select");
  if (engagementEpochSelect) {
    const epochs = getMergedEpochs();
    const activeKey = getEffectiveLiveEntryKey();
    engagementEpochSelect.innerHTML = epochs.map((epoch) => (
      `<option value="${epoch.key}">${epoch.name || `Epoch ${epoch.epoch}`}</option>`
    )).join("");
    if (!engagementEpochSelect.value || !epochs.some((item) => item.key === engagementEpochSelect.value)) {
      engagementEpochSelect.value = activeKey;
    }
  }
  const tweetEpochSelect = document.getElementById("tweet-epoch-select");
  if (tweetEpochSelect) {
    const epochs = getTweetEditorTargets();
    const activeKey = getEffectiveLiveEntryKey();
    const previousValue = tweetEpochSelect.value;
    tweetEpochSelect.innerHTML = epochs.map((epoch) => (
      `<option value="${epoch.key}">${epoch.label} · ${epoch.status}</option>`
    )).join("");
    if (!previousValue || !epochs.some((item) => item.key === previousValue)) {
      tweetEpochSelect.value = epochs.some((item) => item.key === activeKey)
        ? activeKey
        : (epochs[0]?.key || "");
    } else {
      tweetEpochSelect.value = previousValue;
    }
    renderTweetDayEditor(tweetEpochSelect.value);
  }
  const walletPendingActions = document.getElementById("tweet-wallet-pending-actions");
  if (walletPendingActions) {
    const walletPendingEpochs = getMergedEpochs().filter((epoch) => getHeroStatus(epoch.key) === "Wallet Collection");
    if (!walletPendingEpochs.length) {
      walletPendingActions.innerHTML = "";
    } else {
      walletPendingActions.innerHTML = walletPendingEpochs.map((epoch) => `
        <button class="button" type="button" data-wallet-pending-epoch="${escapeHtml(epoch.key)}">${escapeHtml(epoch.name || `Epoch ${epoch.epoch}`)} wallet drop</button>
      `).join("");
      walletPendingActions.querySelectorAll("[data-wallet-pending-epoch]").forEach((button) => {
        button.addEventListener("click", () => {
          const targetKey = button.dataset.walletPendingEpoch || "";
          const select = document.getElementById("tweet-epoch-select");
          if (select) {
            select.value = targetKey;
          }
          renderTweetDayEditor(targetKey);
        });
      });
    }
  }
  const galleryTokenSelect = document.getElementById("gallery-token-select");
  if (galleryTokenSelect) {
    const galleryItems = getGalleryItems();
    const previousValue = galleryTokenSelect.value || String(galleryItems[0]?.token || 1);
    galleryTokenSelect.innerHTML = galleryItems.map((item) => (
      `<option value="${item.token}">Token ${item.token} · ${escapeHtml(item.title)}</option>`
    )).join("");
    galleryTokenSelect.value = galleryItems.some((item) => String(item.token) === previousValue)
      ? previousValue
      : String(galleryItems[0]?.token || 1);
  }
  const galleryImageSelect = document.getElementById("gallery-image-select");
  if (galleryImageSelect) {
    const previousValue = galleryImageSelect.value || "";
    galleryImageSelect.innerHTML = `
      <option value="">Select mapped image</option>
      ${getKnownWebAssets().map((path) => `<option value="${escapeHtml(path)}">${escapeHtml(path)}</option>`).join("")}
    `;
    if (getKnownWebAssets().includes(previousValue)) {
      galleryImageSelect.value = previousValue;
    }
  }
  renderManualEpochList();
  renderEngagementOverrideList();
  renderEligibilityOverrideList();
  renderTweetRecordList();
  populateDrawRecordEpochSelect();
  renderDrawRecordList();
  renderTimelineAdjustmentList();
  renderGalleryOverrideList();
  const galleryApplyButton = document.getElementById("gallery-apply");
  if (galleryTokenSelect && galleryApplyButton && !galleryApplyButton.dataset.editingId) {
    populateGalleryForm(galleryTokenSelect.value);
  }
  syncGalleryAssetStatus();
  syncHeroDeckIndex(getMergedEpochs()[heroDeckIndex]?.key);
  fillSummaryStrip();
  fillProgression();
  fillFormulaCards();
  fillFairnessCards();
  fillFairnessResult();
  renderHeroDeck();
  highlightRunbookSteps();
  fillCurrentEpoch();
  fillPilotTable();
  fillTimeline();
  fillOverviewStats();
  fillOptionalTable();
  fillGallery();
}

function syncRefactorModeInputs() {
  const projectDaysInput = document.getElementById("refactor-project-days");
  const maxSupplyInput = document.getElementById("refactor-max-supply");
  const refactorModeSelect = document.getElementById("refactor-mode");
  if (!projectDaysInput || !maxSupplyInput || !refactorModeSelect) return;
  const mode = refactorModeSelect.value;
  const byTimeframe = mode === "timeframe";
  const byMaxSupply = mode === "maxSupply";
  projectDaysInput.disabled = byMaxSupply;
  maxSupplyInput.disabled = byTimeframe;
}

function clearManualEpochForm() {
  document.getElementById("override-name").value = "";
  document.getElementById("override-status").value = "future";
  document.getElementById("override-phase").value = "";
  document.getElementById("override-eligibility-mode").value = "Comment or QRT";
  document.getElementById("override-eligibility-mode").dataset.manualEdited = "false";
  document.getElementById("override-eligibility-custom").value = "";
  document.getElementById("override-days-needed").value = "";
  document.getElementById("override-edition-size").value = "";
  document.getElementById("override-minted").value = "";
  document.getElementById("override-start").value = "";
  document.getElementById("override-end").value = "";
  document.getElementById("override-recipients").value = "";
  const applyButton = document.getElementById("override-apply");
  applyButton.dataset.editingId = "";
  applyButton.textContent = "Add Manual Epoch";
}

function clearEligibilityOverrideForm() {
  document.getElementById("eligibility-override-mode").value = "Comment or QRT";
  document.getElementById("eligibility-override-custom").value = "";
  const button = document.getElementById("eligibility-override-apply");
  button.dataset.editingId = "";
  button.textContent = "Save Override";
}

function clearEngagementOverrideForm() {
  document.getElementById("engagement-qrt-comment").value = "";
  document.getElementById("engagement-only-qrt").value = "";
  document.getElementById("engagement-only-comment").value = "";
  const button = document.getElementById("engagement-override-apply");
  button.dataset.editingId = "";
  button.textContent = "Save Engagement Stats";
}

function clearTweetRecordForm() {
  const tweetEpochSelect = document.getElementById("tweet-epoch-select");
  if (tweetEpochSelect) {
    tweetEpochSelect.value = getEffectiveLiveEntryKey();
  }
  renderTweetDayEditor(tweetEpochSelect?.value || getEffectiveLiveEntryKey());
  const button = document.getElementById("tweet-record-apply");
  button.dataset.editingId = "";
  button.textContent = "Save Tweet Links";
}

function clearDrawRecordForm() {
  populateDrawRecordEpochSelect();
  syncDrawRecordEditionSize();
  document.getElementById("draw-record-eligible-count").value = "";
  document.getElementById("draw-record-output").value = "";
  document.getElementById("draw-record-date").value = "";
  document.getElementById("draw-record-mode").value = "Manual";
  document.getElementById("draw-record-winners").value = "";
  const button = document.getElementById("draw-record-apply");
  button.dataset.editingId = "";
  button.dataset.editingEpoch = "";
  button.dataset.mode = "create";
  button.textContent = "Add Draw Record";
}

function getDrawRecordEpochOptions() {
  const merged = getMergedEpochs();
  const endedEpochs = merged.filter((item) => item.end.getTime() <= Date.now());
  const latestEnded = endedEpochs.length
    ? endedEpochs.reduce((latest, item) => (item.end > latest.end ? item : latest), endedEpochs[0])
    : null;
  return merged
    .filter((item) => getHeroStatus(item.key) === "Completed" || (latestEnded && item.key === latestEnded.key))
    .sort((a, b) => a.end - b.end)
    .map((item) => ({
      key: item.key,
      value: item.type === "manual" ? String(item.name || item.key) : String(item.epoch),
      label: item.name || `Epoch ${item.epoch}`
    }));
}

function getDrawRecordEpochEntry(selectedValue = "") {
  return getDrawRecordEpochOptions().find((item) => item.value === selectedValue) || null;
}

function populateDrawRecordEpochSelect(selectedValue = "") {
  const select = document.getElementById("draw-record-epoch");
  if (!select) return;
  const options = getDrawRecordEpochOptions();
  const preferredValue = selectedValue || select.value || options[options.length - 1]?.value || "";
  select.innerHTML = options.length
    ? options.map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join("")
    : `<option value="">No completed epochs yet</option>`;
  if (!options.length) {
    select.value = "";
    return;
  }
  select.value = options.some((item) => item.value === preferredValue)
    ? preferredValue
    : options[options.length - 1].value;
}

function syncDrawRecordEditionSize() {
  const select = document.getElementById("draw-record-epoch");
  const editionInput = document.getElementById("draw-record-edition-size");
  if (!select || !editionInput) return;
  const option = getDrawRecordEpochEntry(select.value);
  if (!option) return;
  const epoch = getMergedEpochs().find((item) => item.key === option.key);
  if (!epoch) return;
  editionInput.value = String(Number(epoch.editionSize || 0));
}

function setDrawRecordEditMode(record) {
  populateDrawRecordEpochSelect(record?.epoch || "");
  const applyButton = document.getElementById("draw-record-apply");
  applyButton.dataset.editingId = record?.id || "";
  applyButton.dataset.editingEpoch = record?.epoch || "";
  applyButton.dataset.mode = record?.id ? "edit" : "create";
  applyButton.textContent = record?.id ? "Update Draw Record" : "Add Draw Record";
}

function ensureDrawRecordCreateModeIfEpochChanged() {
  const applyButton = document.getElementById("draw-record-apply");
  if (!applyButton || applyButton.dataset.mode !== "edit") return;
  const currentEpoch = document.getElementById("draw-record-epoch")?.value.trim() || "";
  const editingEpoch = applyButton.dataset.editingEpoch || "";
  if (currentEpoch !== editingEpoch) {
    applyButton.dataset.editingId = "";
    applyButton.dataset.editingEpoch = "";
    applyButton.dataset.mode = "create";
    applyButton.textContent = "Add Draw Record";
  }
}

function populateGalleryForm(token) {
  const item = getGalleryItemByToken(token) || galleryBase[0];
  if (!item) return;
  document.getElementById("gallery-token-select").value = String(item.token);
  document.getElementById("gallery-title").value = item.title || "";
  document.getElementById("gallery-epoch-name").value = item.epochName || "";
  document.getElementById("gallery-edition").value = item.edition || "";
  document.getElementById("gallery-token-number").value = String(item.token || "");
  document.getElementById("gallery-os-link").value = item.os || "";
  document.getElementById("gallery-image-select").value = getKnownWebAssets().includes(item.image) ? item.image : "";
  document.getElementById("gallery-image-custom").value = getKnownWebAssets().includes(item.image) ? "" : (item.image || "");
}

function clearGalleryForm() {
  const select = document.getElementById("gallery-token-select");
  const firstToken = select?.value || String(galleryBase[0]?.token || 1);
  populateGalleryForm(firstToken);
  const button = document.getElementById("gallery-apply");
  button.dataset.editingId = "";
  button.textContent = "Save Gallery Entry";
}

function clearTimelineAdjustmentForm() {
  document.getElementById("timeline-adjustment-type").value = "delay";
  document.getElementById("timeline-adjustment-days").value = "";
  const button = document.getElementById("timeline-adjustment-apply");
  button.dataset.editingId = "";
  button.textContent = "Add Adjustment";
}

function renderManualEpochList() {
  const container = document.getElementById("manual-epoch-list");
  if (!container) return;
  const manualEpochs = getManualEpochs();
  if (!manualEpochs.length) {
    container.innerHTML = `<div class="chart-empty">No manual epochs added yet.</div>`;
    return;
  }

  container.innerHTML = manualEpochs.map((item) => `
    <article class="admin-manual-item">
      <div class="admin-manual-item__head">
        <strong>${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(item.phase)} · ${escapeHtml(item.manualStatus || "future")}</span>
      </div>
      <div class="admin-manual-item__meta">
        <span>${escapeHtml(formatDateTimeUTC(item.start))} - ${escapeHtml(formatDateTimeUTC(item.end))}</span>
        <span>${escapeHtml(item.eligibility)}</span>
        <span>${escapeHtml(String(item.editionSize))} ed. / ${escapeHtml(String(item.minted || 0))} minted</span>
      </div>
      ${(parseManualRecipients(item.recipients).length ? `<div class="admin-manual-item__meta"><span>Recipients: ${escapeHtml(parseManualRecipients(item.recipients).map((recipient) => recipient.user).join(", "))}</span></div>` : "")}
      <div class="hero__actions">
        <button class="button" type="button" data-manual-edit="${escapeHtml(item.id)}">Edit</button>
        <button class="button" type="button" data-manual-delete="${escapeHtml(item.id)}">Delete</button>
      </div>
    </article>
  `).join("");

  container.querySelectorAll("[data-manual-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const record = getManualEpochs().find((item) => item.id === button.dataset.manualEdit);
      if (!record) return;
      document.getElementById("override-name").value = record.name || "";
      document.getElementById("override-status").value = record.manualStatus || "future";
      document.getElementById("override-phase").value = record.phase || "";
      const eligibilityMode = ["QRT only", "Comment only", "QRT + Comment", "RT + Comment", "RT Only", "Comment or QRT"].includes(record.eligibility)
        ? record.eligibility
        : "Custom";
      document.getElementById("override-eligibility-mode").value = eligibilityMode;
      document.getElementById("override-eligibility-mode").dataset.manualEdited = "true";
      document.getElementById("override-eligibility-custom").value = eligibilityMode === "Custom" ? (record.eligibility || "") : "";
      document.getElementById("override-days-needed").value = String(record.daysNeeded || "");
      document.getElementById("override-edition-size").value = String(record.editionSize || "");
      document.getElementById("override-minted").value = String(record.minted || 0);
      document.getElementById("override-start").value = new Date(record.start.getTime() - (record.start.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
      document.getElementById("override-end").value = new Date(record.end.getTime() - (record.end.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
      document.getElementById("override-recipients").value = serializeManualRecipients(parseManualRecipients(record.recipients));
      const applyButton = document.getElementById("override-apply");
      applyButton.dataset.editingId = record.id;
      applyButton.textContent = "Update Manual Epoch";
    });
  });

  container.querySelectorAll("[data-manual-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      const currentCardKey = getMergedEpochs()[heroDeckIndex]?.key;
      const state = getProtocolState();
      const manualEpochsNext = (state.manualEpochs || []).filter((item) => item.id !== button.dataset.manualDelete);
      const nextState = { ...state, manualEpochs: manualEpochsNext };
      if (state.liveEntryKey === button.dataset.manualDelete) {
        nextState.liveEntryKey = `epoch-${state.currentEpochNumber}`;
      }
      setProtocolState(nextState);
      clearManualEpochForm();
      syncHeroDeckIndex(currentCardKey);
      renderDelayState();
    });
  });
}

function renderEligibilityOverrideList() {
  const container = document.getElementById("eligibility-override-list");
  if (!container) return;
  const overrides = getEligibilityOverrides();
  if (!overrides.length) {
    container.innerHTML = `<div class="chart-empty">No eligibility overrides added yet.</div>`;
    return;
  }

  const merged = getMergedEpochs();
  container.innerHTML = overrides.map((item) => {
    const target = merged.find((entry) => entry.key === item.targetKey);
    return `
      <article class="admin-manual-item">
        <div class="admin-manual-item__head">
          <strong>${escapeHtml(target?.name || item.targetKey)}</strong>
          <span>${escapeHtml(getEligibilityDisplay(item.mode, item.customText || ""))}</span>
        </div>
        <div class="hero__actions">
          <button class="button" type="button" data-eligibility-edit="${escapeHtml(item.id)}">Edit</button>
          <button class="button" type="button" data-eligibility-delete="${escapeHtml(item.id)}">Delete</button>
        </div>
      </article>
    `;
  }).join("");

  container.querySelectorAll("[data-eligibility-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const record = getEligibilityOverrides().find((item) => item.id === button.dataset.eligibilityEdit);
      if (!record) return;
      document.getElementById("eligibility-epoch-select").value = record.targetKey;
      document.getElementById("eligibility-override-mode").value = record.mode || "Comment or QRT";
      document.getElementById("eligibility-override-custom").value = record.customText || "";
      const applyButton = document.getElementById("eligibility-override-apply");
      applyButton.dataset.editingId = record.id;
      applyButton.textContent = "Update Override";
    });
  });

  container.querySelectorAll("[data-eligibility-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      const state = getProtocolState();
      setProtocolState({
        ...state,
        eligibilityOverrides: (state.eligibilityOverrides || []).filter((item) => item.id !== button.dataset.eligibilityDelete)
      });
      clearEligibilityOverrideForm();
      renderDelayState();
    });
  });
}

function renderTweetRecordList() {
  const container = document.getElementById("tweet-record-list");
  if (!container) return;
  container.innerHTML = "";
}

function renderTweetDayEditor(targetKey) {
  const container = document.getElementById("tweet-day-editor");
  if (!container) return;
  const epoch = getMergedEpochs().find((item) => item.key === targetKey);
  const fallbackTarget = getTweetEditorTargets().find((item) => item.key === targetKey);
  if (!epoch && !fallbackTarget) {
    container.innerHTML = `<div class="chart-empty">Select an epoch to load its day-by-day tweet inputs.</div>`;
    return;
  }
  const totalDays = epoch
    ? Math.max(1, Number(epoch.daysNeeded || diffDaysInclusive(epoch.start, epoch.end)))
    : Math.max(1, Number(fallbackTarget?.totalDays || 1));
  const recordsByDay = new Map();
  const walletRecords = [];
  getTweetRowsForEpoch(targetKey).forEach((item) => {
    if (item.kind === "wallet") {
      walletRecords.push(item.link || "");
      return;
    }
    const key = Number(item.dayNumber || 0);
    const next = recordsByDay.get(key) || [];
    next.push(item.link || "");
    recordsByDay.set(key, next);
  });
  const dayRows = Array.from({ length: totalDays }, (_, index) => {
    const dayNumber = index + 1;
    return `
      <div class="admin-tweet-editor__row">
        <label for="tweet-link-day-${dayNumber}">Day ${dayNumber}</label>
        <textarea id="tweet-link-day-${dayNumber}" data-day-number="${dayNumber}" placeholder="One tweet link per line for Day ${dayNumber}">${escapeHtml((recordsByDay.get(dayNumber) || []).join("\n"))}</textarea>
        <div class="admin-tweet-editor__actions">
          <button class="button" type="button" data-tweet-focus="${dayNumber}">Edit</button>
          <button class="button" type="button" data-tweet-clear="${dayNumber}">Delete</button>
        </div>
      </div>
    `;
  }).join("");
  const walletRow = `
    <div class="admin-tweet-editor__row">
      <label for="tweet-link-wallet">Wallet collection</label>
      <textarea id="tweet-link-wallet" data-kind="wallet" placeholder="One wallet collection tweet link per line">${escapeHtml(walletRecords.join("\n"))}</textarea>
      <div class="admin-tweet-editor__actions">
        <button class="button" type="button" data-tweet-focus="wallet">Edit</button>
        <button class="button" type="button" data-tweet-clear="wallet">Delete</button>
      </div>
    </div>
  `;
  container.innerHTML = `${dayRows}${walletRow}`;

  container.querySelectorAll("[data-tweet-focus]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.tweetFocus;
      const input = key === "wallet"
        ? container.querySelector("textarea[data-kind=\"wallet\"]")
        : container.querySelector(`textarea[data-day-number="${key}"]`);
      if (input) {
        input.focus();
        input.select();
      }
    });
  });

  container.querySelectorAll("[data-tweet-clear]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.tweetClear;
      const input = key === "wallet"
        ? container.querySelector("textarea[data-kind=\"wallet\"]")
        : container.querySelector(`textarea[data-day-number="${key}"]`);
      if (input) {
        input.value = "";
        input.focus();
      }
    });
  });
}

function buildTweetExportDayLabel(epoch, record, recordsForEpoch) {
  const epochLabel = String(epoch?.epoch ?? epoch?.name ?? "").replace(/^Epoch\s+/i, "");
  if (record.kind === "wallet") {
    const walletRecords = recordsForEpoch.filter((item) => item.kind === "wallet");
    return walletRecords.length > 1
      ? `${epochLabel}.w.${record.variant || 1}`
      : `${epochLabel}.w`;
  }
  const sameDayRecords = recordsForEpoch.filter((item) => item.kind !== "wallet" && Number(item.dayNumber || 0) === Number(record.dayNumber || 0));
  return sameDayRecords.length > 1
    ? `${epochLabel}.${record.dayNumber}.${record.variant || 1}`
    : `${epochLabel}.${record.dayNumber}`;
}

function downloadSelectedTweetCsv() {
  const targetKey = document.getElementById("tweet-epoch-select")?.value;
  if (!targetKey) return;
  const epoch = getMergedEpochs().find((item) => item.key === targetKey);
  const rows = getTweetRowsForEpoch(targetKey);
  const csvRows = [["day", "link"]];
  rows.forEach((record) => {
    csvRows.push([buildTweetExportDayLabel(epoch, record, rows), record.link || ""]);
  });
  const csv = csvRows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const epochLabel = String(epoch?.epoch ?? "epoch");
  downloadFile(`epoch_${epochLabel}_tweets.csv`, csv, "text/csv;charset=utf-8");
}

function renderEngagementOverrideList() {
  const container = document.getElementById("engagement-override-list");
  if (!container) return;
  const overrides = getEngagementOverrides();
  if (!overrides.length) {
    container.innerHTML = `<div class="chart-empty">No engagement overrides added yet.</div>`;
    return;
  }

  const merged = getMergedEpochs();
  container.innerHTML = overrides.map((item) => {
    const target = merged.find((entry) => entry.key === item.targetKey);
    return `
      <article class="admin-manual-item">
        <div class="admin-manual-item__head">
          <strong>${escapeHtml(target?.name || item.targetKey)}</strong>
          <span>QRT + Comment ${escapeHtml(String(item.qrtComment || 0))} · Only QRT ${escapeHtml(String(item.onlyQrt || 0))} · Only Comment ${escapeHtml(String(item.onlyComment || 0))}</span>
        </div>
        <div class="hero__actions">
          <button class="button" type="button" data-engagement-edit="${escapeHtml(item.id)}">Edit</button>
          <button class="button" type="button" data-engagement-delete="${escapeHtml(item.id)}">Delete</button>
        </div>
      </article>
    `;
  }).join("");

  container.querySelectorAll("[data-engagement-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const record = getEngagementOverrides().find((item) => item.id === button.dataset.engagementEdit);
      if (!record) return;
      document.getElementById("engagement-epoch-select").value = record.targetKey;
      document.getElementById("engagement-qrt-comment").value = String(record.qrtComment || 0);
      document.getElementById("engagement-only-qrt").value = String(record.onlyQrt || 0);
      document.getElementById("engagement-only-comment").value = String(record.onlyComment || 0);
      const applyButton = document.getElementById("engagement-override-apply");
      applyButton.dataset.editingId = record.id;
      applyButton.textContent = "Update Engagement Stats";
    });
  });

  container.querySelectorAll("[data-engagement-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      const state = getProtocolState();
      setProtocolState({
        ...state,
        engagementOverrides: (state.engagementOverrides || []).filter((item) => item.id !== button.dataset.engagementDelete)
      });
      clearEngagementOverrideForm();
      fillStatsVisuals();
      renderDelayState();
    });
  });
}

function renderDrawRecordList() {
  const container = document.getElementById("draw-record-list");
  if (!container) return;
  const records = getDrawRecords();
  if (!records.length) {
    container.innerHTML = `<div class="chart-empty">No draw records added yet.</div>`;
    return;
  }

  container.innerHTML = records.map((item) => `
    <article class="admin-manual-item">
      <div class="admin-manual-item__head">
        <strong>${escapeHtml(item.epoch || "Draw record")}</strong>
        <span>${escapeHtml(item.drawMode || "Manual")} · ${item.drawDate ? escapeHtml(formatDateTimeUTC(item.drawDate)) : "No date"}</span>
      </div>
      <div class="admin-manual-item__meta">
        <span>${escapeHtml(String(item.editionSize || 0))} ed.</span>
        <span>${escapeHtml(String(item.eligibleCount || 0))} eligible</span>
        <span>${escapeHtml(item.drawOutput || "")}</span>
      </div>
      <div class="admin-manual-item__meta">
        <span>Winners: ${escapeHtml(item.winnerList || "")}</span>
      </div>
      <div class="hero__actions">
        <button class="button" type="button" data-draw-edit="${escapeHtml(item.id)}">Edit</button>
        <button class="button" type="button" data-draw-delete="${escapeHtml(item.id)}">Delete</button>
      </div>
    </article>
  `).join("");

  container.querySelectorAll("[data-draw-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const record = getDrawRecords().find((item) => item.id === button.dataset.drawEdit);
      if (!record) return;
      document.getElementById("draw-record-epoch").value = record.epoch || "";
      document.getElementById("draw-record-edition-size").value = String(record.editionSize || "");
      document.getElementById("draw-record-eligible-count").value = String(record.eligibleCount || "");
      document.getElementById("draw-record-output").value = record.drawOutput || "";
      document.getElementById("draw-record-date").value = record.drawDate
        ? new Date(record.drawDate.getTime() - (record.drawDate.getTimezoneOffset() * 60000)).toISOString().slice(0, 16)
        : "";
      document.getElementById("draw-record-mode").value = record.drawMode || "Manual";
      document.getElementById("draw-record-winners").value = record.winnerList || "";
      setDrawRecordEditMode(record);
    });
  });

  container.querySelectorAll("[data-draw-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      const state = getProtocolState();
      setProtocolState({
        ...state,
        drawRecords: (state.drawRecords || []).filter((item) => item.id !== button.dataset.drawDelete)
      });
      clearDrawRecordForm();
      renderDelayState();
    });
  });
}

function renderTimelineAdjustmentList() {
  const container = document.getElementById("timeline-adjustment-list");
  if (!container) return;
  const adjustments = getTimelineAdjustments();
  if (!adjustments.length) {
    container.innerHTML = `<div class="chart-empty">No timeline adjustments added yet.</div>`;
    return;
  }

  container.innerHTML = adjustments.map((item) => `
    <article class="admin-manual-item">
      <div class="admin-manual-item__head">
        <strong>${escapeHtml(item.type)} ${escapeHtml(String(item.days))} day${Number(item.days) === 1 ? "" : "s"}</strong>
        <span>Added during ${escapeHtml(item.epochName || item.epochKey || "current epoch")}</span>
      </div>
      <div class="admin-manual-item__meta">
        <span>${escapeHtml(item.type === "extend" ? `Extends ${item.epochName || "live epoch"} by ${item.days} day${Number(item.days) === 1 ? "" : "s"}` : `${item.type === "delay" ? "Pushes" : "Pulls"} current and future schedule ${item.type === "delay" ? "forward" : "back"} by ${item.days} day${Number(item.days) === 1 ? "" : "s"}`)}</span>
      </div>
      <div class="hero__actions">
        <button class="button" type="button" data-adjustment-edit="${escapeHtml(item.id)}">Edit</button>
        <button class="button" type="button" data-adjustment-delete="${escapeHtml(item.id)}">Delete</button>
      </div>
    </article>
  `).join("");

  container.querySelectorAll("[data-adjustment-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const record = getTimelineAdjustments().find((item) => item.id === button.dataset.adjustmentEdit);
      if (!record) return;
      document.getElementById("timeline-adjustment-type").value = record.type || "delay";
      document.getElementById("timeline-adjustment-days").value = String(record.days || "");
      const applyButton = document.getElementById("timeline-adjustment-apply");
      applyButton.dataset.editingId = record.id;
      applyButton.textContent = "Update Adjustment";
    });
  });

  container.querySelectorAll("[data-adjustment-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      const state = getProtocolState();
      setProtocolState({
        ...state,
        timelineAdjustments: (state.timelineAdjustments || []).filter((item) => item.id !== button.dataset.adjustmentDelete)
      });
      clearTimelineAdjustmentForm();
      renderDelayState();
    });
  });
}

function renderGalleryOverrideList() {
  const container = document.getElementById("gallery-override-list");
  if (!container) return;
  const overrides = getGalleryOverrides()
    .map((item) => ({ ...item, effective: getGalleryItemByToken(item.token) || item }))
    .sort((a, b) => Number(a.token) - Number(b.token));

  if (!overrides.length) {
    container.innerHTML = `<div class="chart-empty">No gallery overrides added yet.</div>`;
    return;
  }

  container.innerHTML = overrides.map((item) => `
    <article class="admin-manual-item">
      <div class="admin-manual-item__head">
        <strong>Token ${escapeHtml(String(item.token))} · ${escapeHtml(item.effective.title || item.title || "")}</strong>
        <span>${escapeHtml(item.effective.edition || item.edition || "")}</span>
      </div>
      <div class="admin-manual-item__meta">
        <span>Epoch ${escapeHtml(item.effective.epochName || item.epochName || "")}</span>
        <span>${escapeHtml(item.effective.image || item.image || "No image")}</span>
      </div>
      <div class="hero__actions">
        <button class="button" type="button" data-gallery-edit="${escapeHtml(String(item.token))}">Edit</button>
        <button class="button" type="button" data-gallery-delete="${escapeHtml(String(item.token))}">Delete</button>
      </div>
    </article>
  `).join("");

  container.querySelectorAll("[data-gallery-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const token = Number(button.dataset.galleryEdit);
      populateGalleryForm(token);
      const applyButton = document.getElementById("gallery-apply");
      applyButton.dataset.editingId = String(token);
      applyButton.textContent = "Update Gallery Entry";
    });
  });

  container.querySelectorAll("[data-gallery-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      const state = getProtocolState();
      const token = Number(button.dataset.galleryDelete);
      setProtocolState({
        ...state,
        galleryOverrides: (state.galleryOverrides || []).filter((item) => Number(item.token) !== token)
      });
      clearGalleryForm();
      fillGallery();
      renderDelayState();
    });
  });
}

function setupDelayControls() {
  if (!hasAdminUi()) return;

  document.getElementById("admin-settings-connect").addEventListener("click", async () => {
    if (!window.showSaveFilePicker) {
      window.alert("Your browser does not support connecting a writable settings file here. You can still use Export Settings.");
      return;
    }
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: `admin_settings_${new Date().toISOString().slice(0, 10)}.json`,
        types: [{
          description: "JSON files",
          accept: { "application/json": [".json"] }
        }]
      });
      adminSettingsFileHandle = handle;
      await saveAdminSettingsHandle(handle);
      await persistProtocolStateToFile();
      syncAdminSettingsStatus();
    } catch (_) {
      syncAdminSettingsStatus();
    }
  });

  document.getElementById("admin-settings-export").addEventListener("click", () => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadJsonFile(`admin_settings_${stamp}.json`, buildPersistedPayload());
  });

  document.getElementById("admin-settings-import-trigger").addEventListener("click", () => {
    document.getElementById("admin-settings-import").click();
  });

  document.getElementById("admin-settings-import").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      const nextPayload = parsePersistedPayload(parsed);
      setProtocolState(nextPayload.protocolState);
      applyMaterializedScheduleSnapshot(nextPayload.materializedSchedule);
      await persistProtocolStateToFile();
      clearManualEpochForm();
      clearEngagementOverrideForm();
      clearEligibilityOverrideForm();
      clearDrawRecordForm();
      clearGalleryForm();
      await fillStatsVisuals();
      renderDelayState();
    } catch (error) {
      window.alert("That file could not be imported. Please choose a valid admin_settings JSON file.");
    } finally {
      event.target.value = "";
    }
  });

  document.getElementById("override-edition-size").addEventListener("input", () => {
    const modeSelect = document.getElementById("override-eligibility-mode");
    const customInput = document.getElementById("override-eligibility-custom");
    if (modeSelect.dataset.manualEdited === "true") return;
    const nextMode = getDefaultEligibilityForEditionSize(Number(document.getElementById("override-edition-size").value || 0));
    modeSelect.value = ["QRT only", "Comment only", "QRT + Comment", "RT + Comment", "RT Only", "Comment or QRT"].includes(nextMode)
      ? nextMode
      : "Custom";
    customInput.value = modeSelect.value === "Custom" ? nextMode : "";
  });

  document.getElementById("override-eligibility-mode").addEventListener("change", () => {
    document.getElementById("override-eligibility-mode").dataset.manualEdited = "true";
  });

  document.getElementById("epoch-complete").addEventListener("click", () => {
    const state = getProtocolState();
    const merged = getMergedEpochs();
    const activeIndex = Math.max(0, merged.findIndex((item) => item.key === getEffectiveLiveEntryKey()));
    const nextEntry = merged[Math.min(merged.length - 1, activeIndex + 1)];
    setProtocolState({
      ...state,
      currentEpochNumber: nextEntry?.epoch || state.currentEpochNumber,
      liveEntryKey: nextEntry?.key || getLiveEntryKey(),
      extensionDays: 0,
      paused: false,
      override: null
    });
    heroDeckIndex = Math.min(Math.max(0, activeIndex + 1), getMergedEpochs().length - 1);
    renderDelayState();
  });

  document.getElementById("epoch-pause-toggle").addEventListener("click", () => {
    const state = getProtocolState();
    setProtocolState({ ...state, paused: !state.paused });
    renderDelayState();
  });

  document.getElementById("draw-mode-switch").addEventListener("change", () => {
    const state = getProtocolState();
    setProtocolState({ ...state, onChainDraws: document.getElementById("draw-mode-switch").checked });
    renderDelayState();
  });

  document.getElementById("timeline-adjustment-apply").addEventListener("click", () => {
    const state = getProtocolState();
    const editingId = document.getElementById("timeline-adjustment-apply").dataset.editingId || "";
    const activeEpoch = getActiveEpochConfig();
    const nextRecord = {
      id: editingId || `adjustment-${Date.now()}`,
      type: document.getElementById("timeline-adjustment-type").value || "delay",
      days: Math.max(1, Number(document.getElementById("timeline-adjustment-days").value || 0)),
      epochKey: activeEpoch.key,
      epochName: activeEpoch.name || `Epoch ${activeEpoch.epoch}`
    };
    if (!nextRecord.days) return;
    const nextAdjustments = (state.timelineAdjustments || []).filter((item) => item.id !== nextRecord.id);
    nextAdjustments.push(nextRecord);
    setProtocolState({
      ...state,
      timelineAdjustments: nextAdjustments
    });
    clearTimelineAdjustmentForm();
    renderDelayState();
  });

  document.getElementById("timeline-adjustment-clear").addEventListener("click", () => {
    clearTimelineAdjustmentForm();
  });

  document.getElementById("admin-live-epoch-apply").addEventListener("click", () => {
    const state = getProtocolState();
    const selectedKey = document.getElementById("admin-live-epoch-select").value || getLiveEntryKey();
    const selectedEntry = getMergedEpochs().find((item) => item.key === selectedKey);
    setProtocolState({
      ...state,
      currentEpochNumber: selectedEntry?.epoch || state.currentEpochNumber,
      liveEntryKey: selectedKey,
      extensionDays: 0,
      paused: false
    });
    heroDeckIndex = Math.max(0, getMergedEpochs().findIndex((item) => item.key === selectedKey));
    renderDelayState();
  });

  document.getElementById("refactor-schedule").addEventListener("click", () => {
    const state = getProtocolState();
    const mode = document.getElementById("refactor-mode").value || "maxSupply";
    const projectDays = Number(document.getElementById("refactor-project-days").value || getConfiguredProjectDays());
    const maxSupply = Number(document.getElementById("refactor-max-supply").value || getConfiguredMaxSupply());
    forceEpochPlanRebuild = true;
    setProtocolState({
      ...state,
      refactorMode: mode,
      projectDays: Math.max(1, projectDays),
      maxSupply: Math.max(1, maxSupply)
    });
    heroDeckIndex = Math.min(heroDeckIndex, getMergedEpochs().length - 1);
    renderDelayState();
  });

  document.getElementById("refactor-mode").addEventListener("change", () => {
    syncRefactorModeInputs();
  });

  document.getElementById("override-apply").addEventListener("click", () => {
    const currentCardKey = getMergedEpochs()[heroDeckIndex]?.key;
    const state = getProtocolState();
    const start = document.getElementById("override-start").value;
    const end = document.getElementById("override-end").value;
    if (!start || !end) return;
    const editingId = document.getElementById("override-apply").dataset.editingId || "";
    const nextRecord = {
      id: editingId || `manual-${Date.now()}`,
      name: document.getElementById("override-name").value || `Manual Epoch ${Date.now()}`,
      manualStatus: document.getElementById("override-status").value || "future",
      phase: document.getElementById("override-phase").value || "Manual",
      eligibility: getEligibilityDisplay(
        document.getElementById("override-eligibility-mode").value || "Comment or QRT",
        document.getElementById("override-eligibility-custom").value || ""
      ),
      daysNeeded: Number(document.getElementById("override-days-needed").value || 1),
      editionSize: Number(document.getElementById("override-edition-size").value || 1),
      minted: Number(document.getElementById("override-minted").value || 0),
      recipients: document.getElementById("override-recipients").value || "",
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString()
    };
    const manualEpochs = (state.manualEpochs || []).filter((item) => item.id !== nextRecord.id);
    manualEpochs.push(nextRecord);
    const activeCurrent = getActiveEpochConfig();
    const nextState = {
      ...state,
      manualEpochs,
      override: null
    };
    if (nextRecord.manualStatus === "live") {
      nextState.liveEntryKey = nextRecord.id;
    } else if (
      nextRecord.manualStatus !== "complete" &&
      new Date(nextRecord.start) >= activeCurrent.start &&
      new Date(nextRecord.start) < activeCurrent.end
    ) {
      nextState.liveEntryKey = nextRecord.id;
    }
    setProtocolState(nextState);
    clearManualEpochForm();
    syncHeroDeckIndex(nextRecord.id || currentCardKey);
    renderDelayState();
  });

  document.getElementById("override-clear").addEventListener("click", () => {
    clearManualEpochForm();
  });

  document.getElementById("engagement-override-apply").addEventListener("click", () => {
    const state = getProtocolState();
    const applyButton = document.getElementById("engagement-override-apply");
    const editingId = applyButton.dataset.editingId || "";
    const nextRecord = {
      id: editingId || `engagement-${Date.now()}`,
      targetKey: document.getElementById("engagement-epoch-select").value,
      qrtComment: Number(document.getElementById("engagement-qrt-comment").value || 0),
      onlyQrt: Number(document.getElementById("engagement-only-qrt").value || 0),
      onlyComment: Number(document.getElementById("engagement-only-comment").value || 0)
    };
    const nextOverrides = (state.engagementOverrides || []).filter((item) => item.id !== nextRecord.id && item.targetKey !== nextRecord.targetKey);
    nextOverrides.push(nextRecord);
    setProtocolState({
      ...state,
      engagementOverrides: nextOverrides
    });
    clearEngagementOverrideForm();
    fillStatsVisuals();
    renderDelayState();
  });

  document.getElementById("engagement-override-clear").addEventListener("click", () => {
    clearEngagementOverrideForm();
  });

  document.getElementById("tweet-load-days").addEventListener("click", () => {
    renderTweetDayEditor(document.getElementById("tweet-epoch-select").value || getEffectiveLiveEntryKey());
  });

  document.getElementById("tweet-epoch-select").addEventListener("change", (event) => {
    renderTweetDayEditor(event.target.value || getEffectiveLiveEntryKey());
  });

  document.getElementById("tweet-record-apply").addEventListener("click", () => {
    const state = getProtocolState();
    const targetKey = document.getElementById("tweet-epoch-select").value;
    if (!targetKey) return;
    const inputs = Array.from(document.querySelectorAll("#tweet-day-editor textarea[data-day-number], #tweet-day-editor textarea[data-kind=\"wallet\"]"));
    if (!inputs.length) return;
    const nextRecords = (state.tweetRecords || []).filter((item) => item.targetKey !== targetKey);
    inputs.forEach((input) => {
      const kind = input.dataset.kind === "wallet" ? "wallet" : "day";
      const dayNumber = kind === "wallet" ? 0 : Math.max(1, Number(input.dataset.dayNumber || 0));
      const lines = input.value
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean);
      lines.forEach((link, index) => {
        const variant = index + 1;
        nextRecords.push({
          id: `tweet-${targetKey}-${kind}-${dayNumber}-${variant}`,
          targetKey,
          kind,
          dayNumber,
          variant,
          link
        });
      });
    });
    setProtocolState({
      ...state,
      tweetRecords: nextRecords
    });
    renderDelayState();
  });

  document.getElementById("tweet-record-download").addEventListener("click", () => {
    downloadSelectedTweetCsv();
  });

  document.getElementById("tweet-record-clear").addEventListener("click", () => {
    clearTweetRecordForm();
  });

  document.getElementById("eligibility-override-apply").addEventListener("click", () => {
    const state = getProtocolState();
    const applyButton = document.getElementById("eligibility-override-apply");
    const editingId = applyButton.dataset.editingId || "";
    const nextRecord = {
      id: editingId || `eligibility-${Date.now()}`,
      targetKey: document.getElementById("eligibility-epoch-select").value,
      mode: document.getElementById("eligibility-override-mode").value || "Comment or QRT",
      customText: document.getElementById("eligibility-override-custom").value || ""
    };
    const nextOverrides = (state.eligibilityOverrides || []).filter((item) => item.id !== nextRecord.id && item.targetKey !== nextRecord.targetKey);
    nextOverrides.push(nextRecord);
    setProtocolState({
      ...state,
      eligibilityOverrides: nextOverrides
    });
    clearEligibilityOverrideForm();
    renderDelayState();
  });

  document.getElementById("eligibility-override-clear").addEventListener("click", () => {
    clearEligibilityOverrideForm();
  });

  document.getElementById("draw-record-apply").addEventListener("click", () => {
    const state = getProtocolState();
    const applyButton = document.getElementById("draw-record-apply");
    const isEditing = Boolean(applyButton.dataset.editingId) && applyButton.dataset.mode === "edit";
    const editingId = isEditing ? (applyButton.dataset.editingId || "") : "";
    const dateValue = document.getElementById("draw-record-date").value;
    const nextRecord = {
      id: editingId || `draw-${Date.now()}`,
      epoch: document.getElementById("draw-record-epoch").value.trim(),
      editionSize: Number(document.getElementById("draw-record-edition-size").value || 0),
      eligibleCount: Number(document.getElementById("draw-record-eligible-count").value || 0),
      drawOutput: document.getElementById("draw-record-output").value.trim(),
      drawDate: dateValue ? new Date(dateValue).toISOString() : "",
      drawMode: document.getElementById("draw-record-mode").value || "Manual",
      winnerList: document.getElementById("draw-record-winners").value.trim()
    };
    const nextRecords = (state.drawRecords || []).filter((item) => item.id !== nextRecord.id);
    nextRecords.push(nextRecord);
    setProtocolState({
      ...state,
      drawRecords: nextRecords
    });
    clearDrawRecordForm();
    renderDelayState();
  });

  document.getElementById("draw-record-clear").addEventListener("click", () => {
    clearDrawRecordForm();
  });

  document.getElementById("draw-record-epoch").addEventListener("change", () => {
    syncDrawRecordEditionSize();
    ensureDrawRecordCreateModeIfEpochChanged();
  });

  document.getElementById("draw-record-epoch").addEventListener("input", () => {
    ensureDrawRecordCreateModeIfEpochChanged();
  });

  document.getElementById("gallery-token-select").addEventListener("change", (event) => {
    populateGalleryForm(event.target.value);
    const button = document.getElementById("gallery-apply");
    button.dataset.editingId = "";
    button.textContent = "Save Gallery Entry";
  });

  document.getElementById("gallery-clear").addEventListener("click", () => {
    clearGalleryForm();
  });

  document.getElementById("gallery-refresh-assets").addEventListener("click", async () => {
    await refreshGalleryAssetList();
  });

  document.getElementById("gallery-apply").addEventListener("click", () => {
    const state = getProtocolState();
    const selectedToken = Number(document.getElementById("gallery-token-select").value || 0);
    const token = Number(document.getElementById("gallery-token-number").value || selectedToken || 0);
    if (!token) return;

    const imageSelect = document.getElementById("gallery-image-select").value || "";
    const imageCustom = document.getElementById("gallery-image-custom").value.trim();
    const image = imageCustom || imageSelect;
    const baseItem = galleryBase.find((item) => Number(item.token) === selectedToken) || getGalleryItemByToken(token);
    const nextOverride = {
      token,
      title: document.getElementById("gallery-title").value.trim() || baseItem?.title || `Token ${token}`,
      epochName: document.getElementById("gallery-epoch-name").value.trim() || baseItem?.epochName || "",
      edition: document.getElementById("gallery-edition").value.trim() || baseItem?.edition || "",
      os: document.getElementById("gallery-os-link").value.trim() || `${openseaBaseUrl}/${token}`,
      image: image || baseItem?.image || "",
      mark: `#${String(token).padStart(3, "0")}`
    };

    const nextOverrides = (state.galleryOverrides || []).filter((item) => Number(item.token) !== selectedToken && Number(item.token) !== token);
    nextOverrides.push(nextOverride);
    setProtocolState({
      ...state,
      galleryOverrides: nextOverrides
    });
    populateGalleryForm(token);
    document.getElementById("gallery-token-select").value = String(token);
    const button = document.getElementById("gallery-apply");
    button.dataset.editingId = String(token);
    button.textContent = "Update Gallery Entry";
    fillGallery();
    renderDelayState();
  });
}

function setupHeroDeckControls() {
  document.getElementById("epoch-prev").addEventListener("click", () => {
    heroFlipDirection = "left";
    heroDeckIndex = Math.max(0, heroDeckIndex - 1);
    renderHeroDeck();
  });

  document.getElementById("epoch-next").addEventListener("click", () => {
    heroFlipDirection = "right";
    heroDeckIndex = Math.min(getShiftedEpochs().length - 1, heroDeckIndex + 1);
    renderHeroDeck();
  });

  document.getElementById("epoch-reset").addEventListener("click", () => {
    heroFlipDirection = "right";
    heroDeckIndex = Math.max(0, getMergedEpochs().findIndex((item) => item.key === getEffectiveLiveEntryKey()));
    renderHeroDeck();
  });
}

function setupWalletCheck() {
  const renderResult = () => {
    const value = document.getElementById("wallet-check-input").value.trim().toLowerCase();
    const container = document.getElementById("wallet-check-result");
    if (!value) {
      container.innerHTML = `<div class="wallet-check__empty">Search for a username or wallet.</div>`;
      return;
    }

    const match = trackerData?.walletLookup?.find((item) =>
      item.user.toLowerCase() === value || item.wallet.toLowerCase() === value
    );

    if (!match) {
      container.innerHTML = `
        <div class="wallet-check__empty">
          <strong>Status:</strong> Unknown or not mapped
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="wallet-check__result">
        <div class="wallet-check__row"><strong>User</strong><span>${escapeHtml(match.user)}</span></div>
        <div class="wallet-check__row"><strong>Wallet</strong><span>${escapeHtml(match.wallet || "Unknown")}</span></div>
        <div class="wallet-check__row"><strong>Total Mints</strong><span>${escapeHtml(match.totalMints || "0")}</span></div>
        <div class="wallet-check__row"><strong>Status</strong><span class="wallet-check__status">${escapeHtml(match.status)}</span></div>
        <div class="wallet-check__row">
          <strong>Flowers airdropped from Epochs</strong>
          ${match.flowers?.length ? `
            <div class="wallet-check__epoch-list">
              ${match.flowers.map((item) => `
                <span class="wallet-check__epoch-pill">Epoch ${escapeHtml(item.epochName)}${Number(item.mintedCount || 0) > 1 ? ` · ${escapeHtml(String(item.mintedCount))}` : ""}</span>
              `).join("")}
            </div>
          ` : `<span>No flowers found yet.</span>`}
        </div>
      </div>
    `;
  };

  document.getElementById("wallet-check-button").addEventListener("click", renderResult);
  document.getElementById("wallet-check-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter") renderResult();
  });
  renderResult();
}

function setupGalleryFilter() {
  const epochFilter = document.getElementById("gallery-epoch-filter");
  const editionFilter = document.getElementById("gallery-edition-filter");
  [epochFilter, editionFilter].filter(Boolean).forEach((filter) => {
    filter.addEventListener("change", () => {
      fillGallery();
    });
  });
}

async function init() {
  const localState = loadProtocolStateFromLocalStorage();
  protocolStateCache = getDefaultProtocolState();

  try {
    const storedHandle = await loadAdminSettingsHandle();
    if (storedHandle) {
      const permission = await storedHandle.queryPermission({ mode: "readwrite" });
      if (permission === "granted") {
        adminSettingsFileHandle = storedHandle;
        const fileState = await readProtocolStateFromFileHandle(storedHandle);
        protocolStateCache = fileState.protocolState;
        applyMaterializedScheduleSnapshot(fileState.materializedSchedule);
        window.localStorage.setItem(protocolStateKey, JSON.stringify(protocolStateCache));
      }
    }
  } catch (_) {
    adminSettingsFileHandle = null;
  }

  if (!adminSettingsFileHandle) {
    const hostedState = await loadProtocolStateFromHostedJson();
    if (hostedState) {
      protocolStateCache = hostedState.protocolState;
      applyMaterializedScheduleSnapshot(hostedState.materializedSchedule);
    } else if (hasAdminUi()) {
      protocolStateCache = localState;
    }
  }

  fillSummaryStrip();
  fillFairnessCards();
  fillProgression();
  fillPilotTable();
  fillFormulaCards();
  fillFormulaTable();
  fillFairnessResult();
  fillOptionalTable();
  fillGallery();
  fillLeaderboard();
  fillAdminActions();
  await fillStatsVisuals();
  heroDeckIndex = Math.max(0, getMergedEpochs().findIndex((item) => item.key === getEffectiveLiveEntryKey()));
  renderDelayState();
  setupTabs();
  setupThemeToggle();
  setupTabShortcuts();
  setupDelayControls();
  setupHeroDeckControls();
  setupHeroQuotes();
  setupWalletCheck();
  setupGalleryFilter();
  syncAdminSettingsStatus();
  activatePanelFromHash(window.location.hash);
  window.addEventListener("hashchange", () => {
    activatePanelFromHash(window.location.hash);
  });
}

init();
