import type { Route } from '@/types';
import { withPage, redditFetch, redditSortFetch, redditToItems } from './_engine.mjs';

export const route: Route = {
    path: ['/reddit/hot/:sub', '/reddit/sub/:sub/:sort'],
    name: 'Reddit (via chrome2 CDP)',
    maintainers: ['huajun'],
    example: '/cdp/reddit/hot/programming',
    categories: ['social-media'],
    parameters: {
        sub: 'Subreddit name (without the `r/` prefix)',
        sort: 'For `/sub` route: hot | new | top | rising | controversial (default hot)',
        limit: 'Maximum number of posts to return (default 20)',
        time: 'For top / controversial: hour | day | week | month | year | all (default all)',
    },
    description:
        'Drives the already-logged-in chrome2 browser over CDP to fetch Reddit listings. ' +
        'Works for both the logged-in frontpage and arbitrary subreddits without an API key.',
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: true,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    handler: async (ctx) => {
        const sub = ctx.req.param('sub');
        const sort = ctx.req.param('sort') || 'hot';
        const limit = parseInt(ctx.req.query('limit') || '20', 10) || 20;
        const time = ctx.req.query('time') || 'all';
        let posts;
        let link;
        if (sort && ctx.req.param('sort') !== undefined) {
            posts = await withPage('https://www.reddit.com', redditSortFetch, { sub, sort, limit, time });
            link = `https://www.reddit.com/r/${sub}/${sort}`;
        } else {
            posts = await withPage('https://www.reddit.com', redditFetch, { sub, limit });
            link = sub ? `https://www.reddit.com/r/${sub}/hot` : 'https://www.reddit.com';
        }
        return {
            title: sub ? `Reddit /r/${sub} (${sort})` : 'Reddit Frontpage',
            link,
            description: sub ? `Posts from /r/${sub}` : 'Reddit frontpage',
            allowEmpty: true,
            item: redditToItems(posts),
        };
    },
};
