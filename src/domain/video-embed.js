const DIRECT_VIDEO_MIME_TYPES = Object.freeze({
  '.mp4': 'video/mp4',
  '.ogg': 'video/ogg',
  '.webm': 'video/webm',
});

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

function getDirectVideoMimeType(pathname = '') {
  const match = pathname.toLowerCase().match(/\.(mp4|ogg|webm)$/iu);
  return match ? DIRECT_VIDEO_MIME_TYPES[`.${match[1].toLowerCase()}`] : null;
}

function normalizeYouTubeVideoId(candidate = '') {
  const normalized = String(candidate || '').trim();
  return /^[A-Za-z0-9_-]{11}$/u.test(normalized) ? normalized : null;
}

function parseVideoUrl(source = '') {
  try {
    return new URL(String(source || '').trim());
  } catch {
    return null;
  }
}

export function extractYouTubeVideoId(source = '') {
  const url = source instanceof URL ? source : parseVideoUrl(source);
  if (!url) return '';

  const host = url.hostname.toLowerCase();
  if (host === 'youtu.be' || host === 'www.youtu.be') {
    return url.pathname.split('/').filter(Boolean)[0] || '';
  }

  if (host.includes('youtube') || host.includes('youtube-nocookie')) {
    if (url.pathname === '/watch') {
      return url.searchParams.get('v') || '';
    }

    if (url.pathname.startsWith('/embed/')) {
      return url.pathname.split('/').filter(Boolean)[1] || '';
    }
  }

  return '';
}

function getCanonicalYouTubeEmbedUrl(url) {
  const videoId = normalizeYouTubeVideoId(extractYouTubeVideoId(url));
  return videoId ? `https://www.youtube-nocookie.com/embed/${videoId}` : null;
}

export function isPublicVideoEmbedCandidate(source = '') {
  const url = parseVideoUrl(source);
  return Boolean(url && (
    YOUTUBE_HOSTS.has(url.hostname.toLowerCase())
    || getDirectVideoMimeType(url.pathname)
  ));
}

export function classifyPublicVideoEmbed(source = '') {
  const url = parseVideoUrl(source);
  if (!url || url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase();
  if (YOUTUBE_HOSTS.has(host)) {
    const embedUrl = getCanonicalYouTubeEmbedUrl(url);
    return embedUrl ? { embedUrl, type: 'youtube' } : null;
  }

  const mimeType = getDirectVideoMimeType(url.pathname);
  return mimeType ? {
    mimeType,
    sourceUrl: url.toString(),
    type: 'direct-video',
  } : null;
}
