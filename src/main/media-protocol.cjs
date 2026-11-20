const { open } = require('node:fs/promises');
const { extname } = require('node:path');
const { Readable } = require('node:stream');

const mimeTypes = {
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.m4a': 'audio/mp4',
  '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.aiff': 'audio/aiff',
  '.wma': 'audio/x-ms-wma', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
};

function byteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  const suffix = !match[1];
  const first = suffix ? 0 : Number(match[1]);
  const last = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return null;
  if (suffix) return last > 0 ? { start: Math.max(0, size - last), end: size - 1 } : null;
  if (first >= size || last < first) return null;
  return { start: first, end: Math.min(last, size - 1) };
}

/** A registered local file acts like a seekable media resource for Chromium. */
async function serveStudioMedia(request, filePath) {
  if (!filePath) return new Response('Not found', { status: 404 });
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });

  let file;
  try {
    file = await open(filePath, 'r');
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 1) return new Response('Not found', { status: 404 });
    const headers = new Headers({
      'Content-Type': mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Cache-Control': 'no-store',
    });
    const requestedRange = request.method === 'GET' ? request.headers.get('range') : null;
    const range = requestedRange === null ? null : byteRange(requestedRange, stat.size);
    if (requestedRange !== null && range === null) {
      headers.set('Content-Range', 'bytes */' + stat.size);
      return new Response(null, { status: 416, headers });
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? stat.size - 1;
    headers.set('Content-Length', String(end - start + 1));
    if (range) headers.set('Content-Range', 'bytes ' + start + '-' + end + '/' + stat.size);
    if (request.method === 'HEAD') return new Response(null, { headers });
    const stream = file.createReadStream({ start, end });
    file = undefined; // The stream closes the file on completion or cancellation.
    return new Response(Readable.toWeb(stream), { status: range ? 206 : 200, headers });
  } catch (error) {
    const status = error?.code === 'ENOENT' ? 404 : 500;
    return new Response(status === 404 ? 'Not found' : 'Could not read media', { status });
  } finally {
    await file?.close().catch(() => {});
  }
}

module.exports = { serveStudioMedia };
