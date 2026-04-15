import { API } from './index';

const cache = {};
const pending = {};

export async function fetchTranslation(url, lang) {
  if (!lang || lang === 'zh') return null;
  const key = `${url}?lang=${lang}`;
  if (cache[key]) return cache[key];
  if (pending[key]) return pending[key];
  pending[key] = API.get(`${url}?lang=${lang}`)
    .then((res) => {
      const { success, data } = res.data;
      if (success && data) {
        cache[key] = data;
        return data;
      }
      return null;
    })
    .catch(() => null)
    .finally(() => {
      delete pending[key];
    });
  return pending[key];
}

export function invalidateTranslationCache(key) {
  if (key) {
    delete cache[key];
  } else {
    Object.keys(cache).forEach((k) => delete cache[k]);
  }
}
