// Define the type for the WebTorrent client globally
declare global {
  interface Window {
    WebTorrent: any;
  }
}

export interface TorrentFile {
  name: string;
  length: number;
  progress: number;
  getBlob: (cb: (err: any, blob: Blob) => void) => void;
  getBlobURL: (cb: (err: any, url: string) => void) => void;
}

export interface Torrent {
  infoHash: string;
  name: string;
  length: number;
  downloadSpeed: number;
  progress: number;
  numPeers: number;
  files: TorrentFile[];
  on: (event: string, callback: (...args: any[]) => void) => void;
  destroy: () => void;
}
