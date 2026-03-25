// MEMES 24H Governance - Configuration
// All constants in one place for easy modification and transfer

export const CONFIG = {
  // GitHub repo - change these when transferring ownership
  REPO_OWNER: '6529news',
  REPO_NAME: '6529news_engine',
  REPO_BRANCH: 'main',

  // Governance thresholds
  MIN_TDH_PROPOSE: 1_000_000,    // 1M TDH to create a proposal
  TDH_THRESHOLD_PASS: 30_000_000, // 30M TDH to pass a proposal
  TDH_THRESHOLD_REQUEST: 30_000_000, // 30M TDH to approve a generic request
  PROPOSAL_DURATION_DAYS: 10,

  // 6529 API
  API_6529: 'https://api.6529.io/api',

  // Data paths in repo
  WAVES_CONFIG_PATH: 'data/waves-config.json',
  PROPOSALS_PATH: 'data/proposals',
  VOTES_PATH: 'data/votes',

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

  // GitHub fine-grained PAT (issues:write only)
  // This token can ONLY create issues. Safe to expose in client code.
  // To rotate: create new fine-grained PAT with Repository > Issues > Write
  // Token loaded from localStorage (user enters it once)
  // Or set via URL param: ?token=xxx
  get GITHUB_TOKEN() {
    return localStorage.getItem('memes24h_gh_token') || '';
  },

  // Cache TTLs (ms)
  CACHE_PROPOSALS_TTL: 5 * 60 * 1000,  // 5 min
  CACHE_PROFILE_TTL: 10 * 60 * 1000,   // 10 min
};

// Derived URLs
export const GITHUB_RAW = `https://raw.githubusercontent.com/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/${CONFIG.REPO_BRANCH}`;
export const GITHUB_API = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}`;
