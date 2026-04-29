import { motion } from 'motion/react';
import { Zap, Key, ArrowRight, ChevronRight, Sparkles } from 'lucide-react';
import { AI_APPS } from '../types';

export default function HomeView() {
  return (
    <div className="pb-32 px-5 pt-8">
      {/* Header Section */}
      <section className="text-center mb-10">
        <h1 className="font-display text-4xl font-bold tracking-tight mb-2 text-white">
          全球大模型算力超市
        </h1>
        <p className="text-gray-400 text-sm max-w-[280px] mx-auto leading-relaxed">
          一份 Token，调用 GPT / Claude / Gemini / DeepSeek / Qwen / Kimi
        </p>
        
        <div className="flex flex-wrap justify-center gap-2 mt-6">
          <span className="chip">统一结算</span>
          <span className="chip">按量消耗</span>
          <span className="chip">API 接入</span>
          <span className="chip">应用直用</span>
        </div>
      </section>

      {/* Main Actions */}
      <div className="flex gap-4 mb-8">
        <button id="btn-recharge" className="flex-1 btn-primary text-sm">
          立即充值
        </button>
        <button id="btn-create-api" className="flex-1 btn-ghost text-sm flex items-center justify-center gap-2">
          创建 API Key
        </button>
      </div>

      {/* Balance Card */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-6 mb-10 relative overflow-hidden group"
      >
        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
          <Sparkles size={64} className="text-gold" />
        </div>
        
        <header className="flex items-center gap-2 mb-6">
          <div className="p-1.5 bg-gold/20 rounded-lg text-gold">
            <Zap size={18} fill="currentColor" />
          </div>
          <h2 className="text-lg font-bold text-white">我的算力余额</h2>
        </header>

        <div className="grid grid-cols-2 gap-y-6 gap-x-4">
          <div>
            <p className="text-xs text-gray-400 mb-1">可用 Token</p>
            <p className="font-display text-xl text-gold">4,285,100</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">充值 Token</p>
            <p className="font-display text-xl text-white">4,000,000</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">赠送 Token</p>
            <p className="font-display text-xl text-gold/80">285,100</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1">今日消耗</p>
            <p className="font-display text-xl text-white">12,450</p>
          </div>
        </div>

        <button className="w-full mt-6 flex items-center justify-end gap-1 text-gold text-xs font-medium">
          查看明细 <ChevronRight size={14} />
        </button>
      </motion.div>

      {/* App Recommendations */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-gold rounded-full block" />
            AI 应用推荐
          </h3>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {AI_APPS.map((app) => (
            <motion.div
              key={app.id}
              whileHover={{ scale: 1.02 }}
              className="relative aspect-square rounded-2xl overflow-hidden group border border-white/5"
            >
              <img 
                src={app.image} 
                className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" 
                alt={app.title}
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-linear-to-t from-black/90 via-black/30 to-transparent" />
              
              <div className="absolute inset-x-0 bottom-0 p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <div className="p-1 bg-gold/20 rounded-md text-gold">
                    <app.icon size={12} />
                  </div>
                  <h4 className="text-sm font-bold text-white">{app.title}</h4>
                </div>
                <p className="text-[10px] text-gray-400 line-clamp-1 mb-2">
                  {app.description}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-gray-500">Token 消耗</span>
                  <span className="text-xs font-medium text-gold">{app.tokenCost}</span>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </section>
    </div>
  );
}
