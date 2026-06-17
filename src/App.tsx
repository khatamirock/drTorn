/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { initAuth, googleSignIn, logout as firebaseLogout } from './firebase';
import { GoogleSignInButton } from './GoogleSignInButton';
import { TorrentUploader } from './TorrentUploader';
import { Cloud, Zap, HardDrive } from 'lucide-react';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [needsAuth, setNeedsAuth] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    const unsubscribe = initAuth(
      (currentUser) => {
        setUser(currentUser);
        setNeedsAuth(false);
        setIsInitializing(false);
      },
      () => {
        setUser(null);
        setNeedsAuth(true);
        setIsInitializing(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        setNeedsAuth(false);
      }
    } catch (err) {
      console.error('Login failed:', err);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    await firebaseLogout();
    setUser(null);
    setNeedsAuth(true);
  };

  if (isInitializing) {
    return (
      <div className="h-screen w-full bg-slate-950 flex flex-col items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-800 border-t-blue-500 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (needsAuth) {
    return (
      <div className="h-screen w-full bg-slate-950 flex flex-col items-center justify-center p-4 font-sans relative overflow-hidden">
        {/* Ambient background blur */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-600/10 rounded-full blur-[100px] pointer-events-none"></div>
        <div className="max-w-md w-full bg-slate-900/80 backdrop-blur-xl p-10 rounded-3xl shadow-2xl border border-slate-800 text-center relative z-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-6 shadow-lg shadow-blue-500/20">
            <Cloud className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight mb-2">MagDrive</h1>
          <p className="text-slate-400 mb-10 text-sm leading-relaxed">
            Download torrents directly in your browser and pipe them straight to your Google Drive. No server bottlenecks.
          </p>
          <GoogleSignInButton onClick={handleLogin} isLoading={isLoggingIn} />
          
          <div className="mt-8 flex items-center justify-center text-xs text-slate-500 space-x-1.5 font-medium tracking-wide">
            <Zap className="w-4 h-4 text-emerald-500" />
            <span>Vercel Edge Compatible</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full bg-slate-950 text-slate-200 font-sans flex flex-col overflow-hidden">
      {/* Top Navigation */}
      <nav className="h-16 shrink-0 border-b border-slate-800 flex items-center justify-between px-8 bg-slate-900/50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center">
            <Cloud className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight text-white">MagDrive</span>
          <span className="ml-2 px-2 py-0.5 bg-slate-800 text-slate-400 text-[10px] rounded uppercase font-semibold">Vercel Edition</span>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></div>
            Node.js Runtime Active
          </div>
          <div className="h-8 w-[1px] bg-slate-800"></div>
          <div className="flex items-center gap-3">
            <div className="text-right flex flex-col items-end">
              <p className="text-xs font-medium text-white">{user?.displayName || user?.email || 'User'}</p>
              <button onClick={handleLogout} className="text-[10px] text-slate-500 hover:text-rose-400 transition-colors uppercase mt-0.5">Logout</button>
            </div>
            <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center overflow-hidden">
              {user?.photoURL ? (
                <img src={user.photoURL} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <HardDrive className="w-5 h-5 text-slate-500" />
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content Area */}
      <TorrentUploader />

      {/* Footer Bar */}
      <footer className="h-12 shrink-0 border-t border-slate-800 bg-slate-950 px-8 flex items-center justify-between text-[11px] text-slate-500 font-medium">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
            Server Region: us-east-1
          </span>
          <span>|</span>
          <span>Build: 1.0.4-stable</span>
        </div>
        <div className="flex items-center gap-6">
          <a href="#" className="hover:text-blue-400 transition-colors">API Documentation</a>
          <a href="#" className="hover:text-blue-400 transition-colors">Security Protocols</a>
          <div className="flex items-center gap-1 text-slate-300">
            Powered by <span className="font-bold text-white tracking-widest text-[10px]">VERCEL</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
