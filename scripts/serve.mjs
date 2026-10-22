import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.ico': 'image/x-icon' };

export function serve(port = 4173) {
  return createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!path.startsWith(root + sep) || /(?:^|[\\/])\./.test(path.slice(root.length))) {
        res.writeHead(403).end();
        return;
      }
      const info = await stat(path);
      if (!info.isFile()) throw new Error('Not a file');
      const headers = { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes' };
      let start = 0;
      let end = info.size - 1;
      if (req.headers.range) {
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (!range || (!range[1] && !range[2])) {
          res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }).end();
          return;
        }
        start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
        end = range[1] && range[2] ? Math.min(end, Number(range[2])) : end;
        if (start > end || start >= info.size) {
          res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }).end();
          return;
        }
        headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
      }
      headers['Content-Length'] = end - start + 1;
      res.writeHead(req.headers.range ? 206 : 200, headers);
      if (req.method === 'HEAD') res.end();
      else createReadStream(path, { start, end }).pipe(res);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    }
  }).listen(port, '127.0.0.1');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  serve(port);
  console.log(`MK Cinema: http://127.0.0.1:${port}/?demo`);
}
