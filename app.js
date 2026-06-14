const form = document.querySelector("#link-form");
const urlInput = document.querySelector("#url-input");
const resultTitle = document.querySelector("#result-title");
const previewShell = document.querySelector("#preview-shell");
const metadata = document.querySelector("#metadata");
const actions = document.querySelector("#actions");
const messages = document.querySelector("#messages");
const qualityBadge = document.querySelector("#quality-badge");
const queueList = document.querySelector("#queue-list");
const clipButton = document.querySelector("#clip-button");
const clipStart = document.querySelector("#clip-start");
const clipEnd = document.querySelector("#clip-end");
const clipFormat = document.querySelector("#clip-format");
const clipProgress = document.querySelector("#clip-progress");
const clipStatus = document.querySelector("#clip-status");

let current = null;
let currentVideo = null;
const history = [];

const DIRECT_SAMPLE =
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

urlInput.value = DIRECT_SAMPLE;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await analyze(urlInput.value.trim());
});

document.querySelectorAll("[data-duration]").forEach((button) => {
  button.addEventListener("click", () => {
    const start = parseTime(clipStart.value);
    const duration = Number(button.dataset.duration);
    clipEnd.value = formatTime(start + duration);
  });
});

clipButton.addEventListener("click", () => {
  exportSegment().catch((error) => {
    setClipStatus(error.message, true);
  });
});

function normalizeInput(value) {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

async function analyze(value) {
  const url = normalizeInput(value);
  if (!url) return;

  setBusy(true);
  clearMessages();
  resultTitle.textContent = "Analyzing link";
  previewShell.innerHTML = loadingMarkup();
  actions.innerHTML = "";

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Could not analyze that link.");
    }

    current = data;
    renderResult(data);
    addToQueue(data.platform.name, data.url, data.media.kind, data.media.direct);
  } catch (error) {
    current = null;
    currentVideo = null;
    clipButton.disabled = true;
    resultTitle.textContent = "Link needs attention";
    previewShell.innerHTML = emptyMarkup("The link could not be analyzed.");
    setMetadata();
    addMessage(error.message, true);
  } finally {
    setBusy(false);
  }
}

function renderResult(data) {
  currentVideo = null;
  const media = data.media;
  const platformName = data.platform.name;
  const proxyUrl = `/api/proxy?url=${encodeURIComponent(data.finalUrl)}`;
  const downloadUrl = `${proxyUrl}&download=1`;

  resultTitle.textContent = media.direct
    ? `${titleCase(media.kind)} found`
    : `${platformName} access`;

  qualityBadge.textContent = media.direct ? "HD" : "Access";
  qualityBadge.title = media.direct
    ? "Downloads use the original source bytes."
    : "Protected services open through legal platform routes.";

  renderPreview(media, proxyUrl, data);
  setMetadata(media, data.platform);
  renderActions(data, downloadUrl);
  renderMessages(data);

  const canClip = media.direct && media.kind === "video";
  clipButton.disabled = !canClip;
  setClipStatus(
    canClip
      ? "Ready. Segment export records the selected part from the HD video stream."
      : "Analyze a direct video link to enable segment export.",
    false
  );
}

function renderPreview(media, proxyUrl, data) {
  previewShell.classList.remove("empty");
  previewShell.innerHTML = "";

  if (media.direct && media.kind === "image") {
    const image = document.createElement("img");
    image.alt = "Linked media preview";
    image.src = proxyUrl;
    previewShell.append(image);
    return;
  }

  if (media.direct && media.kind === "video") {
    const video = document.createElement("video");
    video.controls = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    video.preload = "metadata";
    video.src = proxyUrl;
    video.addEventListener("loadedmetadata", () => {
      const end = Math.min(15, Math.floor(video.duration || 15));
      clipStart.value = "00:00:00";
      clipEnd.value = formatTime(end);
      if (video.videoWidth && video.videoHeight) {
        addMessage(`Source preview: ${video.videoWidth} x ${video.videoHeight}.`);
      }
    }, { once: true });
    currentVideo = video;
    previewShell.append(video);
    return;
  }

  if (media.direct && media.kind === "audio") {
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = proxyUrl;
    previewShell.append(audio);
    return;
  }

  previewShell.classList.add("empty");
  previewShell.innerHTML = platformMarkup(data);
}

function renderActions(data, downloadUrl) {
  actions.innerHTML = "";

  if (data.media.direct) {
    actions.append(
      createAction("Download original HD", downloadUrl, true),
      createButton("Copy direct link", () => copyText(data.finalUrl)),
      createAction("Open source", data.finalUrl, false)
    );
  }

  data.access
    .filter((item) => !(data.media.direct && item.label === "Open original"))
    .forEach((item) => {
    actions.append(createAction(item.label, item.url, !data.media.direct && item.label === "Open original"));
    });
}

function renderMessages(data) {
  clearMessages();
  if (data.media.direct) {
    addMessage("Direct media detected. Download keeps the original source clarity.");
    if (data.media.kind === "video" && !data.media.acceptRanges) {
      addMessage("This server may not support byte ranges, so seeking can be slower.", true);
    }
  }

  data.warnings.forEach((warning) => addMessage(warning, true));
}

function setMetadata(media = null, platform = null) {
  const type = media ? `${media.kind}${media.contentType ? ` / ${media.contentType}` : ""}` : "waiting";
  const size = media && media.size ? formatBytes(media.size) : "unknown";
  const range = media ? (media.acceptRanges ? "supported" : "not advertised") : "unknown";
  const platformName = platform ? platform.name : "none";

  metadata.innerHTML = `
    <span title="${type}">Type: ${escapeHtml(type)}</span>
    <span title="${size}">Size: ${escapeHtml(size)}</span>
    <span title="${platformName}">Platform: ${escapeHtml(platformName)}</span>
  `;

  if (media) {
    metadata.insertAdjacentHTML(
      "beforeend",
      `<span title="${range}">Range: ${escapeHtml(range)}</span>`
    );
  }
}

async function exportSegment() {
  if (!currentVideo || !current || current.media.kind !== "video") {
    throw new Error("Analyze a direct video link first.");
  }

  if (!("MediaRecorder" in window)) {
    throw new Error("This browser does not support MediaRecorder segment export.");
  }

  const start = parseTime(clipStart.value);
  const end = parseTime(clipEnd.value);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error("Enter a valid start and end time.");
  }

  const duration = end - start;
  if (duration > 900) {
    throw new Error("Keep browser exports to 15 minutes or less for reliability.");
  }

  const mimeType = MediaRecorder.isTypeSupported(clipFormat.value)
    ? clipFormat.value
    : "video/webm";
  const bits = bitrateFor(currentVideo.videoWidth, currentVideo.videoHeight);
  const stream = currentVideo.captureStream
    ? currentVideo.captureStream()
    : currentVideo.mozCaptureStream && currentVideo.mozCaptureStream();

  if (!stream) {
    throw new Error("This browser cannot capture the video stream.");
  }

  const chunks = [];
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: bits,
    audioBitsPerSecond: 192000,
  });

  clipProgress.value = 0;
  setClipStatus("Preparing segment...");

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };

  const finished = new Promise((resolve, reject) => {
    recorder.onstop = resolve;
    recorder.onerror = () => reject(recorder.error || new Error("Segment export failed."));
  });

  currentVideo.pause();
  currentVideo.currentTime = start;
  await waitForSeek(currentVideo);

  recorder.start(1000);
  await currentVideo.play();
  setClipStatus("Recording segment in real time...");

  const startTime = performance.now();
  const watcher = window.setInterval(() => {
    const elapsed = (performance.now() - startTime) / 1000;
    clipProgress.value = Math.min(100, (elapsed / duration) * 100);
    if (currentVideo.currentTime >= end || currentVideo.ended) {
      window.clearInterval(watcher);
      currentVideo.pause();
      if (recorder.state !== "inactive") recorder.stop();
    }
  }, 180);

  await finished;
  clipProgress.value = 100;

  const blob = new Blob(chunks, { type: "video/webm" });
  const name = `${baseFilename(current.media.filename)}-${formatTime(start).replaceAll(":", "")}-${formatTime(end).replaceAll(":", "")}.webm`;
  downloadBlob(blob, name);
  addToQueue("Segment export", name, `${Math.round(duration)}s clip`, true);
  setClipStatus(`Segment ready: ${name}`);
}

function waitForSeek(video) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Video seek timed out."));
    }, 12000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("seeked", onSeeked);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
  });
}

function createAction(label, href, primary) {
  const link = document.createElement("a");
  link.className = `action-button${primary ? " primary" : ""}`;
  link.href = href;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = label;
  return link;
}

function createButton(label, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "action-button";
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

async function copyText(value) {
  await navigator.clipboard.writeText(value);
  addMessage("Link copied.");
}

function setBusy(isBusy) {
  const button = form.querySelector("button");
  button.disabled = isBusy;
  button.textContent = isBusy ? "Checking..." : "Analyze";
}

function addMessage(text, warning = false) {
  const item = document.createElement("div");
  item.className = `message${warning ? " warning" : ""}`;
  item.textContent = text;
  messages.append(item);
}

function clearMessages() {
  messages.innerHTML = "";
}

function setClipStatus(text, warning = false) {
  clipStatus.textContent = text;
  clipStatus.style.color = warning ? "#8b4b12" : "";
}

function addToQueue(title, url, kind, downloadable) {
  history.unshift({ title, url, kind, downloadable, time: new Date() });
  if (history.length > 8) history.pop();

  queueList.innerHTML = "";
  history.forEach((item) => {
    const row = document.createElement("div");
    row.className = "queue-item";
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.kind)} - ${escapeHtml(item.url)}</span>
      </div>
      <span>${item.downloadable ? "Ready" : "Access"}</span>
    `;
    queueList.append(row);
  });
}

function parseTime(value) {
  const parts = String(value)
    .trim()
    .split(":")
    .map((part) => Number(part));

  if (parts.some((part) => !Number.isFinite(part))) return NaN;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return NaN;
}

function formatTime(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function formatBytes(bytes) {
  if (!bytes) return "unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function titleCase(value) {
  return String(value || "media").replace(/^\w/, (letter) => letter.toUpperCase());
}

function bitrateFor(width, height) {
  const pixels = (width || 1280) * (height || 720);
  if (pixels >= 3840 * 2160) return 28000000;
  if (pixels >= 2560 * 1440) return 16000000;
  if (pixels >= 1920 * 1080) return 9000000;
  return 5500000;
}

function baseFilename(filename) {
  return String(filename || "segment").replace(/\.[^/.]+$/, "").replace(/[\\/:*?"<>|]+/g, "-");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function loadingMarkup() {
  return `
    <div class="empty-state">
      <span class="empty-icon">...</span>
      <p>Checking platform, media type, and HD download route.</p>
    </div>
  `;
}

function emptyMarkup(text) {
  return `
    <div class="empty-state">
      <span class="empty-icon">+</span>
      <p>${escapeHtml(text)}</p>
    </div>
  `;
}

function platformMarkup(data) {
  return `
    <div class="empty-state">
      <span class="empty-icon">HD</span>
      <p>${escapeHtml(data.platform.name)} links are handled through legal platform access. Direct download appears when the link is a public media file.</p>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
