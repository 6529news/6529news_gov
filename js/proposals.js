// MEMES 24H Governance - Proposals Management
// Proposals/votes on public gov repo, issues via embedded token

import { CONFIG, GOV_API } from './config.js';
import { resolveIdentity, getTDH, verifyWave, formatTDH } from './api6529.js';
import { getAddress, signProposal } from './wallet.js';

let proposalsCache = null;
let proposalsCacheTs = 0;

// Submit via Cloudflare Worker proxy (token is server-side)
async function workerPost(endpoint, data) {
  const res = await fetch(`${CONFIG.WORKER_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });

  const result = await res.json();
  if (!res.ok) throw new Error(result.error || `Worker error: ${res.status}`);
  return result;
}

// Parse a proposal/vote from a GitHub Issue body (JSON in code block)
function parseIssueJSON(body) {
  const match = body.match(/```json\n([\s\S]*?)\n```/);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

// Fetch all proposals from GitHub Issues (public repo, no auth needed)
export async function listProposals() {
  if (proposalsCache && Date.now() - proposalsCacheTs < CONFIG.CACHE_PROPOSALS_TTL) {
    return proposalsCache;
  }

  try {
    // Fetch all issues labeled as proposal, request, or any category
    const res = await fetch(`${GOV_API}/issues?state=all&per_page=100&sort=created&direction=desc`);
    if (!res.ok) return [];

    const issues = await res.json();
    const proposals = [];

    for (const issue of issues) {
      const labels = issue.labels.map(l => l.name);
      // Skip vote issues and test issues
      if (labels.includes('vote') || labels.includes('test')) continue;
      if (issue.title.toLowerCase().includes('test') || issue.title.toLowerCase().includes('delete')) continue;

      const data = parseIssueJSON(issue.body);
      if (!data || !data.proposer) continue;

      // Determine status from issue state
      const isExpired = data.expiresAt && new Date(data.expiresAt) < new Date();
      if (issue.state === 'closed') {
        data.status = labels.includes('passed') ? 'passed' : 'rejected';
      } else {
        data.status = isExpired ? 'expired' : 'active';
      }

      data.issueNumber = issue.number;
      data.issueUrl = issue.html_url;
      proposals.push(data);
    }

    proposals.sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (a.status !== 'active' && b.status === 'active') return 1;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    proposalsCache = proposals;
    proposalsCacheTs = Date.now();
    return proposals;
  } catch (err) {
    console.error('Failed to list proposals:', err);
    return [];
  }
}

// Fetch a single proposal by ID
export async function getProposal(id) {
  const proposals = await listProposals();
  return proposals.find(p => p.id === id) || null;
}

// Get votes for a proposal from GitHub Issues
export async function getProposalVotes(proposalId) {
  try {
    const res = await fetch(`${GOV_API}/issues?labels=vote&state=all&per_page=100`);
    if (!res.ok) return [];

    const issues = await res.json();
    const votes = [];

    for (const issue of issues) {
      const data = parseIssueJSON(issue.body);
      if (data && data.proposalId === proposalId) {
        votes.push(data);
      }
    }

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

  // Verify wave only for add/remove actions
  const needsWave = ['add', 'remove'].includes(action);
  let wave = { exists: true, name: reason.substring(0, 60) };
  if (needsWave) {
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

  const result = await workerPost('/api/proposal', { proposal, signature });

  proposalsCache = null;
  return { proposal, issue: result.issue };
}

// Check if current user has voted
export async function hasVoted(proposalId) {
  const address = getAddress();
  if (!address) return false;

  const identity = await resolveIdentity(address);
  const primaryAddr = identity.primaryAddress.toLowerCase();

  const votes = await getProposalVotes(proposalId);
  return votes.some(v =>
    (v.voter || '').toLowerCase() === primaryAddr ||
    (v.submittedBy || '').toLowerCase() === primaryAddr
  );
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
