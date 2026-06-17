import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import WebTorrent from 'webtorrent';
import { google } from 'googleapis';
import crypto from 'crypto';

// In-memory store for torrent sessions
const sessions = new Map<string, any>();
const torrentClient = new WebTorrent();

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // --- API ROUTES ---

  app.post('/api/torrent/start', async (req, res) => {
    try {
      const { magnet, accessToken } = req.body;
      
      if (!magnet || !accessToken) {
        return res.status(400).json({ error: 'Magnet link and access token are required' });
      }

      const sessionId = crypto.randomUUID();
      
      sessions.set(sessionId, {
        id: sessionId,
        status: 'connecting',
        progress: 0,
        speed: 0,
        peers: 0,
        fileName: '',
        fileSize: 0,
        error: null,
      });

      // Add common trackers to assist torrent download
      let torrentId = magnet;
      if (torrentId.startsWith('magnet:')) {
        const extraTrackers = [
          'udp://tracker.opentrackr.org:1337/announce',
          'udp://open.demonii.com:1337/announce',
          'udp://tracker.openbittorrent.com:80',
          'udp://tracker.ccp.ovh:6969/announce',
          'udp://exodus.desync.com:6969',
          'wss://tracker.btorrent.xyz',
          'wss://tracker.openwebtorrent.com',
          'wss://tracker.fastcast.nz'
        ];
        extraTrackers.forEach(tr => {
          if (!torrentId.includes(encodeURIComponent(tr)) && !torrentId.includes(tr)) {
            torrentId += `&tr=${encodeURIComponent(tr)}`;
          }
        });
      }

      // Start the torrent
      torrentClient.add(torrentId, { path: '/tmp/webtorrent' }, (torrent) => {
        // Find largest file
        let file = torrent.files[0];
        for (const f of torrent.files) {
          if (f.length > file.length) file = f;
        }

        const session = sessions.get(sessionId);
        if (session) {
          session.fileName = file.name;
          session.fileSize = file.length;
          session.status = 'downloading';
        }

        torrent.on('error', (err: any) => {
          console.error('Torrent Error:', err);
          const s = sessions.get(sessionId);
          if (s) {
            s.status = 'error';
            s.error = err.message || 'Torrent error';
          }
        });

        torrent.on('download', () => {
          const s = sessions.get(sessionId);
          if (s && s.status === 'downloading') {
            s.progress = torrent.progress * 100;
            s.speed = torrent.downloadSpeed;
            s.peers = torrent.numPeers;
          }
        });

        torrent.on('done', async () => {
          const s = sessions.get(sessionId);
          if (s) {
            s.progress = 100;
            s.status = 'uploading';
          }

          try {
            // Setup Google Drive API
            const auth = new google.auth.OAuth2();
            auth.setCredentials({ access_token: accessToken });
            const drive = google.drive({ version: 'v3', auth });

            // Stream the file directly to Google Drive
            await drive.files.create({
              requestBody: {
                name: file.name,
              },
              media: {
                body: file.createReadStream(),
              },
            });

            if (sessions.has(sessionId)) {
              sessions.get(sessionId).status = 'completed';
            }
          } catch (err: any) {
            console.error('Upload Error:', err);
            if (sessions.has(sessionId)) {
              sessions.get(sessionId).status = 'error';
              sessions.get(sessionId).error = err.message || 'Upload failed';
            }
          } finally {
            // Destroy this torrent from the torrent client to free memory/disk
            torrent.destroy();
          }
        });
      });

      torrentClient.on('error', (err) => {
        console.error('Torrent Client Error:', err);
      });

      res.json({ sessionId });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/torrent/status/:id', (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(session);
  });

  // --- VITE MIDDLEWARE / SPA FALLBACK ---
  if (process.env.NODE_ENV !== 'production') {
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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
