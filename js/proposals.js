// MEMES 24H Governance - Proposals Management
// Creates proposals via GitHub Issues API (stays on-site)

import { CONFIG, GITHUB_RAW, GITHUB_API } from './config.js';
import { resolveIdentity, getTDH, verifyWave, formatTDH } from './api6529.js';
import { getAddress, signProposal } from './wallet.js';

let proposalsCache = null;
let proposalsCacheTs = 0;

// Create a GitHub Issue via API (no redirect)
async function createGitHubIssue(title, body, labels) {
  const token = CONFIG.GITHUB_TOKEN;

  if (!token) {
    // Fallback: open GitHub issue page in new tab
    const issueUrl = `https://github.com/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=${labels.join(',')}`;
    window.open(issueUrl, '_blank');
    return { fallback: true };
  }

  const res = await fetch(`${GITHUB_API}/issues`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github+json'
    },
    body: JSON.stringify({ title, body, labels })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`GitHub API error: ${err.message || res.status}`);
  }

  return res.json();
}

// Fetch all proposals from the GitHub repo
export async function listProposals() {
  if (proposalsCache && Date.now() - proposalsCacheTs < CONFIG.CACHE_PROPOSALS_TTL) {
    return proposalsCache;
  }

  try {
    const headers = CONFIG.GITHUB_TOKEN ? { 'Authorization': `Bearer ${CONFIG.GITHUB_TOKEN}` } : {};
    const res = await fetch(`${GITHUB_API}/contents/${CONFIG.PROPOSALS_PATH}`, { headers });
    if (!res.ok) return [];

    const files = await res.json();
    const jsonFiles = files.filter(f => f.name.endsWith('.json'));

    const proposals = await Promise.all(
      jsonFiles.map(async (f) => {
        const r = await fetch(f.download_url, { headers });
        return r.json();
      })
    );

    proposals.sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (a.status !== 'active' && b.status === 'active') return 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    proposalsCache = proposals;
    proposalsCacheTs = Date.now();
    return proposals;
  } catch (err) {
    console.error('Failed to list proposals:', err);
    return [];
  }
}

// Fetch a single proposal
export async function getProposal(id) {
  try {
    const headers = CONFIG.GITHUB_TOKEN ? { 'Authorization': `Bearer ${CONFIG.GITHUB_TOKEN}` } : {};
    const res = await fetch(`${GITHUB_API}/contents/${CONFIG.PROPOSALS_PATH}/${id}.json`, { headers });
    if (!res.ok) return null;
    const data = await res.json();
    return JSON.parse(atob(data.content));
  } catch {
    return null;
  }
}

// Get votes for a proposal
export async function getProposalVotes(proposalId) {
  try {
    const headers = CONFIG.GITHUB_TOKEN ? { 'Authorization': `Bearer ${CONFIG.GITHUB_TOKEN}` } : {};
    const res = await fetch(`${GITHUB_API}/contents/${CONFIG.VOTES_PATH}/${proposalId}`, { headers });
    if (!res.ok) return [];

    const files = await res.json();
    const jsonFiles = files.filter(f => f.name.endsWith('.json'));

    const votes = await Promise.all(
      jsonFiles.map(async (f) => {
        const r = await fetch(f.download_url, { headers });
        return r.json();
      })
    );

    return votes;
  } catch {
    return [];
  }
}

// Tally votes with live TDH lookup
export async function tallyVotes(votes) {
  let yesTDH = 0;
  let noTDH = 0;
  let yesCount = 0;
  let noCount = 0;

  const detailed = await Promise.all(
    votes.map(async (v) => {
      const currentTDH = await getTDH(v.voter);
      // Use allocated TDH if available, capped by current TDH
      const effectiveTDH = v.allocatedTDH ? Math.min(v.allocatedTDH, currentTDH) : currentTDH;
      return { ...v, currentTDH, effectiveTDH };
    })
  );

  for (const v of detailed) {
    if (v.vote === 'yes') {
      yesTDH += v.effectiveTDH;
      yesCount++;
    } else {
      noTDH += v.effectiveTDH;
      noCount++;
    }
  }

  return {
    yesTDH, noTDH, yesCount, noCount,
    totalTDH: yesTDH + noTDH,
    passed: yesTDH >= CONFIG.TDH_THRESHOLD_PASS,
    progress: Math.min(100, (yesTDH / CONFIG.TDH_THRESHOLD_PASS) * 100),
    votes: detailed
  };
}

// Create a new proposal (via GitHub API, stays on-site)
export async function createProposal(action, waveId, reason) {
  const address = getAddress();
  if (!address) throw new Error('Wallet not connected');

  // Verify TDH
  const identity = await resolveIdentity(address);
  if (identity.tdh < CONFIG.MIN_TDH_PROPOSE) {
    throw new Error(`Insufficient TDH. You have ${formatTDH(identity.tdh)}, need ${formatTDH(CONFIG.MIN_TDH_PROPOSE)}.`);
  }

  // Verify wave exists (skip for generic requests)
  let wave = { exists: true, name: reason.substring(0, 60) };
  if (action !== 'request') {
    wave = await verifyWave(waveId);
    if (!wave.exists) throw new Error('Wave not found on 6529.');
  }

  // Sign the proposal
  const { signature, timestamp } = await signProposal(action, waveId, wave.name, reason);

  const expiresAt = new Date(timestamp * 1000 + CONFIG.PROPOSAL_DURATION_DAYS * 86400000).toISOString();

  const proposal = {
    id: `prop-${timestamp}`,
    action,
    waveId,
    waveName: wave.name,
    proposer: {
      address: identity.primaryAddress,
      handle: identity.handle,
      tdh: identity.tdh
    },
    reason,
    createdAt: new Date(timestamp * 1000).toISOString(),
    expiresAt,
    status: 'active',
    signature
  };

  // Submit via GitHub API
  const title = `[PROPOSAL] ${action} wave: ${wave.name}`;
  const body = '```json\n' + JSON.stringify(proposal, null, 2) + '\n```';

  const result = await createGitHubIssue(title, body, ['proposal']);

  // Invalidate cache
  proposalsCache = null;

  return { proposal, issue: result };
}

// Check if current user has voted on a proposal
export async function hasVoted(proposalId) {
  const address = getAddress();
  if (!address) return false;

  const identity = await resolveIdentity(address);
  const primaryAddr = identity.primaryAddress.toLowerCase();

  try {
    const headers = CONFIG.GITHUB_TOKEN ? { 'Authorization': `Bearer ${CONFIG.GITHUB_TOKEN}` } : {};
    const res = await fetch(`${GITHUB_API}/contents/${CONFIG.VOTES_PATH}/${proposalId}/${primaryAddr}.json`, { headers });
    return res.ok;
  } catch {
    return false;
  }
}

// Invalidate cache (call after actions)
export function invalidateCache() {
  proposalsCache = null;
  proposalsCacheTs = 0;
}
