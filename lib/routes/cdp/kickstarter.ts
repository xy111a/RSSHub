import type { Route } from '@/types';
import { withPage } from './_engine.mjs';

export const route: Route = {
    path: ['/kickstarter/search/:keyword', '/kickstarter/discover/:category?'],
    name: 'Kickstarter 众筹项目 (via chrome2 CDP)',
    maintainers: ['huajun'],
    example: '/cdp/kickstarter/discover/technology?sort=newest&limit=12',
    categories: ['crowdfunding'],
    parameters: {
        keyword: '搜索关键词（空格用 %20）— search 路由专用',
        category: '品类（默认 technology）：technology, design, games, film, music, art, comics, crafts, food, publishing, journalism — discover 路由专用',
        sort: 'magic | popularity | newest | end_date | most_funded | most_backed (default magic)',
        limit: 'Maximum number of projects (default 12, max 30)',
    },
    description:
        'Drives the already-running chrome2 browser over raw CDP to read Kickstarter. ' +
        'Cloudflare passes because chrome2 is a persistent headful browser. ' +
        'Extracts project cards from the rendered discover/search DOM: title, creator, funding status, category, location, cover image.',
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: true,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    handler: async (ctx) => {
        const keyword = ctx.req.param('keyword');
        const category = ctx.req.param('category') || 'technology';
        const sort = ctx.req.query('sort') || 'magic';
        const limit = Math.min(parseInt(ctx.req.query('limit') || '12', 10) || 12, 30);

        const url = keyword
            ? `https://www.kickstarter.com/discover/advanced?term=${encodeURIComponent(keyword)}&sort=${sort}`
            : `https://www.kickstarter.com/discover/categories/${encodeURIComponent(category)}?sort=${sort}`;

        // 用 eval 构造浏览器端函数：esbuild keepNames 会给 const 箭头函数注入 __name 包装，
        // toString 后进浏览器上下文会 ReferenceError。eval 出来的函数 toString 是干净源码。
        const kickstarterFetch = eval(KS_FN_SOURCE);
        // 空结果重试一次（CF 挑战时序偶发）；仍空则抛错——RSSHub 不缓存错误，避免失败态污染缓存 1 小时
        let projects = (await withPage(url, kickstarterFetch, { limit })) || [];
        if (projects.length === 0) {
            projects = (await withPage(url, kickstarterFetch, { limit })) || [];
        }
        if (projects.length === 0) {
            throw new Error(`Kickstarter: no projects extracted from ${url} (page challenged or structure changed)`);
        }

        return {
            title: keyword ? `Kickstarter: ${keyword} (${sort})` : `Kickstarter Discover: ${category} (${sort})`,
            link: url,
            description: keyword ? `Kickstarter projects matching "${keyword}"` : `Kickstarter projects in category "${category}"`,
            item: projects.map((p) => ({
                title: p.title,
                description:
                    (p.image ? `<img src="${p.image}" referrerpolicy="no-referrer" /><br>` : '') +
                    [p.status, p.creator && `by ${p.creator}`, p.category, p.location].filter(Boolean).join(' · '),
                link: p.url,
                pubDate: undefined,
            })),
        };
    },
};

// 浏览器端函数体（字符串形式，避免 esbuild keepNames 注入 __name）
// 依赖 chrome2 已登录会话过 Cloudflare；卡片选择器来自 2026-10 实测 DOM：
//   .project-card-root[href][aria-label]  a.project-card__title  a.project-card__creator
//   p(含 "% funded")  a[href*="/discover/categories/"]  a[href*="/discover/places/"]  .project-card__media img
const KS_FN_SOURCE = `async ({ limit }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();

    // 1. 等 React 渲染出项目卡片（SPA；Cloudflare 挑战后会自动 reload，窗口放到 45s）
    //    卡片或项目链接任一出现即继续
    const hasCards = () => document.querySelectorAll('.project-card-root').length > 0;
    const hasLinks = () => Array.from(document.querySelectorAll('a[href*="/projects/"]'))
        .some((a) => (a.href || '').match(/kickstarter\\.com\\/projects\\/[^/]+\\/[^/?#]+/));
    const t0 = Date.now();
    while (Date.now() - t0 < 45000 && !hasCards() && !hasLinks()) {
        await sleep(500);
    }
    await sleep(1500); // 等状态文字/图片稳定

    const out = [];
    const seen = new Set();
    const push = (title, href, extra) => {
        href = (href || '').split('?')[0].split('#')[0];
        if (!href.match(/kickstarter\\.com\\/projects\\/[^/]+\\/[^/?#]+/) || seen.has(href)) return;
        const t = clean(title);
        if (!t || t.length < 3) return;
        seen.add(href);
        out.push(Object.assign({ title: t.slice(0, 150), url: href }, extra || {}));
    };

    // 2. 主路径：结构化卡片
    for (const card of Array.from(document.querySelectorAll('.project-card-root'))) {
        const titleEl = card.querySelector('a.project-card__title');
        const creator = clean(card.querySelector('a.project-card__creator')?.textContent);
        const statusP = Array.from(card.querySelectorAll('p')).find((p) => p.textContent && p.textContent.includes('% funded'));
        const status = clean(statusP?.textContent);
        const category = clean(card.querySelector('a[href*="/discover/categories/"]')?.textContent);
        const location = clean(card.querySelector('a[href*="/discover/places/"]')?.textContent);
        const image = (card.querySelector('.project-card__media img') || {}).src || '';
        push((titleEl && titleEl.textContent) || card.getAttribute('aria-label'), (titleEl && titleEl.href) || card.getAttribute('href'),
            { creator, status, category, location, image });
        if (out.length >= limit) break;
    }

    // 3. 兜底：只有项目链接时（页面结构变动），至少保证标题+链接
    if (out.length === 0) {
        for (const a of Array.from(document.querySelectorAll('a[href*="/projects/"]'))) {
            if (!(a.href || '').match(/kickstarter\\.com\\/projects\\/[^/]+\\/[^/?#]+/)) continue;
            const container = a.closest('[class*="card"], li, div');
            const statusP = container && Array.from(container.querySelectorAll('p')).find((p) => p.textContent && p.textContent.includes('% funded'));
            push(a.textContent || a.getAttribute('aria-label'), a.href, { status: clean(statusP?.textContent) });
            if (out.length >= limit) break;
        }
    }
    return out;
}`;
