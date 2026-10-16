import type { Route } from '@/types';
import { withPage } from './_engine.mjs';

export const route: Route = {
    path: '/kickstarter/debug',
    name: 'Kickstarter 调试 (via chrome2 CDP)',
    maintainers: ['huajun'],
    example: '/cdp/kickstarter/debug',
    categories: ['crowdfunding'],
    parameters: {},
    description: 'Debug: dump Kickstarter advanced-search page state after loading (title, url, card counts, CF status, sample card HTML).',
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: true,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    handler: async (ctx) => {
        const url = 'https://www.kickstarter.com/discover/advanced?term=smart%20ring&sort=newest';
        const info = (await withPage(url, eval(DEBUG_FN_SOURCE), {})) || {};
        return {
            title: 'Kickstarter Debug',
            link: url,
            description: JSON.stringify(info),
            allowEmpty: true,
            item: [{ title: 'DEBUG', description: JSON.stringify(info), link: url }],
        };
    },
};

// 浏览器端函数体（字符串形式，避免 esbuild keepNames 注入 __name）
const DEBUG_FN_SOURCE = `async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const hasCards = () => document.querySelectorAll('.project-card-root').length > 0;
    const t0 = Date.now();
    let waited = 0;
    while (Date.now() - t0 < 45000 && !hasCards()) {
        await sleep(500);
        waited = Date.now() - t0;
    }
    const links = Array.from(document.querySelectorAll('a[href*="/projects/"]'))
        .filter((a) => (a.href || '').match(/kickstarter\\.com\\/projects\\/[^/]+\\/[^/?#]+/));
    const card = document.querySelector('.project-card-root');
    return {
        title: document.title,
        url: location.href,
        cards: document.querySelectorAll('.project-card-root').length,
        links: links.length,
        waitedMs: waited,
        hasCloudflare: /cf-challenge|challenge-platform|Just a moment/i.test(document.documentElement.innerHTML),
        sampleLinks: links.slice(0, 3).map((a) => a.href),
        cardHtml: card ? card.outerHTML.slice(0, 3000) : null,
        bodyText: (document.body ? (document.body.innerText || '') : '').slice(0, 300),
    };
}`;
