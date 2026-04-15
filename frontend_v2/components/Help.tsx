import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { API } from '../lib/api';
import { toast } from 'react-hot-toast';
import { useTranslation } from '../lib/i18n';

const isValidUrl = (url: string): boolean => {
  if (!url) return false;
  // Allow relative paths
  if (url.startsWith('/')) return true;
  // Only allow https URLs
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const Help: React.FC = () => {
  const { t } = useTranslation();
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [docsLink, setDocsLink] = useState<string>('');

  useEffect(() => {
    const fetchHelpDoc = async () => {
      setLoading(true);
      setError(null);
      try {
        const [statusRes, aboutRes] = await Promise.all([
          API.get('/api/status'),
          API.get('/api/about'),
        ]);

        if (statusRes.data?.success) {
          setDocsLink(statusRes.data?.data?.docs_link || '');
        }

        if (aboutRes.data?.success && typeof aboutRes.data?.data === 'string' && aboutRes.data.data.trim()) {
          setContent(aboutRes.data.data);
        } else {
          setContent(t('help.fallback'));
        }
      } catch (err: any) {
        console.error('Failed to fetch help content:', err);
        setError(err.response?.data?.message || t('help.error'));
      } finally {
        setLoading(false);
      }
    };

    fetchHelpDoc();
  }, []);

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto">
      {docsLink && (
        <div className="mb-6 p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-dark-surface flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{t('help.docs_title')}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{docsLink}</p>
          </div>
          <button
            onClick={() => {
              if (isValidUrl(docsLink)) {
                window.open(docsLink, '_blank');
              } else {
                toast.error(t('help.invalid_url'));
              }
            }}
            className="px-3 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary-hover transition-colors"
          >
            {t('help.open_docs')}
          </button>
        </div>
      )}

      {error && (
        <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="animate-pulse space-y-6">
           <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-1/3"></div>
           <div className="space-y-3">
              <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-full"></div>
              <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-5/6"></div>
              <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-4/6"></div>
           </div>
        </div>
      ) : (
        <div className="markdown-body">
            <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      )}
    </div>
  );
};

export default Help;
