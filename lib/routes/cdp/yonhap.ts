import { load } from 'cheerio';

import type { Route } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

// Yonhap English: https://en.yna.co.kr/
// 首页结构: <h3 class="tit"><a href="https://en.yna.co.kr/view/PYHxxxxxxxxx">标题</a></h3>

export const route: Route = {
    path: '/yonhap',
    name: 'Yonhap English (韩联社英文版)',
    maintainers: ['huajun'],
    example: '/cdp/yonhap',
    categories: ['news'],
    parameters: {
        limit: 'Maximum number of articles to return (default 20)',
    },
    description: '韩联社英文版头条新闻。抓取 en.yna.co.kr 首页 HTML 解析，无需登录。',
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    handler: async (ctx) => {
        const limit = Math.min(parseInt(ctx.req.query('limit') || '20', 10) || 20, 50);
        const url = 'https://en.yna.co.kr/';
        const html = await ofetch(url, { responseType: 'text' });
        const $ = load(html);

        const items: any[] = [];
        // 首页标题+链接: <h1-4><a href="https://en.yna.co.kr/view/xxx">标题</a>
        $('h1, h2, h3, h4').each((_, el) => {
            if (items.length >= limit) return;
            const a = $(el).find('a').first();
            const href = a.attr('href') || '';
            const title = a.text().trim();
            if (href.includes('/view/') && title) {
                const fullUrl = href.split('?')[0];
                // 从 URL 中提取日期: PYH20260805128800315 -> 2026-08-05
                const m = fullUrl.match(/PYH(\d{4})(\d{2})(\d{2})/);
                let pubDate: string | undefined;
                if (m) {
                    pubDate = `${m[1]}-${m[2]}-${m[3]}T00:00:00+09:00`;
                }
                items.push({
                    title,
                    link: fullUrl,
                    pubDate: pubDate ? parseDate(pubDate) : undefined,
                });
            }
        });

        return {
            title: 'Yonhap English News',
            link: 'https://en.yna.co.kr/',
            description: 'Yonhap News Agency (English)',
            allowEmpty: true,
            item: items,
        };
    },
};
