import type { Route } from '@/types';
import { withPage } from './_engine.mjs';

export const route: Route = {
    path: '/kickstarter/search/:keyword',
    name: 'Kickstarter 项目搜索 (via chrome2 CDP)',
    maintainers: ['huajun'],
    example: '/cdp/kickstarter/search/smart%20ring',
    categories: ['crowdfunding'],
    parameters: {
        keyword: '搜索关键词（空格用 %20）',
        sort: 'magic | popularity | newest | end_date | most_funded | most_backed (default magic)',
        limit: 'Maximum number of projects (default 10, max 30)',
    },
    description:
        'Drives the already-logged-in chrome2 browser over CDP to search Kickstarter projects. ' +
        'Waits for React hydration, dismisses cookie modals, extracts project cards from DOM. ' +
        'Reuses the browser session cookies (anti-bot passes). No API key needed.',
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: true,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    handler: async (ctx) => {
        const keyword = ctx.req.param('keyword') || '';
        const sort = ctx.req.query('sort') || 'magic';
        const limit = Math.min(parseInt(ctx.req.query('limit') || '10', 10) || 10, 30);
        const url = `https://www.kickstarter.com/discover/advanced?term=${encodeURIComponent(keyword)}&sort=${sort}`;
        // 用 eval 构造浏览器端函数：esbuild keepNames 会给 const 箭头函数注入 __name 包装，
        // toString 后进浏览器上下文会 ReferenceError。eval 出来的函数 toString 是干净源码。
        const kickstarterFetch = eval(FN_SOURCE);
        const projects = await withPage(url, kickstarterFetch, { limit });
        return {
            title: `Kickstarter: ${keyword} (${sort})`,
            link: url,
            description: `Kickstarter projects matching "${keyword}"`,
            allowEmpty: true,
            item: projects.map((p) => ({
                title: p.title,
                description: p.blurb || p.funded_pct || '',
                link: p.url,
                pubDate: undefined,
            })),
        };
    },
};

// 浏览器端函数体（字符串形式，避免 esbuild keepNames 注入 __name）
const FN_SOURCE = `async ({ limit }) => {
    // 在 chrome2 页面上下文内运行（带登录 cookie，可过反爬）
    const sleepAsync = (ms) => new Promise((r) => setTimeout(r, ms));

    // 1. 等 React hydration（不阻塞主线程，让页面正常渲染）
    await sleepAsync(6000);

    // 2. 关闭 cookie 弹窗
    let cookieBtn = document.querySelector('[data-testid="gdpr-consent-accept"], [data-testid="cookie-consent-accept"], .cookie-consent button, [class*="cookie"] button');
    if (!cookieBtn) {
        for (const btn of document.querySelectorAll('button, a[role="button"], [role="button"]')) {
            const t = (btn.textContent || '').toLowerCase().trim();
            if (['okay', 'accept', 'i accept', 'agree', 'got it', 'continue', 'consent', 'allow'].includes(t)) { cookieBtn = btn; break; }
        }
    }
    if (cookieBtn) { try { cookieBtn.click(); } catch (e) {} }

    // 3. 再等 React 重新渲染
    await sleepAsync(1500);

    // 4. 提取项目卡片（多级选择器 + 全链接兜底）
    const results = [];
    const seen = new Set();
    const cards = document.querySelectorAll(
        '[data-testid="project_card"], [data-project], .project-card, .discoverable-card, ' +
        '.react-disc-project-card, a[href*="/projects/"][class*="card"], a[href*="/projects/"][class*="project"], ' +
        'div[class*="discover"][class*="card"] a[href*="/projects/"], div[class*="grid"] a[href*="/projects/"]'
    );
    const allLinks = Array.from(document.querySelectorAll('a[href*="/projects/"]'))
        .filter((a) => a.href.match(/kickstarter\\.com\\/projects\\/[^/]+\\/[^/?#]+/));
    for (const el of (cards.length > 0 ? cards : allLinks)) {
        const link = el.tagName === 'A' ? el.href : (el.querySelector('a[href*="/projects/"]')?.href || '');
        if (!link || seen.has(link)) continue;
        seen.add(link);
        const container = el.closest?.('[class*="card"], [class*="project"], [class*="discover"], li, div') || el;
        const titleEl = container.querySelector?.('h2, h3, h4, [class*="title"], [class*="name"], strong') || el;
        const title = (titleEl.textContent || '').trim().replace(/\\s+/g, ' ');
        if (!title || title.length < 3 || title.length > 200) continue;
        const text = (container.textContent || '').toLowerCase();
        let pledged = '';
        const pm = text.match(/(?:pledged|raised|funded)[:\\s]*[$€£¥]?\\s*([\\d,]+(?:[.]\\d+)?)\\s*(k|m|million|thousand)?/i);
        if (pm) pledged = '$' + pm[1] + (pm[2] || '');
        results.push({ title: title.slice(0, 120), blurb: pledged, url: link });
        if (results.length >= limit) break;
    }
    return results;
}`;
