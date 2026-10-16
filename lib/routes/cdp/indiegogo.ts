import type { Route } from '@/types';
import { withPage } from './_engine.mjs';

export const route: Route = {
    path: '/indiegogo/explore/:category?',
    name: 'Indiegogo 众筹项目 (via chrome2 CDP)',
    maintainers: ['huajun'],
    example: '/cdp/indiegogo/explore/technology?limit=12',
    categories: ['crowdfunding'],
    parameters: {
        category: '品类（默认 technology）：technology, design, film, music, gaming, health-fitness, education, food-beverage, community, environment, travel, creative-works',
        limit: 'Maximum number of projects (default 12, max 30)',
    },
    description:
        'Drives the already-running chrome2 browser over raw CDP to read Indiegogo (direct fetch is 403). ' +
        'The explore page redirects to /en/projects/search and renders server-side cards with data-qa hooks: ' +
        'funds gathered, funded text, time left, backers, followers, phase, cover image. ' +
        'Note: some tech campaigns are hosted on Gamefound (Indiegogo group) and link there.',
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: true,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    handler: async (ctx) => {
        const category = ctx.req.param('category') || 'technology';
        const limit = Math.min(parseInt(ctx.req.query('limit') || '12', 10) || 12, 30);

        const url = `https://www.indiegogo.com/explore/all?category=${encodeURIComponent(category)}`;

        // 用 eval 构造浏览器端函数：esbuild keepNames 会给 const 箭头函数注入 __name 包装，
        // toString 后进浏览器上下文会 ReferenceError。eval 出来的函数 toString 是干净源码。
        const indiegogoFetch = eval(IG_FN_SOURCE);
        // 空结果重试一次（CF 挑战时序偶发）；仍空则抛错——RSSHub 不缓存错误，避免失败态污染缓存 1 小时
        let projects = (await withPage(url, indiegogoFetch, { limit })) || [];
        if (projects.length === 0) {
            projects = (await withPage(url, indiegogoFetch, { limit })) || [];
        }
        if (projects.length === 0) {
            throw new Error(`Indiegogo: no projects extracted from ${url} (page challenged or structure changed)`);
        }

        return {
            title: `Indiegogo Explore: ${category}`,
            link: url,
            description: `Indiegogo campaigns in category "${category}"`,
            item: projects.map((p) => ({
                title: p.title,
                description:
                    (p.image ? `<img src="${p.image}" referrerpolicy="no-referrer" /><br>` : '') +
                    [
                        p.funds && `Raised: ${p.funds}`,
                        p.fundedText,
                        p.phase,
                        p.timeLeft,
                        p.backers && `Backers: ${p.backers}`,
                        p.followers && `Followers: ${p.followers}`,
                        p.creator && `by ${p.creator}`,
                    ]
                        .filter(Boolean)
                        .join(' · '),
                link: p.url,
                pubDate: undefined,
            })),
        };
    },
};

// 浏览器端函数体（字符串形式，避免 esbuild keepNames 注入 __name）
// Indiegogo 直连 403，必须经 chrome2 渲染；卡片选择器来自 2026-10 实测 DOM：
//   .gfu-project-card  [data-qa="project-card:ProjectName"]  [data-qa="main-creator-name"]
//   [data-qa="project-card:FundsGathered"]  [data-qa="project-card:FundedAtText"]
//   [data-qa="project-card:TimeLeft"]  [data-qa="project-card:BackersCount"]
//   [data-qa="project-card:NumberOfFollowers"]  [data-qa="project-card:ProjectPhaseLabel"]
const IG_FN_SOURCE = `async ({ limit }) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();

    // 1. explore 会跳转 /en/projects/search，等卡片渲染（最多 60s，CF 挑战会自行清除）
    let cards = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
        cards = Array.from(document.querySelectorAll('.gfu-project-card'));
        if (cards.length > 0) break;
        await sleep(500);
    }
    await sleep(1200);

    // 2. 关掉可能出现的 cookie 弹窗
    try {
        const btn = Array.from(document.querySelectorAll('button')).find((b) => /accept|agree|got it|okay/i.test(b.textContent || ''));
        if (btn) btn.click();
        await sleep(300);
    } catch (e) {}

    const out = [];
    const seen = new Set();
    for (const card of cards) {
        const titleEl = card.querySelector('[data-qa="project-card:ProjectName"]');
        const linkEl = (titleEl && titleEl.querySelector('a')) || card.querySelector('a[href]');
        let url = (linkEl && linkEl.href) || '';
        url = url.split('?ref=')[0].split('#')[0];
        if (!url.startsWith('http') || seen.has(url)) continue;
        seen.add(url);

        const title = clean(titleEl?.textContent);
        if (!title || title.length < 3) continue;

        const creator = clean(card.querySelector('[data-qa="main-creator-name"]')?.textContent);
        const funds = clean(card.querySelector('[data-qa="project-card:FundsGathered"]')?.textContent);
        const fundedText = clean(card.querySelector('[data-qa="project-card:FundedAtText"]')?.textContent);
        const timeLeft = clean(card.querySelector('[data-qa="project-card:TimeLeft"]')?.textContent);
        const backers = clean(card.querySelector('[data-qa="project-card:BackersCount"]')?.textContent);
        const followers = clean(card.querySelector('[data-qa="project-card:NumberOfFollowers"]')?.textContent);
        const phase = clean(card.querySelector('[data-qa="project-card:ProjectPhaseLabel"]')?.textContent);
        const image = (card.querySelector('.gfu-card__media img') || {}).src || '';

        out.push({ title: title.slice(0, 150), url, creator, funds, fundedText, timeLeft, backers, followers, phase, image });
        if (out.length >= limit) break;
    }
    return out;
}`;
