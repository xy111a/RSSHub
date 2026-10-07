import type { Route } from '@/types';
import ofetch from '@/utils/ofetch';

// 机器之心 API: https://www.jiqizhixin.com/api/article_library/articles.json?sort=time&page=1&per=12
// 返回 { articles: [{ id, title, slug, author, publishedAt, content, tagList, ... }] }
// 文章 URL: https://www.jiqizhixin.com/articles/{id}（id 或 slug 均可）

function parsePubDate(s: string): string | undefined {
    const m = s.match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/);
    if (!m) return undefined;
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+08:00`;
    const t = new Date(iso).getTime();
    return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

export const route: Route = {
    path: '/jiqizhixin',
    name: '机器之心',
    maintainers: ['huajun'],
    example: '/cdp/jiqizhixin',
    categories: ['new-media'],
    parameters: {
        limit: 'Maximum number of articles to return (default 20, max 50)',
    },
    description:
        '机器之心 - 全球人工智能产业信息服务。直接抓取官网公开 JSON API，无需登录。',
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
        const api = `https://www.jiqizhixin.com/api/article_library/articles.json?sort=time&page=1&per=${limit}`;
        const data: any = await ofetch(api);
        const articles: any[] = Array.isArray(data?.articles) ? data.articles : [];
        return {
            title: '机器之心',
            link: 'https://www.jiqizhixin.com',
            description: '机器之心 - 全球人工智能产业信息服务',
            item: articles.map((a) => ({
                title: a.title,
                link: `https://www.jiqizhixin.com/articles/${a.id || a.slug}`,
                description: a.content || '',
                author: a.author || '机器之心',
                pubDate: parsePubDate(a.publishedAt),
                category: a.tagList || [],
            })),
        };
    },
};
