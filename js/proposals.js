// MEMES 24H Governance - Proposals Management
// Proposals/votes on public gov repo, issues via embedded token

import { CONFIG, GOV_API, GOV_RAW } from './config.js';
import { resolveIdentity, getTDH, verifyWave, formatTDH } from './api6529.js';
import { getAddress, signProposal } from './wallet.js';

let proposalsCache = null;
let proposalsCacheTs = 0;

// Auth headers for the issues-only token
function issueHeaders() {
  return {
    'Authorization': `Bearer ${CONFIG.ISSUES_TOKEN}`,
    'Content-Type': 'application/json',
    'Accept': 'application/vnd.github+json'
  };
}

// Create a GitHub Issue on the gov repo
async function createGitHubIssue(title, body, labels) {
  const res = await fetch(`${GOV_API}/issues`, {
    method: 'POST',
    headers: issueHeaders(),
    body: JSON.stringify({ title, body, labels })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`GitHub API error: ${err.message || res.status}`);
  }

  return res.json();
}

// Fetch all proposals from the gov repo (public — no auth needed)
export async function listProposals() {
  if (proposalsCache && Date.now() - proposalsCacheTs < CONFIG.CACHE_PROPOSALS_TTL) {
    return proposalsCache;
  }

  try {
    const res = await fetch(`${GOV_API}/contents/${CONFIG.PROPOSALS_PATH}`);
    if (!res.ok) return [];

    const files = await res.json();
    const jsonFiles = files.filter(f => f.name.endsWith('.json'));

    const proposals = await Promise.all(
      jsonFiles.map(async (f) => {
        // Public repo — download_url works
        if (f.download_url) {
          const r = await fetch(f.download_url);
          return r.json();
        }
        const r = await fetch(f.url);
        const data = await r.json();
        return JSON.parse(atob(data.content));
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
    const res = await fetch(`${GOV_RAW}/${CONFIG.PROPOSALS_PATH}/${id}.json?t=${Date.now()}`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// Get votes for a proposal
export async function getProposalVotes(proposalId) {
  try {
    const res = await fetch(`${GOV_API}/contents/${CONFIG.VOTES_PATH}/${proposalId}`);
    if (!res.ok) return [];

    const files = await res.json();
    const jsonFiles = files.filter(f => f.name.endsWith('.json'));

    const votes = await Promise.all(
      jsonFiles.map(async (f) => {
        if (f.download_url) {
          const r = await fetch(f.download_url);
          return r.json();
        }
        const r = await fetch(f.url);
        const data = await r.json();
        return JSON.parse(atob(data.content));
      })
    );

    return votes;
  } catch {
    return [];
  }
}

// Tally votes with live TDH lookup
export async function tallyVotes(votes) {
  let yesTDH = 0, noTDH = 0, yesCount = 0, noCount = 0;

  const detailed = await Promise.all(
    votes.map(async (v) => {
      const currentTDH = await getTDH(v.voter);
      const effectiveTDH = v.allocatedTDH ? Math.min(v.allocatedTDH, currentTDH) : currentTDH;
      return { ...v, currentTDH, effectiveTDH };
    })
  );

  for (const v of detailed) {
    if (v.vote === 'yes') { yesTDH += v.effectiveTDH; yesCount++; }
    else { noTDH += v.effectiveTDH; noCount++; }
  }

  return {
    yesTDH, noTDH, yesCount, noCount,
    totalTDH: yesTDH + noTDH,
    passed: yesTDH >= CONFIG.TDH_THRESHOLD_PASS,
    progress: Math.min(100, (yesTDH / CONFIG.TDH_THRESHOLD_PASS) * 100),
    votes: detailed
  };
}

// Create a new proposal with TDH allocation (minimum 1M)
export async function createProposal(action, waveId, reason, allocatedTDH) {
  const address = getAddress();
  if (!address) throw new Error('Wallet not connected');

  const identity = await resolveIdentity(address);

  // Check TDH budget
  const { total: alreadyAllocated } = await getAllocatedTDH(identity.primaryAddress);
  const available = identity.tdh - alreadyAllocated;

  if (allocatedTDH < CONFIG.MIN_TDH_PROPOSE) {
    throw new Error(`Minimum ${formatTDH(CONFIG.MIN_TDH_PROPOSE)} TDH to create a proposal.`);
  }
  if (allocatedTDH > available) {
    throw new Error(`Insufficient budget. Available: ${formatTDH(available)} TDH (${formatTDH(alreadyAllocated)} already allocated).`);
  }

  // Verify wave (skip for generic requests)
  let wave = { exists: true, name: reason.substring(0, 60) };
  if (action !== 'request') {
    wave = await verifyWave(waveId);
    if (!wave.exists) throw new Error('Wave not found on 6529.');
  }

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
    proposerAllocatedTDH: allocatedTDH,
    reason,
    createdAt: new Date(timestamp * 1000).toISOString(),
    expiresAt,
    status: 'active',
    signature
  };

  const title = action === 'request'
    ? `[REQUEST] ${reason.substring(0, 60)}`
    : `[PROPOSAL] ${action} wave: ${wave.name}`;
  const body = '```json\n' + JSON.stringify(proposal, null, 2) + '\n```';

  const result = await createGitHubIssue(title, body, [action === 'request' ? 'request' : 'proposal']);

  proposalsCache = null;
  return { proposal, issue: result };
}

// Check if current user has voted
export async function hasVoted(proposalId) {
  const address = getAddress();
  if (!address) return false;

  const identity = await resolveIdentity(address);
  const primaryAddr = identity.primaryAddress.toLowerCase();

  try {
    const res = await fetch(`${GOV_RAW}/${CONFIG.VOTES_PATH}/${proposalId}/${primaryAddr}.json?t=${Date.now()}`);
    return res.ok;
  } catch {
    return false;
  }
}

export function invalidateCache() {
  proposalsCache = null;
  proposalsCacheTs = 0;
}

// Calculate how much TDH is already allocated by a user across all active proposals
export async function getAllocatedTDH(primaryAddress) {
  const proposals = await listProposals();
  const active = proposals.filter(p => p.status === 'active' && new Date(p.expiresAt) > new Date());
  const addr = primaryAddress.toLowerCase();
  let total = 0;
  const breakdown = [];

  for (const p of active) {
    // Check if user is the proposer
    if (p.proposer.address.toLowerCase() === addr && p.proposerAllocatedTDH) {
      total += p.proposerAllocatedTDH;
      breakdown.push({ proposalId: p.id, type: 'proposer', tdh: p.proposerAllocatedTDH, waveName: p.waveName || p.reason?.substring(0, 40) });
    }

    // Check if user voted on this proposal
    const votes = await getProposalVotes(p.id);
    for (const v of votes) {
      if ((v.voter || '').toLowerCase() === addr || (v.submittedBy || '').toLowerCase() === addr) {
        const allocated = v.allocatedTDH || 0;
        total += allocated;
        breakdown.push({ proposalId: p.id, type: 'vote', tdh: allocated, waveName: p.waveName || p.reason?.substring(0, 40) });
      }
    }
  }

  return { total, breakdown };
}
