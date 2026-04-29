/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import BottomNav from './components/BottomNav';
import HomeView from './components/HomeView';
import AppsView from './components/AppsView';
import InviteView from './components/InviteView';
import ProfileView from './components/ProfileView';
import { TabType } from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('home');

  const renderView = () => {
    switch (activeTab) {
      case 'home': return <HomeView />;
      case 'apps': return <AppsView />;
      case 'invite': return <InviteView />;
      case 'profile': return <ProfileView />;
      default: return <HomeView />;
    }
  };

  return (
    <div id="app-container" className="max-w-md mx-auto min-h-screen relative bg-surface-dim overflow-x-hidden">
      {/* Background Decorative Elements */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[40%] bg-primary-glow/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[10%] right-[-10%] w-[50%] h-[40%] bg-secondary-glow/10 blur-[120px] rounded-full" />
      </div>

      <AnimatePresence mode="wait">
        <motion.main
          key={activeTab}
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          {renderView()}
        </motion.main>
      </AnimatePresence>

      <BottomNav activeTab={activeTab} setActiveTab={setActiveTab} />
    </div>
  );
}

