import { load } from 'cheerio';

import type { Route } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

// ITmedia NEWS (日本): https://www.itmedia.co.jp/
// ⚠️ 页面为 Shift-JIS 编码，需手动解码
// 主页聚合所有子品牌文章: https://atmarkit.itmedia.co.jp/ait/articles/2608/07/news030.html

export const route: Route = {
    path: '/itmedia',
    name: 'ITmedia NEWS (日本科技)',
    maintainers: ['huajun'],
    example: '/cdp/itmedia',
    categories: ['news'],
    parameters: {
        limit: 'Maximum number of articles to return (default 20)',
    },
    description: 'ITmedia 聚合主页新闻，覆盖 IT/科技/企业数字化。页面为 Shift-JIS 编码，自动转换。',
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
        const url = 'https://www.itmedia.co.jp/';
        // 获取原始字节并按 Shift-JIS 解码
        const buf = await ofetch(url, { responseType: 'arrayBuffer' });
        const decoder = new TextDecoder('shift_jis');
        const html = decoder.decode(buf);
        const $ = load(html);

        const items: any[] = [];
        const seen = new Set<string>();

        $('a').each((_, el) => {
            if (items.length >= limit) return;
            const href = $(el).attr('href') || '';
            // 文章链接: https://*.itmedia.co.jp/*/articles/YYMM/DD/newsXXX.html
            if (!href.includes('/articles/')) return;
            const title = $(el).text().trim();
            if (!title || title.length < 5) return;
            const fullUrl = href.split('#')[0];
            if (seen.has(fullUrl)) return;
            seen.add(fullUrl);

            // 日期从 URL: /articles/2608/07/ -> 2026-08-07
            const m = fullUrl.match(/\/articles\/(\d{2})(\d{2})\/(\d{2})\//);
            let pubDate: string | undefined;
            if (m) {
                const year = 2000 + parseInt(m[1], 10);
                pubDate = `${year}-${m[2]}-${m[3]}T00:00:00+09:00`;
            }

            items.push({
                title,
                link: fullUrl,
                pubDate: pubDate ? parseDate(pubDate) : undefined,
            });
        });

        return {
            title: 'ITmedia NEWS Japan',
            link: 'https://www.itmedia.co.jp/',
            description: 'ITmedia NEWS（日本科技媒体聚合）',
            allowEmpty: true,
            item: items,
        };
    },
};
