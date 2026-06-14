const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const dns = require("dns").promises;
const net = require("net");

const ROOT = path.join(__dirname, "public");
const DEFAULT_PORT = Number(process.env.PORT || 4173);
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LinkHDStudio/1.0";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

const MEDIA_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".avif",
  ".bmp",
  ".svg",
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
  ".mkv",
  ".avi",
  ".mp3",
  ".wav",
  ".ogg",
  ".m4a",
]);

const PLATFORM_RULES = [
  {
    key: "youtube",
    name: "YouTube",
    hosts: ["youtube.com", "youtu.be", "youtube-nocookie.com"],
    category: "video",
    protected: true,
    home: "https://www.youtube.com/",
  },
  {
    key: "instagram",
    name: "Instagram",
    hosts: ["instagram.com"],
    category: "reels",
    protected: true,
    home: "https://www.instagram.com/",
  },
  {
    key: "tiktok",
    name: "TikTok",
    hosts: ["tiktok.com"],
    category: "short video",
    protected: true,
    home: "https://www.tiktok.com/",
  },
  {
    key: "x",
    name: "X / Twitter",
    hosts: ["x.com", "twitter.com"],
    category: "social video",
    protected: true,
    home: "https://x.com/",
  },
  {
    key: "vimeo",
    name: "Vimeo",
    hosts: ["vimeo.com"],
    category: "video",
    protected: true,
    home: "https://vimeo.com/",
  },
  {
    key: "facebook",
    name: "Facebook",
    hosts: ["facebook.com", "fb.watch"],
    category: "social video",
    protected: true,
    home: "https://www.facebook.com/watch/",
  },
  {
    key: "netflix",
    name: "Netflix",
    hosts: ["netflix.com"],
    category: "movie",
    protected: true,
    home: "https://www.netflix.com/",
  },
  {
    key: "prime",
    name: "Prime Video",
    hosts: ["primevideo.com", "amazon.com"],
    category: "movie",
    protected: true,
    home: "https://www.primevideo.com/",
  },
  {
    key: "disney",
    name: "Disney+",
    hosts: ["disneyplus.com"],
    category: "movie",
    protected: true,
    home: "https://www.disneyplus.com/",
  },
  {
    key: "hulu",
    name: "Hulu",
    hosts: ["hulu.com"],
    category: "movie",
    protected: true,
    home: "https://www.hulu.com/",
  },
  {
    key: "max",
    name: "Max",
    hosts: ["max.com", "hbomax.com"],
    category: "movie",
    protected: true,
    home: "https://www.max.com/",
  },
  {
    key: "apple-tv",
    name: "Apple TV",
    hosts: ["tv.apple.com"],
    category: "movie",
    protected: true,
    home: "https://tv.apple.com/",
  },
  {
    key: "hotstar",
    name: "Disney+ Hotstar",
    hosts: ["hotstar.com"],
    category: "movie",
    protected: true,
    home: "https://www.hotstar.com/",
  },
];

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function normalizeHost(hostname) {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function isPrivateIp(address) {
  if (net.isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 169 && parts[1] === 254) ||
      parts[0] === 0
    );
  }

  if (net.isIP(address) === 6) {
    const value = address.toLowerCase();
    return (
      value === "::1" ||
      value.startsWith("fc") ||
      value.startsWith("fd") ||
      value.startsWith("fe80:") ||
      value === "::"
    );
  }

  return false;
}

async function validateRemoteUrl(input) {
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error("Enter a valid http or https URL.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https links are supported.");
  }

  const host = normalizeHost(parsed.hostname);
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new Error("Local/private links are blocked for safety.");
  }

  if (net.isIP(parsed.hostname)) {
    if (isPrivateIp(parsed.hostname)) {
      throw new Error("Local/private links are blocked for safety.");
    }
    return parsed;
  }

  let addresses = [];
  try {
    addresses = await dns.lookup(parsed.hostname, { all: true });
  } catch {
    throw new Error("Could not resolve that link.");
  }

  if (addresses.some((entry) => isPrivateIp(entry.address))) {
    throw new Error("Local/private links are blocked for safety.");
  }

  return parsed;
}

function detectPlatform(rawUrl) {
  const parsed = new URL(rawUrl);
  const host = normalizeHost(parsed.hostname);
  const match = PLATFORM_RULES.find((rule) =>
    rule.hosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`))
  );

  if (!match) {
    return {
      key: "direct",
      name: "Direct / public link",
      category: "public media",
      protected: false,
      home: rawUrl,
    };
  }

  return match;
}

function guessSearchQuery(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const stopwords = new Set([
      "title",
      "watch",
      "video",
      "videos",
      "movie",
      "movies",
      "reel",
      "reels",
      "shorts",
      "share",
      "p",
      "tv",
    ]);
    const chunks = parsed.pathname
      .split("/")
      .filter(Boolean)
      .filter((part) => !/^[a-z]*\d+[a-z\d_-]*$/i.test(part))
      .map((part) => decodeURIComponent(part).replace(/[-_+]/g, " "))
      .filter((part) => !stopwords.has(part.toLowerCase()))
      .filter((part) => part.length > 2)
      .slice(-2);
    return chunks.join(" ").trim() || parsed.hostname.replace(/^www\./, "");
  } catch {
    return rawUrl;
  }
}

function getExtension(rawUrl) {
  try {
    return path.extname(new URL(rawUrl).pathname).toLowerCase();
  } catch {
    return "";
  }
}

function inferKind(contentType, ext) {
  const type = String(contentType || "").toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp", ".svg"].includes(ext)) {
    return "image";
  }
  if ([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"].includes(ext)) return "video";
  if ([".mp3", ".wav", ".ogg", ".m4a"].includes(ext)) return "audio";
  return "unknown";
}

function formatFilename(rawUrl, kind, contentType) {
  let base = "media";
  let ext = getExtension(rawUrl);

  try {
    const parsed = new URL(rawUrl);
    const last = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "");
    if (last) base = last.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 90);
  } catch {
    // Keep default.
  }

  if (!path.extname(base)) {
    if (contentType.includes("png")) ext = ".png";
    else if (contentType.includes("webp")) ext = ".webp";
    else if (contentType.includes("jpeg") || contentType.includes("jpg")) ext = ".jpg";
    else if (contentType.includes("mp4")) ext = ".mp4";
    else if (contentType.includes("quicktime")) ext = ".mov";
    else if (contentType.includes("webm")) ext = ".webm";
    else if (kind === "image") ext = ".jpg";
    else if (kind === "video") ext = ".mp4";
    else if (kind === "audio") ext = ".mp3";
    base += ext || ".bin";
  }

  return base;
}

function requestHeaders(targetUrl, method, extraHeaders = {}, redirects = 0) {
  return new Promise(async (resolve, reject) => {
    if (redirects > 5) {
      reject(new Error("Too many redirects."));
      return;
    }

    let parsed;
    try {
      parsed = await validateRemoteUrl(targetUrl);
    } catch (error) {
      reject(error);
      return;
    }

    const client = parsed.protocol === "https:" ? https : http;
    const request = client.request(
      parsed,
      {
        method,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "*/*",
          ...extraHeaders,
        },
      },
      (remoteRes) => {
        const location = remoteRes.headers.location;
        if (
          location &&
          remoteRes.statusCode >= 300 &&
          remoteRes.statusCode < 400
        ) {
          remoteRes.resume();
          const next = new URL(location, parsed).toString();
          requestHeaders(next, method, extraHeaders, redirects + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        remoteRes.resume();
        remoteRes.on("end", () => {
          resolve({
            statusCode: remoteRes.statusCode || 0,
            headers: remoteRes.headers,
            finalUrl: parsed.toString(),
          });
        });
      }
    );

    request.setTimeout(15000, () => {
      request.destroy(new Error("The remote server took too long to respond."));
    });

    request.on("error", reject);
    request.end();
  });
}

async function analyzeUrl(rawUrl) {
  const parsed = await validateRemoteUrl(rawUrl);
  const platform = detectPlatform(parsed.toString());
  let meta;

  try {
    meta = await requestHeaders(parsed.toString(), "HEAD");
    const weakType = !meta.headers["content-type"];
    if ([405, 403, 404].includes(meta.statusCode) || weakType) {
      meta = await requestHeaders(parsed.toString(), "GET", { Range: "bytes=0-0" });
    }
  } catch (error) {
    const ext = getExtension(parsed.toString());
    const kind = inferKind("", ext);
    return {
      ok: true,
      url: parsed.toString(),
      finalUrl: parsed.toString(),
      platform,
      media: {
        kind,
        direct: kind !== "unknown" && !platform.protected,
        contentType: "",
        size: 0,
        acceptRanges: false,
        extension: ext,
        filename: formatFilename(parsed.toString(), kind, ""),
      },
      access: buildAccessLinks(parsed.toString(), platform),
      warnings: [
        error.message || "The server did not expose metadata, but the link can still be opened.",
      ],
    };
  }

  const finalUrl = meta.finalUrl || parsed.toString();
  const contentType = String(meta.headers["content-type"] || "").split(";")[0].trim();
  const contentRange = String(meta.headers["content-range"] || "");
  const ext = getExtension(finalUrl) || getExtension(parsed.toString());
  const kind = inferKind(contentType, ext);
  const contentLength = Number(meta.headers["content-length"] || 0);
  const rangedLengthMatch = contentRange.match(/\/(\d+)$/);
  const size = rangedLengthMatch ? Number(rangedLengthMatch[1]) : contentLength;
  const direct =
    kind !== "unknown" &&
    !contentType.includes("text/html") &&
    (!platform.protected || MEDIA_EXTENSIONS.has(ext));

  return {
    ok: true,
    url: parsed.toString(),
    finalUrl,
    platform,
    media: {
      kind,
      direct,
      contentType,
      size: Number.isFinite(size) ? size : 0,
      acceptRanges:
        String(meta.headers["accept-ranges"] || "").toLowerCase() === "bytes" ||
        Boolean(contentRange),
      extension: ext,
      filename: formatFilename(finalUrl, kind, contentType),
    },
    access: buildAccessLinks(finalUrl, platform),
    warnings: direct
      ? []
      : [
          "This looks like a page or protected platform link. Use the legal access buttons instead of direct download.",
        ],
  };
}

function buildAccessLinks(rawUrl, platform) {
  const query = encodeURIComponent(guessSearchQuery(rawUrl));
  const links = [
    {
      label: "Open original",
      url: rawUrl,
    },
  ];

  if (platform.home && platform.home !== rawUrl) {
    links.push({
      label: `Open ${platform.name}`,
      url: platform.home,
    });
  }

  if (platform.category === "movie") {
    links.push({
      label: "Find legal movie access",
      url: `https://www.justwatch.com/us/search?q=${query}`,
    });
  } else {
    links.push({
      label: "Search the web",
      url: `https://www.google.com/search?q=${query}`,
    });
  }

  return links;
}

async function proxyRemote(req, res, rawUrl, download) {
  let parsed;
  try {
    parsed = await validateRemoteUrl(rawUrl);
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message });
    return;
  }

  const follow = async (target, redirects = 0) => {
    if (redirects > 5) {
      sendJson(res, 508, { ok: false, error: "Too many redirects." });
      return;
    }

    let remoteUrl;
    try {
      remoteUrl = await validateRemoteUrl(target);
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message });
      return;
    }

    const client = remoteUrl.protocol === "https:" ? https : http;
    const headers = {
      "User-Agent": USER_AGENT,
      Accept: "*/*",
    };

    if (req.headers.range) {
      headers.Range = req.headers.range;
    }

    const remoteReq = client.request(remoteUrl, { method: "GET", headers }, (remoteRes) => {
      const location = remoteRes.headers.location;
      if (
        location &&
        remoteRes.statusCode >= 300 &&
        remoteRes.statusCode < 400
      ) {
        remoteRes.resume();
        follow(new URL(location, remoteUrl).toString(), redirects + 1);
        return;
      }

      const contentType = String(remoteRes.headers["content-type"] || "");
      const ext = getExtension(remoteUrl.toString());
      const isMedia =
        contentType.startsWith("image/") ||
        contentType.startsWith("video/") ||
        contentType.startsWith("audio/") ||
        MEDIA_EXTENSIONS.has(ext);

      if (!isMedia || contentType.includes("text/html")) {
        remoteRes.resume();
        sendJson(res, 415, {
          ok: false,
          error: "This link is not a direct image, audio, or video file.",
        });
        return;
      }

      const responseHeaders = {
        "Content-Type": contentType || "application/octet-stream",
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      };

      ["content-length", "content-range", "last-modified", "etag"].forEach((header) => {
        if (remoteRes.headers[header]) {
          responseHeaders[header
            .split("-")
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join("-")] = remoteRes.headers[header];
        }
      });

      if (download) {
        const kind = inferKind(contentType, ext);
        const filename = formatFilename(remoteUrl.toString(), kind, contentType);
        responseHeaders["Content-Disposition"] = `attachment; filename="${filename.replace(/"/g, "")}"`;
      }

      res.writeHead(remoteRes.statusCode || 200, responseHeaders);
      remoteRes.pipe(res);
    });

    remoteReq.setTimeout(30000, () => {
      remoteReq.destroy(new Error("The remote server took too long to respond."));
    });

    remoteReq.on("error", (error) => {
      if (!res.headersSent) {
        sendJson(res, 502, { ok: false, error: error.message });
      } else {
        res.destroy(error);
      }
    });

    remoteReq.end();
  };

  follow(parsed.toString());
}

function serveStatic(req, res) {
  const requestUrl = new URL(req.url, "http://localhost");
  let pathname = decodeURIComponent(requestUrl.pathname);
  if (pathname === "/") pathname = "/index.html";

  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Content-Length": stats.size,
      "Cache-Control": "no-store",
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Range",
    });
    res.end();
    return;
  }

  if (requestUrl.pathname === "/api/analyze" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) req.destroy();
    });
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const result = await analyzeUrl(payload.url || "");
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message });
      }
    });
    return;
  }

  if (requestUrl.pathname === "/api/proxy" && req.method === "GET") {
    proxyRemote(req, res, requestUrl.searchParams.get("url") || "", requestUrl.searchParams.has("download"));
    return;
  }

  serveStatic(req, res);
});

server.listen(DEFAULT_PORT, () => {
  console.log(`Link HD Studio running at http://localhost:${DEFAULT_PORT}`);
});
