import { motion } from 'motion/react';
import { Users, Award, TrendingUp, Download, ChevronLeft, Menu, Share2 } from 'lucide-react';

export default function InviteView() {
  return (
    <div className="pb-32 bg-white/2">
      <header className="flex items-center justify-between px-5 pt-12 mb-6">
        <button className="p-2 hover:bg-white/5 rounded-full"><ChevronLeft /></button>
        <h1 className="text-lg font-bold tracking-widest text-white uppercase">Reward Hub</h1>
        <button className="p-2 hover:bg-white/5 rounded-full"><Menu /></button>
      </header>

      <div className="px-5">
        {/* Banner */}
        <section className="relative rounded-3xl overflow-hidden mb-8 shadow-xl">
          <img src="https://images.unsplash.com/photo-1511632765486-a01980e01a18?ixlib=rb-1.2.1&auto=format&fit=crop&w=1200&q=80" className="w-full h-48 object-cover" alt="Invite Friends" referrerPolicy="no-referrer" />
          <div className="absolute inset-0 bg-linear-to-r from-black via-black/40 to-transparent" />
          <div className="absolute inset-y-0 left-6 flex flex-col justify-center max-w-[200px]">
            <h2 className="text-2xl font-bold text-white mb-2 leading-tight">邀请好友赚 Token</h2>
            <p className="text-xs text-gray-300">好友注册、使用、充值，你都可以获得奖励。构建您的算力网络。</p>
          </div>
        </section>

        {/* Reward Milestones */}
        <h3 className="text-xs font-bold tracking-widest text-gray-500 uppercase mb-4">Reward Milestones</h3>
        <div className="grid grid-cols-3 gap-3 mb-8">
          {[
            { label: '注册奖励', value: '+50 TKN', icon: Users },
            { label: '首次使用', value: '+100 TKN', icon: Award },
            { label: '双方互赏', value: '+20 TKN', icon: TrendingUp },
          ].map((m, i) => (
            <div key={i} className="glass-card p-4 flex flex-col items-center text-center">
              <div className="w-10 h-10 bg-gold/10 rounded-xl flex items-center justify-center text-gold mb-3">
                <m.icon size={20} />
              </div>
              <p className="text-[10px] text-gray-400 mb-1">{m.label}</p>
              <p className="text-xs font-bold text-gold">{m.value}</p>
            </div>
          ))}
        </div>

        {/* Recharge Bonus */}
        <h3 className="text-xs font-bold tracking-widest text-gray-500 uppercase mb-4">Recharge Bonus</h3>
        <div className="glass-card p-6 border-accent-glow/20 flex items-center justify-between mb-8">
           <div className="flex items-center gap-4">
              <span className="text-2xl font-display font-bold text-gold">10%</span>
              <span className="text-xl font-bold text-white">终身返佣</span>
           </div>
           <div className="text-right">
              <p className="text-[10px] text-gray-400">实时结算</p>
              <p className="text-[10px] text-gray-200 uppercase font-bold">USDT / TKN</p>
           </div>
        </div>

        {/* Promo Assets */}
        <h3 className="text-xs font-bold tracking-widest text-gray-500 uppercase mb-4">Promo Assets</h3>
        <div className="flex gap-4 overflow-x-auto pb-4 -mx-5 px-5 scrollbar-hide">
          {[
            { title: '算力超市', sub: 'GPU Cluster', img: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=400&q=80' },
            { title: 'AI 图像诊断', sub: 'Vision API', img: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=400&q=80' },
          ].map((a, i) => (
            <div key={i} className="relative min-w-[180px] h-32 rounded-2xl overflow-hidden border border-white/5">
              <img src={a.img} className="absolute inset-0 w-full h-full object-cover" alt={a.title} referrerPolicy="no-referrer" />
              <div className="absolute inset-0 bg-black/40" />
              <div className="absolute inset-x-3 bottom-3 flex items-end justify-between">
                <div>
                   <h4 className="text-xs font-bold text-white">{a.title}</h4>
                   <p className="text-[8px] text-gray-300">{a.sub}</p>
                </div>
                <div className="w-6 h-6 bg-gold rounded-lg flex items-center justify-center text-black">
                   <Download size={12} strokeWidth={3} />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Lists */}
        <div className="mt-8">
           <div className="flex gap-8 border-b border-white/5 mb-4">
              <button className="pb-3 text-sm font-bold text-white border-b-2 border-gold">邀请记录</button>
              <button className="pb-3 text-sm font-bold text-gray-500">奖励明细</button>
           </div>
           <div className="space-y-4">
              {[
                { name: 'Johnariis', date: '2022-03-25 15:38', val: '+50 TKN' },
                { name: 'siovanjete', date: '2022-03-25 16:38', val: '+100 TKN' },
                { name: 'Kingni', date: '2022-03-25 21:07', val: '+350 TKN' },
              ].map((rec, i) => (
                <div key={i} className="flex items-center justify-between">
                   <div className="flex flex-col">
                      <span className="text-xs font-medium text-white">{rec.name}</span>
                      <span className="text-[10px] text-gray-500">{rec.date}</span>
                   </div>
                   <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-gold">{rec.val}</span>
                      <div className="w-1.5 h-1.5 bg-gold rounded-full" />
                   </div>
                </div>
              ))}
           </div>
        </div>
      </div>
    </div>
  );
}
