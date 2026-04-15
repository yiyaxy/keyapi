import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import ApiKeys from './components/ApiKeys';
import Logs from './components/Logs';
import Settings from './components/Settings';
import Plans from './components/Plans';
import ModelSquare from './components/ModelSquare';
import Help from './components/Help';
import Notifications from './components/Notifications';
import Analytics from './components/Analytics';
import Login from './components/Login';
import Register from './components/Register';
import PublicHome from './components/PublicHome';
import PublicPricing from './components/PublicPricing';
import PolicyPage from './components/PolicyPage';
import FeatureBridge from './components/FeatureBridge';
import Footer from './components/Footer';
import { LanguageProvider } from './lib/i18n';
import { AuthProvider, useAuth } from './lib/auth';

const STORAGE_KEYS = {
  theme: 'frontend_v2_theme',
} as const;

const getStoredTheme = (): 'dark' | 'light' => {
  const saved = localStorage.getItem(STORAGE_KEYS.theme);
  return saved === 'dark' ? 'dark' : 'light';
};

const normalizeAndGetRoute = (): string => {
  const hash = window.location.hash;
  if (hash.startsWith('#/')) {
    const legacyPath = hash.slice(1);
    window.history.replaceState({}, '', legacyPath);
    return legacyPath;
  }

  return window.location.pathname || '/';
};

const navigate = (path: string) => {
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }
  if (window.location.pathname === path) {
    return;
  }
  window.history.pushState({}, '', path);
  window.dispatchEvent(new Event('routechange'));
};

interface LayoutProps {
  children: React.ReactNode;
  currentPath: string;
  onNavigate: (path: string) => void;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  showFooter?: boolean;
}

const AuthenticatedLayout: React.FC<LayoutProps> = ({
  children,
  currentPath,
  onNavigate,
  theme,
  toggleTheme,
  showFooter = true,
}) => {
  const { logout, user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Close mobile menu on navigation
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [currentPath]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-gray-50 dark:bg-dark-bg transition-colors duration-200">
      {/* Mobile Sidebar Overlay */}
      {mobileMenuOpen && (
        <div 
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
            onClick={() => setMobileMenuOpen(false)}
        ></div>
      )}
      
      {/* Sidebar Container */}
      <div className={`fixed inset-y-0 left-0 z-50 transform lg:relative lg:translate-x-0 transition-transform duration-300 ease-in-out ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <Sidebar
            currentPath={currentPath}
            onNavigate={(path) => {
                if (path === '/logout') {
                    logout();
                    navigate('/');
                } else {
                    onNavigate(path);
                }
            }}
            theme={theme}
            toggleTheme={toggleTheme}
        />
      </div>

      <main className="flex-1 flex flex-col h-full w-full overflow-hidden relative">
        {/* Mobile Header */}
        <div className="lg:hidden flex items-center justify-between p-4 border-b border-slate-200 dark:border-dark-border bg-white dark:bg-dark-surface">
            <div className="flex items-center gap-3">
                 <button onClick={() => setMobileMenuOpen(true)} className="text-slate-500">
                    <span className="material-symbols-outlined">menu</span>
                 </button>
                 <span className="font-bold text-slate-900 dark:text-white">CaMeL AI</span>
            </div>
            <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden border border-slate-200 dark:border-slate-600">
                <img src={user?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.display_name || user?.username || 'User')}&background=0D8ABC&color=fff`} alt="User" className="w-full h-full object-cover" />
            </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto scroll-smooth">
            {children}
            {showFooter && <Footer />}
        </div>
      </main>
    </div>
  );
};

const AppContent: React.FC = () => {
  const [route, setRoute] = useState<string>(normalizeAndGetRoute);
  const [theme, setTheme] = useState<'dark' | 'light'>(getStoredTheme);
  const { isAuthenticated } = useAuth();

  // Listen for browser history changes and in-app route changes.
  useEffect(() => {
    const onRouteChange = () => setRoute(normalizeAndGetRoute());
    window.addEventListener('popstate', onRouteChange);
    window.addEventListener('routechange', onRouteChange);
    return () => {
      window.removeEventListener('popstate', onRouteChange);
      window.removeEventListener('routechange', onRouteChange);
    };
  }, []);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem(STORAGE_KEYS.theme, theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  const handleNavigate = (path: string) => {
    navigate(path);
  };

  // If not authenticated, show public product pages first.
  if (!isAuthenticated) {
      const publicNav = {
        onLogin: () => navigate('/login'),
        onRegister: () => navigate('/register'),
        onHome: () => navigate('/'),
        onPricing: () => navigate('/pricing'),
        onPrivacy: () => navigate('/privacy'),
        onTerms: () => navigate('/terms'),
        onRefund: () => navigate('/refund'),
      };

      switch (route) {
        case '/pricing':
          return <PublicPricing theme={theme} toggleTheme={toggleTheme} onBack={publicNav.onHome} {...publicNav} />;
        case '/privacy':
          return <PolicyPage type="privacy" theme={theme} toggleTheme={toggleTheme} onBack={publicNav.onHome} {...publicNav} />;
        case '/terms':
          return <PolicyPage type="terms" theme={theme} toggleTheme={toggleTheme} onBack={publicNav.onHome} {...publicNav} />;
        case '/refund':
          return <PolicyPage type="refund" theme={theme} toggleTheme={toggleTheme} onBack={publicNav.onHome} {...publicNav} />;
        case '/register':
          return <Register onNavigateLogin={publicNav.onLogin} onNavigateHome={publicNav.onHome} />;
        case '/login':
          return (
            <Login
              onLogin={() => navigate('/dashboard')}
              onNavigateRegister={publicNav.onRegister}
              onNavigateHome={publicNav.onHome}
            />
          );
        default:
          return <PublicHome theme={theme} toggleTheme={toggleTheme} {...publicNav} />;
      }
  }

  // Authenticated Routes
  let content;
  switch (route) {
    case '/':
    case '/dashboard':
      content = <Dashboard />;
      break;
    case '/models':
      content = <ModelSquare />;
      break;
    case '/notifications':
      content = <Notifications />;
      break;
    case '/keys':
      content = <ApiKeys />;
      break;
    case '/logs':
      content = <Logs />;
      break;
    case '/analytics':
      content = <Analytics />;
      break;
    case '/plans':
      content = <Plans />;
      break;
    case '/settings':
      content = <Settings />;
      break;
    case '/help':
      content = <Help />;
      break;
    case '/all-features':
      content = <FeatureBridge />;
      break;
    case '/privacy':
    case '/terms':
    case '/refund':
    case '/pricing': {
      const nav = {
        onBack: () => navigate('/dashboard'),
        onLogin: () => navigate('/login'),
        onRegister: () => navigate('/register'),
        onPricing: () => navigate('/pricing'),
        onPrivacy: () => navigate('/privacy'),
        onTerms: () => navigate('/terms'),
        onRefund: () => navigate('/refund'),
      };
      if (route === '/pricing') {
        content = <PublicPricing theme={theme} toggleTheme={toggleTheme} {...nav} />;
      } else {
        const typeMap: Record<string, 'privacy' | 'terms' | 'refund'> = {
          '/privacy': 'privacy', '/terms': 'terms', '/refund': 'refund',
        };
        content = <PolicyPage type={typeMap[route] || 'privacy'} theme={theme} toggleTheme={toggleTheme} {...nav} />;
      }
      break;
    }
    default:
      content = <Dashboard />;
  }

  return (
    <AuthenticatedLayout
        currentPath={route}
        onNavigate={handleNavigate}
        theme={theme}
        toggleTheme={toggleTheme}
        showFooter={!['/privacy', '/terms', '/refund', '/pricing'].includes(route)}
    >
      {content}
    </AuthenticatedLayout>
  );
};

const App: React.FC = () => {
  return (
    <LanguageProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </LanguageProvider>
  );
};

export default App;
