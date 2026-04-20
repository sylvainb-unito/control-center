import { fail, ok } from '@cc/server/envelope';
import { GhError, graphql } from '@cc/server/lib/gh';
import { Hono } from 'hono';
import type { ListResponse, PR } from './types';

const QUERY = `
query DashboardPRs {
  viewer {
    login
    pullRequests(first: 50, states: OPEN, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number title url isDraft createdAt updatedAt reviewDecision
        repository { nameWithOwner }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
  search(query: "is:pr is:open review-requested:@me", type: ISSUE, first: 50) {
    nodes {
      ... on PullRequest {
        number title url isDraft createdAt updatedAt reviewDecision
        repository { nameWithOwner }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
}`;

type RawNode = {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  reviewDecision: PR['reviewDecision'];
  repository: { nameWithOwner: string };
  commits: {
    nodes: Array<{ commit: { statusCheckRollup: { state: PR['checks'] } | null } }>;
  };
};

type RawResponse = {
  viewer: { pullRequests: { nodes: RawNode[] } };
  search: { nodes: RawNode[] };
};

function mapNode(n: RawNode): PR {
  return {
    number: n.number,
    title: n.title,
    url: n.url,
    repo: n.repository.nameWithOwner,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    isDraft: n.isDraft,
    reviewDecision: n.reviewDecision,
    checks: n.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
  };
}

export const api = new Hono();

api.get('/', async (c) => {
  try {
    const data = await graphql<RawResponse>(QUERY);
    const body: ListResponse = {
      authored: data.viewer.pullRequests.nodes.map(mapNode),
      reviewRequested: data.search.nodes.map(mapNode),
    };
    return c.json(ok(body));
  } catch (err) {
    if (err instanceof GhError) {
      const status = err.code === 'GH_AUTH_MISSING' ? 401 : 500;
      return c.json(fail(err.code, err.message), status);
    }
    throw err;
  }
});
