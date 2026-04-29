import { motion } from 'motion/react';
import { Home, Grid, Users, User } from 'lucide-react';
import { TabType } from './types';

interface BottomNavProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
}

export default function BottomNav({ activeTab, setActiveTab }: BottomNavProps) {
  const tabs = [
    { id: 'home', label: '首页', icon: Home },
    { id: 'apps', label: '应用', icon: Grid },
    { id: 'invite', label: '邀请', icon: Users },
    { id: 'profile', label: '我的', icon: User },
  ] as const;

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-surface/80 backdrop-blur-xl border-t border-white/5 pb-8 pt-2 px-6 z-50">
      <div className="max-w-md mx-auto flex justify-between items-center">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              id={`nav-tab-${tab.id}`}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="relative flex flex-col items-center gap-1 min-w-[60px]"
            >
              <div className={`p-1.5 transition-colors ${isActive ? 'text-gold' : 'text-gray-500'}`}>
                <Icon size={24} />
              </div>
              <span className={`text-[10px] font-medium transition-colors ${isActive ? 'text-gold' : 'text-gray-500'}`}>
                {tab.label}
              </span>
              {isActive && (
                <motion.div
                  layoutId="activeTabIndicator"
                  className="absolute -top-1 w-1 h-1 bg-gold rounded-full"
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
