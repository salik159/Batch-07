/**
 * NeuraOS Web Research & Webpage Content Extractor
 * 
 * Fetches webpages or receives HTML / raw DOM text,
 * strips advertisements, navigation menus, boilerplate, scripts,
 * and extracts cleanly structured article content and metadata.
 */

/**
 * Clean HTML into readable, informative prose with ads and navigation stripped.
 * @param {string} html 
 * @returns {{ title: string, text: string, headings: string[] }}
 */
export function extractArticleContent(html) {
  if (!html || typeof html !== 'string') return { title: '', text: '', headings: [] };

  let title = '';
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    title = decodeHtmlEntities(titleMatch[1]).replace(/\s*[-|–—]\s*.*$/, '').trim();
  }

  // Strip script, style, svg, iframe, noscript, nav, footer, header, aside, form, advertisements
  let cleaned = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, ' ')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ')
    .replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, ' ')
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ')
    .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, ' ')
    // Remove typical ad containers
    .replace(/<div[^>]+(?:class|id)=["'][^"']*(?:ad-|ads-|advert|banner|cookie|sponsor|popup|modal)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, ' ');

  // Extract headings
  const headings = [];
  const hMatches = cleaned.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi);
  for (const hm of hMatches) {
    const hText = decodeHtmlEntities(stripTags(hm[1])).trim();
    if (hText && hText.length < 120 && !headings.includes(hText)) {
      headings.push(hText);
    }
  }

  // Prefer <article> or <main> if available
  const mainMatch = cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i) || cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  const contentHtml = mainMatch ? mainMatch[1] : cleaned;

  // Convert paragraphs and block breaks
  let text = contentHtml
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<\/li>/gi, '\n');

  text = decodeHtmlEntities(stripTags(text));

  // Clean whitespace and repetitive lines
  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => {
      if (!l) return false;
      if (l.length < 3) return false;
      // Filter out navigation/menu/ad leftovers
      if (/^(accept all|cookie policy|sign in|subscribe|share this|follow us|all rights reserved|privacy policy|terms of use|advertisement)/i.test(l)) return false;
      return true;
    });

  // Deduplicate consecutive lines
  const deduped = [];
  for (const line of lines) {
    if (deduped.length === 0 || deduped[deduped.length - 1] !== line) {
      deduped.push(line);
    }
  }

  const resultText = deduped.join('\n\n').slice(0, 8000);
  return {
    title,
    text: resultText,
    headings: headings.slice(0, 6)
  };
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ');
}

function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8212;/g, '—')
    .replace(/&#8211;/g, '–')
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&lsquo;|&rsquo;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec));
}

/**
 * Fetch and extract text directly from a URL (used when browser CDP is unavailable or as fast path)
 * @param {string} url 
 * @returns {Promise<{ ok: boolean, title: string, text: string, url: string, error?: string }>}
 */
export async function fetchCleanWebpage(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 NeuraOS/2.0'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const html = await res.text();
    const extracted = extractArticleContent(html);
    return { ok: true, url, ...extracted };
  } catch (e) {
    return { ok: false, url, error: e?.message || String(e), title: '', text: '' };
  }
}
