import React, { useState, useEffect, useRef } from 'react';
import { getAccessToken } from './firebase';
import { DownloadCloud, UploadCloud, CheckCircle, AlertCircle, Play, Link as LinkIcon, ArrowDown, Activity, File, X } from 'lucide-react';

export const TorrentUploader: React.FC<{ isGuest?: boolean }> = ({ isGuest }) => {
  const [magnet, setMagnet] = useState('');
  
  // Stats
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionData, setSessionData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let interval: any;
    if (sessionId) {
      interval = setInterval(async () => {
        try {
          const res = await fetch(`/api/torrent/status/${sessionId}`);
          if (!res.ok) {
            // Check if backend crashed and proxy is returning HTML
            const contentType = res.headers.get('content-type');
            if (contentType && contentType.includes('text/html')) {
              throw new Error('Server connection lost. Please try again.');
            }
            throw new Error('Status fetch failed');
          }
          
          const text = await res.text();
          let data;
          try {
            data = JSON.parse(text);
          } catch (e) {
            throw new Error('Received invalid data from server.');
          }
          
          setSessionData(data);
          
          if (data.status === 'completed' || data.status === 'error') {
            if (data.error) setError(data.error);
            clearInterval(interval);
          }
        } catch (err) {
          console.error(err);
        }
      }, 1500);
    }
    return () => clearInterval(interval);
  }, [sessionId]);

  const handleStart = async (action: 'save' | 'stream') => {
    if (!magnet) {
      setError('Please enter a valid magnet link');
      return;
    }

    try {
      let token = null;
      if (action === 'save') {
        token = await getAccessToken();
        if (!token) throw new Error('Not authenticated with Google');
      }

      setError(null);
      setSessionId(null);
      setSessionData(null);

      const res = await fetch('/api/torrent/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ magnet, accessToken: token, action })
      });
      
      let data;
      const textResponse = await res.text();
      try {
        data = JSON.parse(textResponse);
      } catch (e) {
        throw new Error(`Server configuration error: ${textResponse.substring(0, 50)}... Make sure you are not using Vercel without proper API adjustments.`);
      }

      if (!res.ok) throw new Error(data?.error || 'Failed to start');
      
      setSessionId(data.sessionId);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCancel = async () => {
     if (sessionId) {
       await fetch(`/api/torrent/${sessionId}`, { method: 'DELETE' });
       setSessionId(null);
       setSessionData(null);
     }
  };

  const formatBytes = (bytes: number, decimals = 2) => {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  };

  const isConnecting = sessionData?.status === 'connecting';
  const isDownloading = sessionData?.status === 'downloading';
  const isUploading = sessionData?.status === 'uploading';
  const isReadyToStream = sessionData?.status === 'ready_to_stream';
  const isComplete = sessionData?.status === 'completed';

  const isBusy = isConnecting || isDownloading || isUploading || isReadyToStream;

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
            onClick={() => handleStart('save')}
            disabled={isBusy || isGuest}
            title={isGuest ? "Sign in to save to Google Drive" : "Save to Google Drive"}
            className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-6 py-4 rounded-xl transition-colors shadow-lg shadow-blue-900/20 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save to Drive
            <ArrowDown className="w-4 h-4" />
          </button>
          <button 
            onClick={() => handleStart('stream')}
            disabled={isBusy}
            title="Stream video directly in the browser"
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-6 py-4 rounded-xl transition-colors shadow-lg shadow-emerald-900/20 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Play Video
            <Play className="w-4 h-4" />
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-500 flex items-center gap-1">
          <Activity className="w-3.5 h-3.5" />
          {isGuest 
            ? "You are using Guest Mode. You can stream videos directly in the browser. Sign in to save files to Google Drive." 
            : "You can save the file directly to your Google Drive, or stream it directly in the browser."}
        </p>

        {error && (
          <div className="mt-4 p-4 bg-red-950/50 border border-red-900/50 text-red-400 rounded-xl flex items-start space-x-3 text-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <p>{error}</p>
          </div>
        )}
      </section>

      {/* Video Player Section */}
      {isReadyToStream && sessionId && sessionData && (
        <section className="bg-black border border-slate-800 rounded-2xl overflow-hidden shadow-2xl shrink-0 flex flex-col self-center max-w-4xl w-full">
           <video 
             src={`/api/torrent/stream/${sessionId}`} 
             controls 
             autoPlay 
             playsInline
             type="video/mp4"
             className="w-full aspect-video bg-slate-900"
           >
             Your browser does not support the video tag.
           </video>
           <div className="p-4 bg-slate-900 text-sm text-slate-400 flex flex-col sm:flex-row justify-between items-center gap-4 border-t border-slate-800">
             <div className="flex flex-col">
                <span>Streaming Status: Buffering from {sessionData.peers} peers</span>
                {sessionData.fileName && (sessionData.fileName.includes('.mkv') || sessionData.fileName.toLowerCase().includes('x265') || sessionData.fileName.toLowerCase().includes('hevc')) ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-amber-500 mt-1 font-medium bg-amber-500/10 px-2 py-1 rounded inline-block w-max">
                      ⚠️ Live Server Transcoding Active
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Seeking is now enabled (may take a few seconds to buffer). For best performance, use "Play in VLC" or "Download File". (Vercel max timeout may apply)
                    </span>
                  </div>
                ) : (
                  <span className="text-xs text-slate-500 mt-1">If the video isn't playing, it might be buffering metadata.</span>
                )}
             </div>
             <div className="flex items-center gap-2">
               <span className="font-mono bg-slate-950 px-2 py-1 rounded text-emerald-400">{sessionData.speed ? formatBytes(sessionData.speed) : '0 Bytes'}/s</span>
               <a 
                 href={`vlc://${window.location.origin}/api/torrent/stream/${sessionId}`}
                 className="bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors shrink-0"
                 title="Requires VLC Media Player installed"
               >
                 <Play className="w-4 h-4" />
                 Play in VLC
               </a>
               <a 
                 href={`/api/torrent/stream/${sessionId}?download=true`} 
                 download={sessionData.fileName}
                 className="bg-slate-800 hover:bg-slate-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors shrink-0"
               >
                 <DownloadCloud className="w-4 h-4" />
                 Download File
               </a>
             </div>
           </div>
        </section>
      )}

      {/* Transfers List */}
      <section className="flex-1 flex flex-col mt-2 min-h-[150px]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Active Pipeline</h2>
          <div className="flex gap-2">
            <span className="px-3 py-1 bg-slate-900 border border-slate-800 rounded-full text-[11px] font-medium text-slate-400">Up: {isUploading ? 'Active' : 'Idle'}</span>
            <span className="px-3 py-1 bg-slate-900 border border-slate-800 rounded-full text-[11px] font-medium text-slate-400">Down: {sessionData ? formatBytes(sessionData.speed) : '0 Bytes'}/s</span>
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
            {!sessionData && !isBusy && !isComplete && (
               <div className="py-12 text-center text-slate-600 text-sm italic">No active transfers. Add a magnet link to start.</div>
            )}
            
            {sessionData && (
              <div className={`grid grid-cols-12 gap-4 px-6 py-4 items-center transition-colors ${isComplete ? 'bg-emerald-500/5' : 'hover:bg-slate-800/30'}`}>
                <div className="col-span-5 flex items-center gap-3 pr-2">
                  <div className={`w-10 h-10 rounded flex items-center justify-center shrink-0 ${isComplete ? 'bg-emerald-500/10' : (isUploading || isReadyToStream) ? 'bg-purple-500/10' : 'bg-indigo-500/10'}`}>
                    <File className={`w-5 h-5 ${isComplete ? 'text-emerald-400' : (isUploading || isReadyToStream) ? 'text-purple-400' : 'text-indigo-400'}`} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white leading-none mb-1 truncate" title={sessionData.fileName || magnet}>{sessionData.fileName || 'Resolving metadata...'}</p>
                    <p className={`text-[11px] truncate ${isComplete ? 'text-emerald-500' : 'text-slate-500'}`}>
                      {isComplete ? 'Transfer Complete' : isUploading ? 'Uploading to Drive...' : isReadyToStream ? 'Streaming Active' : 'Connecting...'}
                    </p>
                  </div>
                </div>

                <div className="col-span-4">
                  {isConnecting && (
                    <>
                      <div className="flex justify-between text-[10px] text-slate-400 mb-1.5">
                        <span>Connecting to trackers...</span>
                        <span>0%</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden">
                        <div className="h-full bg-slate-800 rounded-full w-[0%]"></div>
                      </div>
                    </>
                  )}

                  {isDownloading && (
                    <>
                      <div className="flex justify-between text-[10px] text-slate-400 mb-1.5">
                        <span>Downloading • {sessionData.peers} peers</span>
                        <span>{sessionData.progress.toFixed(1)}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${sessionData.progress}%` }}></div>
                      </div>
                    </>
                  )}

                  {isUploading && (
                    <>
                      <div className="flex justify-between text-[10px] text-slate-400 mb-1.5">
                        <span className="flex items-center gap-1">
                          <Activity className="w-3 h-3 text-purple-400 animate-pulse" />
                          Streaming to Drive • {sessionData.peers} peers
                        </span>
                        <span>{sessionData.progress.toFixed(1)}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden">
                        <div className="h-full bg-purple-500 rounded-full transition-all duration-300" style={{ width: `${sessionData.progress}%` }}></div>
                      </div>
                    </>
                  )}

                  {isReadyToStream && (
                     <div className="flex justify-center text-[11px] text-emerald-400 items-center font-medium gap-1.5">
                        <Activity className="w-3.5 h-3.5 animate-pulse" />
                        Live Stream Running
                     </div>
                  )}

                  {isComplete && (
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
                  {sessionData.fileSize ? formatBytes(sessionData.fileSize) : '---'}
                </div>

                <div className="col-span-1 text-right">
                  {isComplete ? (
                     <CheckCircle className="w-5 h-5 ml-auto text-emerald-500" />
                  ) : (
                    <button onClick={handleCancel} className="text-slate-500 hover:text-rose-400 transition-colors" title="Cancel/Stop">
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
