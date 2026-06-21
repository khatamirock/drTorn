import http from 'http';
import express from 'express';

function createLocalVideoServer(file: any, contentType: string): Promise<{ server: http.Server, url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer((localReq, localRes) => {
      const range = localReq.headers.range;
      const fileSize = file.length;
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        const fileStream = file.createReadStream({ start, end });
        fileStream.on('error', () => {});
        localRes.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': contentType,
        });
        fileStream.pipe(localRes);
        localReq.on('close', () => { try { fileStream.destroy(); } catch(e){} });
      } else {
        localRes.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': contentType,
        });
        const fileStream = file.createReadStream();
        fileStream.on('error', () => {});
        fileStream.pipe(localRes);
        localReq.on('close', () => { try { fileStream.destroy(); } catch(e){} });
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as any;
      resolve({ server, url: `http://127.0.0.1:${address.port}/` });
    });
  });
}
import path from 'path';
import torrentStream from 'torrent-stream';
import { google } from 'googleapis';
import crypto from 'crypto';
import os from 'os';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic);
}
if (ffprobeStatic && ffprobeStatic.path) {
  ffmpeg.setFfprobePath(ffprobeStatic.path);
}

// In-memory store for torrent sessions
const sessions = new Map<string, any>();
// Store promises to prevent concurrent duplicate session creation
const sessionPromises = new Map<string, Promise<any>>();

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

function getSessionId(magnet: string, action: string) {
  return crypto.createHash('md5').update(magnet + action).digest('hex');
}

async function ensureSession(sessionId: string, magnet: string, action: string, accessToken?: string, baseUrl?: string) {
  let session = sessions.get(sessionId);
  if (session && session.engine) {
    return session;
  }

  if (sessionPromises.has(sessionId)) {
    return sessionPromises.get(sessionId);
  }

  const promise = new Promise((resolve, reject) => {
    sessions.set(sessionId, {
      id: sessionId,
      status: 'connecting',
      progress: 0,
      speed: 0,
      peers: 0,
      fileName: '',
      fileSize: 0,
      error: null,
      action: action,
      engine: null,
      file: null
    });

    const downloadPath = process.env.VERCEL ? path.join(os.tmpdir(), 'webtorrent') : path.join(process.cwd(), '.downloads');
    if (!fs.existsSync(downloadPath)) {
      fs.mkdirSync(downloadPath, { recursive: true });
    }
    
    const engine = torrentStream(magnet, {
      tmp: downloadPath,
      trackers: [
        'udp://tracker.opentrackr.org:1337/announce',
        'udp://open.demonii.com:1337/announce',
        'udp://tracker.openbittorrent.com:80',
        'udp://tracker.ccp.ovh:6969/announce',
        'udp://exodus.desync.com:6969',
        'wss://tracker.btorrent.xyz',
        'wss://tracker.openwebtorrent.com',
        'wss://tracker.fastcast.nz',
        'http://tracker.openbittorrent.com:80/announce',
        'http://tracker2.wasabii.com.tw:6969/announce'
      ]
    });

    engine.on('ready', async () => {
      let file: any = engine.files[0];
      for (const f of engine.files) {
        if (action === 'stream' && (f.name.endsWith('.mp4') || f.name.endsWith('.mkv') || f.name.endsWith('.webm'))) {
            if (!file.name.match(/\.(mp4|mkv|webm)$/i) || f.length > file.length) file = f;
        } else {
           if (f.length > file.length) file = f;
        }
      }

      const session = sessions.get(sessionId);
      if (!session) return reject(new Error('Session deleted'));
      
      session.fileName = file.name;
      session.fileSize = file.length;
      session.engine = engine;
      session.file = file;

      if (action === 'stream') {
         session.status = 'ready_to_stream';
         file.select();
         
         let _contentType = 'video/mp4';
         if (file.name.endsWith('.mkv')) _contentType = 'video/x-matroska';
         if (file.name.endsWith('.webm')) _contentType = 'video/webm';

         createLocalVideoServer(file, _contentType).then(({ server, url }) => {
            ffmpeg.ffprobe(url, (err, metadata) => {
                 if (!err && metadata && metadata.format && metadata.format.duration) {
                     const s = sessions.get(sessionId);
                     if (s) s.duration = parseFloat(metadata.format.duration);
                 }
                 try { server.close(); } catch(e){}
             });
         });
         
         let interval = setInterval(() => {
           const s = sessions.get(sessionId);
           if (s && s.status === 'ready_to_stream') {
             const downloaded = engine.swarm.downloaded;
             s.speed = engine.swarm.downloadSpeed();
             s.peers = engine.swarm.wires.length;
             s.progress = (downloaded / file.length) * 100;
           } else {
               clearInterval(interval);
           }
         }, 1000);
         
         return resolve(session);
      }

      session.status = 'uploading';

      if (accessToken) {
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: accessToken });
        const drive = google.drive({ version: 'v3', auth });
        
        let interval = setInterval(() => {
          const s = sessions.get(sessionId);
          if (s && s.status === 'uploading') {
            const downloaded = engine.swarm.downloaded;
            s.speed = engine.swarm.downloadSpeed();
            s.peers = engine.swarm.wires.length;
            s.progress = (downloaded / file.length) * 100;
          }
        }, 1000);

        try {
          await drive.files.create({
            requestBody: { name: file.name },
            media: { body: file.createReadStream() },
          });

          const s = sessions.get(sessionId);
          if (s) {
            s.status = 'completed';
            s.progress = 100;
          }
        } catch (err: any) {
          console.error('Upload Error:', err);
          const s = sessions.get(sessionId);
          if (s) {
            s.status = 'error';
            s.error = err.message || 'Upload failed';
          }
        } finally {
          clearInterval(interval);
          try { engine.destroy(() => {}); } catch(e) {}
        }
      }
      resolve(session);
    });
    
    engine.on('error', (err: any) => {
       console.error('Engine error:', err);
       const s = sessions.get(sessionId);
       if (s) {
         s.status = 'error';
         s.error = err.message;
       }
       sessionPromises.delete(sessionId);
       reject(err);
    });
  });
  
  sessionPromises.set(sessionId, promise as Promise<any>);
  
  promise.then(() => {
    sessionPromises.delete(sessionId);
  }).catch(() => {
    sessionPromises.delete(sessionId);
  });
  
  return promise;
}

const app = express();
app.use(express.json());

// --- API ROUTES ---

app.post('/api/torrent/start', async (req, res) => {
  try {
    const { magnet, accessToken, action = 'save' } = req.body;
    
    if (!magnet || (action === 'save' && !accessToken)) {
      return res.status(400).json({ error: 'Magnet link and access token are required for saving to Drive' });
    }

    const sessionId = getSessionId(magnet, action);
    const protocol = req.headers['x-forwarded-proto'] || (req.connection.encrypted ? 'https' : 'http');
    const host = req.headers.host || '127.0.0.1:3000';
    const baseUrl = `${protocol}://${host}`;
    
    // Fire and forget ensureSession
    ensureSession(sessionId, magnet, action, accessToken, baseUrl).catch(e => console.error(e));

    res.json({ sessionId });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/torrent/status/:id', async (req, res) => {
  let session = sessions.get(req.params.id);
  
  if (!session && req.query.magnet && req.query.action) {
    try {
      const protocol = req.headers['x-forwarded-proto'] || (req.connection.encrypted ? 'https' : 'http');
      const host = req.headers.host || '127.0.0.1:3000';
      const baseUrl = `${protocol}://${host}`;
      session = await ensureSession(req.params.id, req.query.magnet as string, req.query.action as string, undefined, baseUrl);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  // Omit sensitive structures
  const { engine, file, ...safeSession } = session;
  res.json(safeSession);
});

app.get('/api/torrent/stream/:id', async (req, res) => {
  let session = sessions.get(req.params.id);

  if ((!session || !session.file || !session.engine) && req.query.magnet) {
    try {
      const protocol = req.headers['x-forwarded-proto'] || (req.connection.encrypted ? 'https' : 'http');
      const host = req.headers.host || '127.0.0.1:3000';
      const baseUrl = `${protocol}://${host}`;
      session = await ensureSession(req.params.id, req.query.magnet as string, 'stream', undefined, baseUrl);
    } catch (err: any) {
      return res.status(500).send('Failed to initialize stream session');
    }
  }

  if (!session || !session.file || !session.engine) {
    return res.status(404).send('Not found or not ready');
  }

  const file = session.file;
  const fileSize = file.length;
  let contentType = 'video/mp4';
  if (file.name.endsWith('.mkv')) contentType = 'video/x-matroska';
  if (file.name.endsWith('.webm')) contentType = 'video/webm';

  const isUnsupported = (file.name.endsWith('.mkv') || file.name.toLowerCase().includes('x265') || file.name.toLowerCase().includes('hevc')) && req.query.direct !== 'true';
  const isDownload = req.query.download === 'true';

  if (isUnsupported && !isDownload) {
    const timeParam = req.query.time ? parseFloat(req.query.time as string) : 0;

    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Transfer-Encoding': 'chunked'
    });

    if (req.method === 'HEAD') return res.end();

    try {
      const { server: localServer, url: localUrl } = await createLocalVideoServer(file, contentType);

      const cmd = ffmpeg(localUrl)
        .format('mp4')
        .videoCodec('libx264')
        .audioCodec('aac');

      if (timeParam > 0) {
        cmd.seekInput(timeParam);
      }

      cmd.outputOptions([
          '-preset', 'ultrafast',
          '-movflags', 'frag_keyframe+empty_moov',
          '-threads', '1'
        ])
        .on('error', (err) => {
           // Ignore
        })
        .pipe(res, { end: true });
        
      req.on('close', () => {
         try { cmd.kill('SIGKILL'); } catch (e) {}
         try { localServer.close(); } catch (e) {}
      });
    } catch (e: any) {
      res.end();
    }
    
    return;
  }

  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    const chunksize = (end - start) + 1;
    const fileStream = file.createReadStream({ start, end });
    
    fileStream.on('error', (err) => {
      // Ignore stream errors
    });

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
      ...(req.query.download === 'true' && { 'Content-Disposition': `attachment; filename="${encodeURIComponent(file.name)}"` }),
    });
    fileStream.pipe(res);
    req.on('close', () => {
      try { fileStream.destroy(); } catch (e) {}
    });
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      ...(req.query.download === 'true' && { 'Content-Disposition': `attachment; filename="${encodeURIComponent(file.name)}"` }),
    });
    const fileStream = file.createReadStream();
    fileStream.on('error', (err) => {
      // Ignore
    });
    fileStream.pipe(res);
    req.on('close', () => {
      try { fileStream.destroy(); } catch (e) {}
    });
  }
});

app.delete('/api/torrent/:id', (req, res) => {
   const session = sessions.get(req.params.id);
   if (session) {
       if (session.engine) {
           try { session.engine.destroy(() => {}); } catch(e) {}
       }
       sessions.delete(req.params.id);
   }
   res.json({ success: true });
});

// --- VITE MIDDLEWARE / SPA FALLBACK ---
async function setupVite() {
  if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }
}

if (!process.env.VERCEL) {
  setupVite().then(() => {
    const PORT = 3000;
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT}`);
    });
  });
}

export default app;
