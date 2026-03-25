// MEMES 24H Governance - Configuration

export const CONFIG = {
  // Governance repo (public) — proposals, votes, issues
  GOV_OWNER: '6529news',
  GOV_REPO: '6529news_gov',
  GOV_BRANCH: 'main',

  // Engine repo (private) — waves config, news data
  ENGINE_OWNER: '6529news',
  ENGINE_REPO: '6529news_engine',
  ENGINE_BRANCH: 'main',

  // Governance thresholds
  MIN_TDH_PROPOSE: 1_000_000,    // 1M TDH to create a proposal
  TDH_THRESHOLD_PASS: 30_000_000, // 30M TDH to pass a proposal
  TDH_THRESHOLD_REQUEST: 30_000_000, // 30M TDH to approve a generic request
  PROPOSAL_DURATION_DAYS: 10,

  // 6529 API
  API_6529: 'https://api.6529.io/api',

  // Data paths
  WAVES_CONFIG_PATH: 'data/waves-config.json', // in engine repo
  PROPOSALS_PATH: 'data/proposals',             // in gov repo
  VOTES_PATH: 'data/votes',                     // in gov repo

  // EIP-712 domain for vote signing
  EIP712_DOMAIN: {
    name: 'MEMES24H Governance',
    version: '1',
    chainId: 1
  },

  // EIP-712 types
  EIP712_TYPES: {
    Proposal: [
      { name: 'action', type: 'string' },
      { name: 'waveId', type: 'string' },
      { name: 'waveName', type: 'string' },
      { name: 'reason', type: 'string' },
      { name: 'timestamp', type: 'uint256' }
    ],
    Vote: [
      { name: 'proposalId', type: 'string' },
      { name: 'vote', type: 'string' },
      { name: 'timestamp', type: 'uint256' }
    ]
  },

  // Fine-grained PAT: can ONLY create issues on 6529news_gov (public repo)
  // Safe to embed — no access to code, secrets, or private repos
  ISSUES_TOKEN: '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',

  // Cache TTLs (ms)
  CACHE_PROPOSALS_TTL: 5 * 60 * 1000,  // 5 min
  CACHE_PROFILE_TTL: 10 * 60 * 1000,   // 10 min
};

// Derived URLs
export const GOV_API = `https://api.github.com/repos/${CONFIG.GOV_OWNER}/${CONFIG.GOV_REPO}`;
export const GOV_RAW = `https://raw.githubusercontent.com/${CONFIG.GOV_OWNER}/${CONFIG.GOV_REPO}/${CONFIG.GOV_BRANCH}`;
export const ENGINE_API = `https://api.github.com/repos/${CONFIG.ENGINE_OWNER}/${CONFIG.ENGINE_REPO}`;
