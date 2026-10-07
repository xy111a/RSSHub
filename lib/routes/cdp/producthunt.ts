import type { Route } from '@/types';
import { parseDate } from '@/utils/parse-date';

// Product Hunt GraphQL API v2（2026-08-10 接入）
// token 与 _engine.mjs 的 TWITTER_BEARER 同模式：内网自用硬编码（用户 huajun 提供，expires: Never）
const PH_TOKEN = '8g5wWrm-Kbk7Mss-n_0e_FEzjGtHR0Sf2Y7vt9jtxpo';
const PH_API = 'https://api.producthunt.com/v2/api/graphql';

async function phQuery(query: string) {
    const res = await fetch(PH_API, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${PH_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error('PH API http ' + res.status);
    return res.json();
}

const POSTS_QUERY = (limit: number, order: string) => `{
  posts(first: ${limit}, order: ${order}) {
    edges {
      node {
        id
        name
        tagline
        url
        votesCount
        createdAt
        description
        website
      }
    }
  }
}`;

function toItems(j: any) {
    const edges = j?.data?.posts?.edges || [];
    return edges.map((e: any) => {
        const n = e.node;
        return {
            title: n.name + (n.tagline ? ' — ' + n.tagline : ''),
            description: (n.description || n.tagline || '').slice(0, 500),
            link: n.url,
            author: n.website || '',
            pubDate: n.createdAt ? parseDate(n.createdAt).toUTCString() : undefined,
            upvotes: n.votesCount,
        };
    });
}

export const route: Route = {
    path: '/producthunt/:order?',
    name: 'Product Hunt (GraphQL API)',
    maintainers: ['huajun'],
    example: '/cdp/producthunt/RANKING',
    categories: ['products'],
    parameters: {
        order: 'RANKING | NEWEST (default RANKING)',
        limit: 'Maximum number of products (default 10, max 30)',
    },
    description:
        'Fetches Product Hunt launches via the official GraphQL API v2 ' +
        '(developer token, no browser needed). RANKING = trending, NEWEST = latest.',
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    handler: async (ctx) => {
        const order = (ctx.req.param('order') || 'RANKING').toUpperCase();
        const limit = Math.min(parseInt(ctx.req.query('limit') || '10', 10) || 10, 30);
        const j = await phQuery(POSTS_QUERY(limit, order));
        return {
            title: `Product Hunt (${order})`,
            link: 'https://www.producthunt.com',
            description: `Top ${order} products today`,
            allowEmpty: true,
            item: toItems(j),
        };
    },
};
