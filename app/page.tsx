'use client';

import React from 'react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { VideoMetadata } from '@/types';
import VideoCard from '@/components/VideoCard';
import Header from '@/components/Header';
import { useWallet } from '@/hooks/useWallet';
import { useWallet as useAptosWallet } from '@aptos-labs/wallet-adapter-react';
import { registerShelbyUSD } from '@/lib/aptos';
import { getTrendingVideos, getRecentVideos } from '@/lib/video-service';
import {
  LockClosedIcon,
  CloudIcon,
  BoltIcon,
  ShieldCheckIcon,
  ArrowRightIcon,
  SparklesIcon,
  PlayCircleIcon,
} from '@heroicons/react/24/outline';

export default function Home() {
  const { connected } = useWallet();
  const { signAndSubmitTransaction } = useAptosWallet();

  const refetch = async () => {};
  const [registering, setRegistering] = useState(false);

  const handleRegister = async () => {
    try {
      setRegistering(true);
      await registerShelbyUSD(signAndSubmitTransaction);
      await refetch();
    } catch (error) {
      console.error('Registration failed:', error);
    } finally {
      setRegistering(false);
    }
  };

  const features = [
    {
      icon: LockClosedIcon,
      title: 'TOKEN-GATED ACCESS',
      description: 'Exclusive streaming for Shelby Faucet token holders only.',
    },
    {
      icon: CloudIcon,
      title: 'DECENTRALIZED STORAGE',
      description: 'Powered by Shelby protocol for permanent, censorship-resistant video.',
    },
    {
      icon: BoltIcon,
      title: 'LIT SPEED STREAMING',
      description: 'Experience sub-second video loading with zero buffering.',
    },
    {
      icon: ShieldCheckIcon,
      title: 'APTOS SECURED',
      description: 'Ownership and metadata secured by the Aptos blockchain.',
    },
  ];

  return (
    <div className="min-h-screen bg-brand-dark text-white selection:bg-brand-red selection:text-white overflow-x-hidden">
      <Header />

      <main className="relative">
        {/* Background Gradients */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[500px] pointer-events-none opacity-20 overflow-hidden">
          <div className="absolute -top-[200px] -left-[100px] w-[600px] h-[600px] bg-brand-purple rounded-full blur-[120px]" />
          <div className="absolute -top-[150px] -right-[100px] w-[500px] h-[500px] bg-brand-red rounded-full blur-[100px]" />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-20 relative z-10">
          {/* Hero Section */}
          <div className="text-center mb-16 sm:mb-24">
            <div className="inline-block mb-6 sm:mb-8 animate-in">
              <span className="px-4 py-1.5 bg-zinc-900 border border-zinc-800 text-brand-pink rounded-full
                text-[10px] font-black uppercase tracking-[0.2em]">
                The Future of Streaming is Here
              </span>
            </div>

            <h1 className="text-5xl sm:text-6xl md:text-8xl font-black mb-6 sm:mb-8 tracking-tighter leading-[0.9]">
              SHELBY<span className="text-brand-red">FLIX</span>
            </h1>

            <p className="text-base sm:text-xl text-zinc-400 mb-8 sm:mb-12 max-w-2xl mx-auto font-medium leading-relaxed px-4">
              Experience the next generation of decentralized video. Share, stream, and secure your content with exclusive token-gated access.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center px-4">
              {connected ? (
                <>
                  <Link
                    href="/upload"
                    className="w-full sm:w-auto px-10 py-5 bg-white text-black hover:bg-zinc-200
                      rounded-2xl font-black transition-all shadow-[0_0_30px_rgba(255,255,255,0.2)]
                      flex items-center justify-center gap-2 group"
                  >
                    UPLOAD VIDEO
                    <ArrowRightIcon className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </Link>
                  <Link
                    href="/gallery"
                    className="w-full sm:w-auto px-10 py-5 bg-zinc-900 hover:bg-zinc-800 text-white
                      border border-zinc-800 rounded-2xl font-black transition-all flex items-center justify-center gap-2"
                  >
                    BROWSE GALLERY
                  </Link>
                </>
              ) : (
                <div className="bg-zinc-900/50 backdrop-blur-md border border-zinc-800 rounded-3xl p-8 sm:p-10 max-w-lg w-full">
                  <PlayCircleIcon className="w-14 sm:w-16 h-14 sm:h-16 text-brand-red mx-auto mb-5 sm:mb-6 opacity-80" />
                  <p className="text-xl sm:text-2xl font-black text-white mb-3">
                    READY TO WATCH?
                  </p>
                  <p className="text-zinc-500 font-medium mb-6 sm:mb-8 text-sm sm:text-base">
                    Connect your wallet to access the decentralized gallery and start streaming.
                  </p>
                  <div className="inline-flex items-center gap-2 text-brand-pink font-bold text-sm bg-brand-pink/10 px-4 py-2 rounded-full">
                    <SparklesIcon className="w-4 h-4" />
                    JOIN THE REVOLUTION
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Video Discovery Section */}
          {connected && (
            <div className="mt-16 sm:mt-32">
              <VideoDiscoverySection />
            </div>
          )}

          {/* Features Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-16 sm:mb-32 mt-16 sm:mt-32">
            {features.map((feature, index) => (
              <div
                key={index}
                className="bg-zinc-900/40 backdrop-blur-sm rounded-3xl p-6 sm:p-8
                  hover:bg-zinc-800/40 transition-all border border-zinc-800 group"
              >
                <div className="w-12 sm:w-14 h-12 sm:h-14 bg-zinc-900 rounded-2xl flex items-center
                  justify-center mb-5 sm:mb-6 border border-zinc-800 group-hover:border-brand-pink/50 transition-colors">
                  <feature.icon className="w-6 h-6 text-brand-red group-hover:text-brand-pink transition-colors" />
                </div>
                <h3 className="font-black text-white mb-3 tracking-tighter text-base sm:text-lg">{feature.title}</h3>
                <p className="text-zinc-500 text-sm leading-relaxed font-medium">{feature.description}</p>
              </div>
            ))}
          </div>

          {/* How It Works */}
          <div className="relative rounded-[32px] sm:rounded-[40px] overflow-hidden bg-gradient-to-b from-zinc-900 to-black p-8 sm:p-12 md:p-20 border border-zinc-800">
            <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-brand-purple/10 blur-[100px] -z-10" />

            <h2 className="text-3xl sm:text-4xl md:text-5xl font-black text-white mb-10 sm:mb-16 text-center tracking-tighter">
              THREE STEPS TO <span className="text-brand-red">STREAMING</span>
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-12">
              <div className="relative">
                <div className="text-[80px] sm:text-[120px] font-black text-white/5 absolute -top-14 sm:-top-20 -left-6 sm:-left-10 leading-none select-none">01</div>
                <h3 className="text-xl sm:text-2xl font-black text-white mb-3 sm:mb-4 relative z-10">CONNECT</h3>
                <p className="text-zinc-500 font-medium relative z-10 text-sm sm:text-base">
                  Connect your Aptos wallet to identify yourself on the network.
                </p>
              </div>
              <div className="relative">
                <div className="text-[80px] sm:text-[120px] font-black text-white/5 absolute -top-14 sm:-top-20 -left-6 sm:-left-10 leading-none select-none">02</div>
                <h3 className="text-xl sm:text-2xl font-black text-white mb-3 sm:mb-4 relative z-10">UPLOAD</h3>
                <p className="text-zinc-500 font-medium relative z-10 text-sm sm:text-base">
                  Submit your content to the Shelby decentralized protocol.
                </p>
              </div>
              <div className="relative">
                <div className="text-[80px] sm:text-[120px] font-black text-white/5 absolute -top-14 sm:-top-20 -left-6 sm:-left-10 leading-none select-none">03</div>
                <h3 className="text-xl sm:text-2xl font-black text-white mb-3 sm:mb-4 relative z-10">STREAM</h3>
                <p className="text-zinc-500 font-medium relative z-10 text-sm sm:text-base">
                  Instantly watch content with sub-second load times globally.
                </p>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 sm:gap-8 mt-16 sm:mt-32">
            {[
              { label: 'DECENTRALIZED', value: '100%' },
              { label: 'LATENCY', value: '<1.0s' },
              { label: '', value: 'APTOS' },
              { label: 'PROTOCOL', value: 'SHELBY' },
            ].map((stat, index) => (
              <div key={index} className="text-center group">
                <p className="text-3xl sm:text-4xl md:text-5xl font-black text-white mb-2 group-hover:text-brand-red transition-colors">{stat.value}</p>
                <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </main>

      <footer className="border-t border-zinc-900 bg-black py-16 sm:py-20 mt-16 sm:mt-32 relative z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col items-center">
          <div className="flex items-center gap-3 mb-8 sm:mb-10">
            <h1 className="font-black text-2xl tracking-tighter text-white">
              SHELBY<span className="text-brand-red">FLIX</span>
            </h1>
          </div>

          <div className="flex flex-wrap justify-center gap-6 sm:gap-10 mb-10 sm:mb-12">
            <a href="https://aptoslabs.com" target="_blank" rel="noopener noreferrer"
              className="text-zinc-500 hover:text-white font-bold text-sm transition-colors uppercase tracking-widest">
              Aptos
            </a>
            <a href="https://shelby.xyz" target="_blank" rel="noopener noreferrer"
              className="text-zinc-500 hover:text-white font-bold text-sm transition-colors uppercase tracking-widest">
              Shelby
            </a>
            <a href="https://x.com/shelbyflix" className="text-zinc-500 hover:text-white font-bold text-sm transition-colors uppercase tracking-widest">
              Twitter
            </a>
            <a href="https://discord.com/invite/shelbyflix" className="text-zinc-500 hover:text-white font-bold text-sm transition-colors uppercase tracking-widest">
              Discord
            </a>
          </div>

          <p className="text-zinc-600 text-[10px] font-black uppercase tracking-[0.3em] text-center">
            &copy; 2026 SHELBYFLIX &middot; ALL RIGHTS RESERVED
          </p>
        </div>
      </footer>
    </div>
  );
}

function VideoDiscoverySection() {
  const router = useRouter();

  const [allVideos, setAllVideos] = useState<VideoMetadata[]>([]);
  const [trendingVideos, setTrendingVideos] = useState<VideoMetadata[]>([]);
  const [recentVideos, setRecentVideos] = useState<VideoMetadata[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadVideos();
  }, []);

  const loadVideos = async () => {
    try {
      const trending = await getTrendingVideos(3);
      const recent = await getRecentVideos(3);
      setTrendingVideos(trending);
      setRecentVideos(recent);
      setAllVideos([...trending, ...recent]);
    } catch (error) {
      console.error('Failed to load videos:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 border-4 border-brand-red border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-zinc-500 font-medium">Loading videos...</p>
      </div>
    );
  }

  return (
    <div className="space-y-12 sm:space-y-16">
      {allVideos.length > 0 && (
        <div>
          <h2 className="text-2xl sm:text-3xl font-black mb-5 sm:mb-6 tracking-tighter text-white">
            BROWSE BY <span className="text-brand-red">CATEGORY</span>
          </h2>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 sm:gap-4">
            {['Entertainment', 'Education', 'Gaming', 'Music', 'Sports'].map((cat) => {
              const count = allVideos.filter(v => v.category === cat).length;
              return (
                <button
                  key={cat}
                  onClick={() => router.push(`/category/${cat}`)}
                  className="p-4 sm:p-6 bg-zinc-900/50 border border-zinc-800 rounded-[20px] sm:rounded-[24px] hover:border-brand-red transition-all group"
                >
                  <p className="text-2xl sm:text-3xl mb-2 sm:mb-3">
                    {cat === 'Entertainment' ? '🎬' :
                     cat === 'Education' ? '📚' :
                     cat === 'Gaming' ? '🎮' :
                     cat === 'Music' ? '🎵' : '⚽'}
                  </p>
                  <p className="font-black text-white text-[10px] sm:text-sm mb-1 group-hover:text-brand-red transition-colors">
                    {cat.toUpperCase()}
                  </p>
                  <p className="text-zinc-500 text-[9px] sm:text-xs font-bold">
                    {count} {count === 1 ? 'video' : 'videos'}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {trendingVideos.length > 0 && (
        <div>
          <h2 className="text-2xl sm:text-3xl font-black mb-6 sm:mb-8 tracking-tighter text-white">
            TRENDING <span className="text-brand-red">NOW</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 w-full">
            {trendingVideos.map((video) => (
              <VideoCard key={video.videoId} video={video} hasAccess={true} />
            ))}
          </div>
        </div>
      )}

      {recentVideos.length > 0 && (
        <div>
          <h2 className="text-2xl sm:text-3xl font-black mb-6 sm:mb-8 tracking-tighter text-white">
            RECENT <span className="text-brand-red">UPLOADS</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 w-full">
            {recentVideos.map((video) => (
              <VideoCard key={video.videoId} video={video} hasAccess={true} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}