import React, { useState, useEffect, useRef } from 'react';
import { Torrent, TorrentFile } from './types';
import { getAccessToken } from './firebase';
import { DownloadCloud, UploadCloud, CheckCircle, AlertCircle, Play, Link as LinkIcon, ArrowDown, Activity, File, X } from 'lucide-react';

export const TorrentUploader: React.FC = () => {
  const [magnet, setMagnet] = useState('');
  const [torrentInfo, setTorrentInfo] = useState<Torrent | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Stats
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadSpeed, setDownloadSpeed] = useState(0);
  const [peers, setPeers] = useState(0);
  
  const [isDownloading, setIsDownloading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadComplete, setUploadComplete] = useState(false);

  const clientRef = useRef<any>(null);

  useEffect(() => {
    try {
      if (window.WebTorrent && !clientRef.current) {
        clientRef.current = new window.WebTorrent();
        clientRef.current.on('error', (err: any) => {
          console.error('WebTorrent Client error:', err);
          setError(err.message || 'Unknown WebTorrent error');
          setIsDownloading(false);
        });
      }
    } catch (e: any) {
      setError(`Failed to initialize WebTorrent: ${e.message}`);
    }
    return () => {
      if (clientRef.current) {
        try {
          clientRef.current.destroy();
        } catch (e) {
          // ignore
        }
      }
    };
  }, []);

  const handleStart = () => {
    if (!magnet) {
      setError('Please enter a valid magnet link');
      return;
    }
    if (!clientRef.current) {
      setError('WebTorrent client is not loaded yet');
      return;
    }

    setError(null);
    setUploadComplete(false);
    setUploadProgress(0);

    // Add common WebRTC trackers to assist browser download
    let torrentId = magnet;
    if (torrentId.startsWith('magnet:')) {
      const webrtcTrackers = [
        'wss://tracker.btorrent.xyz',
        'wss://tracker.openwebtorrent.com',
        'wss://tracker.fastcast.nz'
      ];
      webrtcTrackers.forEach(tr => {
        if (!torrentId.includes(encodeURIComponent(tr))) {
          torrentId += `&tr=${encodeURIComponent(tr)}`;
        }
      });
    }

    try {
      clientRef.current.add(torrentId, (t: Torrent) => {
        setTorrentInfo(t);
        setIsDownloading(true);

        t.on('error', (err: any) => {
          console.error('Torrent error:', err);
          setError(err.message || 'Unknown torrent error');
          setIsDownloading(false);
        });

        t.on('download', () => {
          setDownloadProgress(t.progress * 100);
          setDownloadSpeed(t.downloadSpeed);
          setPeers(t.numPeers);
        });

        t.on('done', () => {
          setDownloadProgress(100);
          setIsDownloading(false);
          handleUpload(t);
        });
      });
    } catch (e: any) {
      setError(`Failed to start torrent: ${e.message}`);
      setIsDownloading(false);
    }
  };

  const uploadBlobToDrive = async (blob: Blob, name: string) => {
    try {
      setIsUploading(true);
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');

      // 1. Initial request for Resumable Upload
      const metadata = { name };
      const resSession = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Length': blob.size.toString()
        },
        body: JSON.stringify(metadata)
      });

      if (!resSession.ok) {
        throw new Error(`Session request failed: ${resSession.statusText}`);
      }

      const locationUrl = resSession.headers.get('Location');
      if (!locationUrl) {
        throw new Error('No upload location received from Google Drive');
      }

      // 2. Upload the file using XMLHttpRequest to easily track progress
      return new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', locationUrl, true);
        
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setUploadProgress((e.loaded / e.total) * 100);
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            setUploadComplete(true);
            resolve();
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        };

        xhr.onerror = () => reject(new Error('Network error during upload'));

        xhr.send(blob);
      });

    } catch (err: any) {
      console.error(err);
      setError(`Upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleUpload = (t: Torrent) => {
    // For simplicity, we just upload the first/largest file
    let largestFile = t.files[0];
    for (const f of t.files) {
      if (f.length > largestFile.length) {
        largestFile = f;
      }
    }

    if (!largestFile) return;

    largestFile.getBlob(async (err: any, blob: Blob) => {
      if (err) {
        setError(`Failed to extract file: ${err.message}`);
        return;
      }
      await uploadBlobToDrive(blob, largestFile.name);
    });
  };

  const formatBytes = (bytes: number, decimals = 2) => {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  };

  return (
    <main className="flex-1 p-8 flex flex-col gap-8 overflow-y-auto">
      {/* Input Section */}
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl shrink-0">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <LinkIcon className="w-5 h-5 text-blue-500" />
          Start New Transfer
        </h2>
        <div className="flex gap-4">
          <div className="flex-1 relative">
            <input 
              type="text" 
              value={magnet}
              onChange={(e) => setMagnet(e.target.value)}
              placeholder="Paste your magnet link here..." 
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-4 pr-12 text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 placeholder:text-slate-600 transition-all text-sm font-mono"
            />
            <div className="absolute right-4 top-4 text-slate-500">
              <LinkIcon className="w-6 h-6" />
            </div>
          </div>
          <button 
            onClick={handleStart}
            disabled={isDownloading || isUploading}
            className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-8 py-4 rounded-xl transition-colors shadow-lg shadow-blue-900/20 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Deploy to Drive
            <ArrowDown className="w-5 h-5" />
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500 flex items-center gap-1">
          <Activity className="w-3.5 h-3.5" />
          Files will be downloaded in your browser and piped directly to your Google Drive root folder.
        </p>

        {error && (
          <div className="mt-4 p-4 bg-red-950/50 border border-red-900/50 text-red-400 rounded-xl flex items-start space-x-3 text-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <p>{error}</p>
          </div>
        )}
      </section>

      {/* Transfers List */}
      <section className="flex-1 flex flex-col mt-2 min-h-[300px]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Active Pipeline</h2>
          <div className="flex gap-2">
            <span className="px-3 py-1 bg-slate-900 border border-slate-800 rounded-full text-[11px] font-medium text-slate-400">Up: {isUploading ? 'Active' : 'Idle'}</span>
            <span className="px-3 py-1 bg-slate-900 border border-slate-800 rounded-full text-[11px] font-medium text-slate-400">Down: {formatBytes(downloadSpeed)}/s</span>
          </div>
        </div>
        
        <div className="flex-1 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col">
          <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-slate-800 text-[11px] uppercase tracking-wider font-bold text-slate-500 bg-slate-900/80 shrink-0">
            <div className="col-span-5">File / Resource</div>
            <div className="col-span-4">Progress / Status</div>
            <div className="col-span-2">Size</div>
            <div className="col-span-1 text-right">Action</div>
          </div>

          <div className="divide-y divide-slate-800 overflow-y-auto">
            {!torrentInfo && !isDownloading && !isUploading && !uploadComplete && (
               <div className="py-12 text-center text-slate-600 text-sm italic">No active transfers. Add a magnet link to start.</div>
            )}
            
            {torrentInfo && (
              <div className={`grid grid-cols-12 gap-4 px-6 py-4 items-center transition-colors ${uploadComplete ? 'bg-emerald-500/5' : 'hover:bg-slate-800/30'}`}>
                <div className="col-span-5 flex items-center gap-3 pr-2">
                  <div className={`w-10 h-10 rounded flex items-center justify-center shrink-0 ${uploadComplete ? 'bg-emerald-500/10' : isUploading ? 'bg-purple-500/10' : 'bg-indigo-500/10'}`}>
                    <File className={`w-5 h-5 ${uploadComplete ? 'text-emerald-400' : isUploading ? 'text-purple-400' : 'text-indigo-400'}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white leading-none mb-1 truncate" title={torrentInfo.name}>{torrentInfo.name}</p>
                    <p className={`text-[11px] truncate ${uploadComplete ? 'text-emerald-500' : 'text-slate-500'}`}>
                      {uploadComplete ? 'Upload Complete' : isUploading ? 'Uploading to Drive...' : 'Downloading from peers...'}
                    </p>
                  </div>
                </div>

                <div className="col-span-4">
                  {(isDownloading || (!uploadComplete && !isUploading)) && (
                    <>
                      <div className="flex justify-between text-[10px] text-slate-400 mb-1.5">
                        <span>Downloading • {peers} peers</span>
                        <span>{downloadProgress.toFixed(1)}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${downloadProgress}%` }}></div>
                      </div>
                    </>
                  )}

                  {isUploading && !uploadComplete && (
                    <>
                      <div className="flex justify-between text-[10px] text-slate-400 mb-1.5">
                        <span>Syncing to Drive</span>
                        <span>{uploadProgress.toFixed(1)}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden">
                        <div className="h-full bg-purple-500 rounded-full transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div>
                      </div>
                    </>
                  )}

                  {uploadComplete && (
                    <>
                      <div className="flex justify-between text-[10px] text-emerald-500/60 mb-1.5">
                        <span>Verified in Drive</span>
                        <span>100%</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full w-full"></div>
                      </div>
                    </>
                  )}
                </div>

                <div className="col-span-2 text-sm text-slate-300 truncate">
                  {formatBytes(torrentInfo.length)}
                </div>

                <div className="col-span-1 text-right">
                  {uploadComplete ? (
                     <CheckCircle className="w-5 h-5 ml-auto text-emerald-500" />
                  ) : (
                    <button className="text-slate-500 hover:text-rose-400 transition-colors" title="Cancel (not fully implemented)">
                      <X className="w-5 h-5 ml-auto" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
};
