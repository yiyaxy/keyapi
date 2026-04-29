import { motion } from 'motion/react';
import { Settings, Wallet, Key, FileText, Headset, ChevronRight, User, TrendingDown, Clock, MessageSquare, Zap } from 'lucide-react';

export default function ProfileView() {
  return (
    <div className="pb-32 px-5 pt-12">
      <h1 className="text-center text-lg font-bold text-white mb-8">AI 算力账户中心</h1>

      {/* User Info */}
      <section className="flex items-center gap-4 mb-10">
        <div className="relative">
          <img 
            src="https://images.unsplash.com/photo-1531297484001-80022131f5a1?ixlib=rb-1.2.1&auto=format&fit=crop&w=200&q=80" 
            className="w-20 h-20 rounded-full border-2 border-accent-glow/30 p-1 object-cover" 
            alt="Avatar"
            referrerPolicy="no-referrer"
          />
          <div className="absolute -bottom-1 -right-1 bg-gold px-1.5 py-0.5 rounded-full text-[8px] font-bold text-black uppercase">
            Pro
          </div>
        </div>
        <div>
          <h2 className="text-2xl font-bold text-white mb-0.5">Matrix_Operator</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">ID: 8942A90X</span>
            <span className="text-[10px] border border-white/20 px-2 py-0.5 rounded-full text-gray-400">普通用户</span>
          </div>
        </div>
      </section>

      {/* Assets Card */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card-glow p-6 mb-8"
      >
        <div className="flex items-center gap-2 mb-4">
          <div className="p-1.5 bg-gold/20 rounded-lg text-gold">
            <Wallet size={16} />
          </div>
          <span className="text-xs font-bold text-white">总算力资产</span>
        </div>

        <div className="flex items-end gap-2 mb-6">
          <span className="text-4xl font-display font-bold text-white">2,459,000</span>
          <span className="text-sm font-medium text-gold/60 mb-1">代币</span>
        </div>

        <div className="grid grid-cols-2 gap-4 border-t border-white/10 pt-4 mb-4">
           <div>
              <p className="text-[10px] text-gray-500 mb-1">充值算力</p>
              <p className="text-sm font-bold">1,500,000</p>
           </div>
           <div>
              <p className="text-[10px] text-gray-500 mb-1">赠送算力</p>
              <p className="text-sm font-bold">959,000</p>
           </div>
        </div>
        
        <div className="border-t border-white/10 pt-4">
           <p className="text-[10px] text-gray-500 mb-2 uppercase tracking-widest">累积消耗</p>
           <div className="flex items-center gap-3">
              <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                <motion.div 
                   initial={{ width: 0 }}
                   animate={{ width: '40%' }}
                   className="h-full bg-linear-to-r from-primary-glow to-gold"
                />
              </div>
              <span className="text-[11px] font-mono text-gray-300">342,890 代币</span>
           </div>
        </div>
      </motion.div>

      {/* Quick Actions */}
      <div className="grid grid-cols-4 gap-4 mb-10 px-2">
        {[
          { label: '充值', icon: Wallet },
          { label: 'API 密钥', icon: Key },
          { label: '财务明细', icon: FileText },
          { label: '在线客服', icon: Headset },
        ].map((item, i) => (
          <button key={i} className="flex flex-col items-center gap-2 group">
            <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center group-hover:bg-white/10 transition-colors">
              <item.icon size={20} className="text-white" />
            </div>
            <span className="text-[10px] text-gray-400 font-medium">{item.label}</span>
          </button>
        ))}
      </div>

      {/* Menu List */}
      <div className="space-y-3">
        {[
          { label: '充值记录', icon: Clock },
          { label: 'API 调用日志', icon: Zap },
          { label: '应用消耗记录', icon: TrendingDown },
        ].map((item, i) => (
          <button key={i} className="w-full glass-card p-4 flex items-center justify-between group hover:bg-white/5 transition-colors">
            <div className="flex items-center gap-3">
              <item.icon size={18} className="text-gray-400" />
              <span className="text-sm font-medium">{item.label}</span>
            </div>
            <ChevronRight size={16} className="text-gray-600 group-hover:text-gold transition-colors" />
          </button>
        ))}
      </div>
    </div>
  );
}
