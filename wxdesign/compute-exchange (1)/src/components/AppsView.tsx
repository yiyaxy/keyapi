import { motion } from 'motion/react';
import { ChevronRight, Sparkles, History, Search } from 'lucide-react';
import { AI_APPS } from '../types';

export default function AppsView() {
  return (
    <div className="pb-32 px-5 pt-12">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">AI 应用中心</h1>
          <p className="text-xs text-gray-500 mt-1">使用 Token，直接体验热门 AI 能力</p>
        </div>
        <div className="glass-card px-3 py-1.5 flex items-center gap-2">
          <div className="w-5 h-5 bg-gold/20 rounded-full flex items-center justify-center text-gold">
            <Sparkles size={12} />
          </div>
          <div className="text-right">
            <p className="text-[8px] text-gray-500 leading-none">1,250</p>
            <p className="text-[8px] text-gray-400 font-bold leading-none">Tokens</p>
          </div>
        </div>
      </header>

      {/* Featured Big Card */}
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative rounded-3xl overflow-hidden mb-8 shadow-2xl border border-white/5"
      >
        <img 
          src="https://images.unsplash.com/photo-1543132220-3ce99c5ae03d?ixlib=rb-1.2.1&auto=format&fit=crop&w=1200&q=80" 
          className="w-full aspect-[4/5] object-cover" 
          alt="AI Image Diagnose"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-linear-to-t from-black via-black/20 to-transparent" />
        
        <div className="absolute inset-x-6 bottom-6">
          <div className="glass-card p-6 bg-black/40 backdrop-blur-2xl border-white/10">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl font-bold text-white">AI 形象诊断</h2>
              <span className="text-[10px] bg-white/10 px-2 py-1 rounded-full text-gold">⚡️ 50</span>
            </div>
            <p className="text-xs text-gray-300 leading-relaxed mb-4">
              上传照片，获取多维度面部结构与风格深度解析报告。
            </p>
            <div className="flex gap-2 mb-6">
              <span className="text-[10px] text-gray-400 bg-white/5 px-2 py-1 rounded">面部比例</span>
              <span className="text-[10px] text-gray-400 bg-white/5 px-2 py-1 rounded">风格建议</span>
              <span className="text-[10px] text-gray-400 bg-white/5 px-2 py-1 rounded">高清输出</span>
            </div>
            <button className="w-full btn-primary py-2.5 text-sm">立即体验</button>
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-2 gap-4">
        {/* Secondary Cards */}
        <div className="flex flex-col gap-4">
          <div className="glass-card p-4 aspect-square flex flex-col justify-between border-accent-glow/10">
             <div className="flex items-center gap-2 mb-2">
                <Search size={16} className="text-accent-glow" />
                <h3 className="text-sm font-bold">最近使用</h3>
             </div>
             <div className="space-y-3">
               {[1,2,3].map(i => (
                 <div key={i} className="flex items-center gap-2 bg-white/5 p-2 rounded-lg">
                    <div className="w-6 h-6 rounded-full bg-gold/10 flex items-center justify-center">
                      <Sparkles size={10} className="text-gold" />
                    </div>
                    <span className="text-[10px] text-gray-300">AI 形象诊断</span>
                 </div>
               ))}
             </div>
          </div>
          
          <div className="glass-card p-4 text-center border-white/5">
             <div className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-3">
                <History size={20} className="text-gray-400" />
             </div>
             <h4 className="text-xs font-bold mb-1">我的生成记录</h4>
             <p className="text-[9px] text-gray-500 mb-3">查看所有历史分析报告与生成的资产</p>
             <ArrowRight size={14} className="mx-auto text-gray-600" />
          </div>
        </div>

        <div className="flex flex-col gap-4">
           {/* Column 2 small app cards */}
           <div className="rounded-3xl overflow-hidden relative group">
              <img src="https://images.unsplash.com/photo-1544005313-94ddf0286df2?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80" className="w-full aspect-[2/3] object-cover" alt="Palm" referrerPolicy="no-referrer" />
              <div className="absolute inset-0 bg-linear-to-t from-black via-black/10 to-transparent" />
              <div className="absolute inset-x-3 bottom-3">
                 <div className="glass-card p-3 bg-black/60 backdrop-blur-lg">
                    <div className="flex justify-between items-center mb-1">
                      <h4 className="text-[11px] font-bold">AI 手相分享</h4>
                      <span className="text-[8px] px-1.5 py-0.5 bg-gold/20 rounded text-gold">分享免 Token</span>
                    </div>
                    <p className="text-[9px] text-gray-400 mb-3 line-clamp-2">扫描掌纹，解读运势密码，分享可获取额外 Tokens</p>
                    <button className="w-full bg-black border border-white/20 text-[10px] py-1 rounded-full">去测试</button>
                 </div>
              </div>
           </div>

           <div className="rounded-3xl overflow-hidden relative group">
              <img src="https://images.unsplash.com/photo-1512428559083-a40ce75b89a0?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80" className="w-full aspect-square object-cover" alt="XHS" referrerPolicy="no-referrer" />
              <div className="absolute inset-0 bg-linear-to-t from-black via-black/20 to-transparent" />
              <div className="absolute inset-x-3 bottom-3">
                 <div className="glass-card p-3 bg-black/60 backdrop-blur-lg">
                    <h4 className="text-[11px] font-bold mb-1">小红书文案诊断</h4>
                    <p className="text-[9px] text-gray-400 mb-2 line-clamp-1">爆款逻辑拆解，文案优化建议</p>
                    <button className="w-full bg-black border border-white/20 text-[10px] py-1 rounded-full">开始诊断</button>
                 </div>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
}

function ArrowRight(props: any) {
  return (
    <svg 
      {...props}
      xmlns="http://www.w3.org/2000/svg" 
      width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" 
    >
      <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
    </svg>
  );
}
