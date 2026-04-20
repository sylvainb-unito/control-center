export type PRCheckState = 'SUCCESS' | 'FAILURE' | 'PENDING' | 'NEUTRAL' | null;
export type PRReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;

export type PR = {
  number: number;
  title: string;
  url: string;
  repo: string;
  createdAt: string;
  updatedAt: string;
  isDraft: boolean;
  reviewDecision: PRReviewDecision;
  checks: PRCheckState;
};

export type ListResponse = { authored: PR[]; reviewRequested: PR[] };
