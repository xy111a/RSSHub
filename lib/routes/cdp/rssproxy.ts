import Parser from 'rss-parser';

import type { Route } from '@/types';
import { parseDate } from '@/utils/parse-date';

// 通用标准 RSS/Atom 代理路由
// 用法: /cdp/rss/<urlencode(官方feed地址)>?limit=N
// 示例: /cdp/rss/https%3A%2F%2Fwww.theguardian.com%2Fworld%2Frss

const parser = new Parser({
    timeout: 20000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    },
});

export const route: Route = {
    path: '/rss/:url',
    name: 'Universal RSS Proxy (通用标准Feed代理)',
    maintainers: ['huajun'],
    example: '/cdp/rss/https%3A%2F%2Fwww.theguardian.com%2Fworld%2Frss',
    categories: ['news'],
    parameters: {
        url: 'URL-encoded official RSS/Atom feed address',
        limit: 'Maximum number of items (default 20, max 50)',
    },
    description: '代理任意标准 RSS/Atom feed，统一输出 RSSHub JSON 格式。用于官方 RSS 源收编。',
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
        const rawUrl = ctx.req.param('url');
        let feedUrl: string;
        try {
            feedUrl = decodeURIComponent(rawUrl);
        } catch {
            feedUrl = rawUrl;
        }

        const feed = await parser.parseURL(feedUrl);

        const items = (feed.items || []).slice(0, limit).map((item) => ({
            title: item.title?.trim() || '(untitled)',
            link: item.link || feed.link || feedUrl,
            pubDate: item.isoDate ? parseDate(item.isoDate) : undefined,
            description: item.contentSnippet || item.content || '',
            author: item.creator || item.author || '',
        }));

        return {
            title: feed.title || 'RSS Proxy',
            link: feed.link || feedUrl,
            description: feed.description || '',
            allowEmpty: true,
            item: items,
        };
    },
};
