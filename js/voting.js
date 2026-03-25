// MEMES 24H Governance - Vote Submission
// Votes submitted via GitHub Issues API (stays on-site)
// Users can choose how much TDH to allocate

import { CONFIG, GITHUB_API } from './config.js';
import { getAddress, signVote } from './wallet.js';
import { resolveIdentity, formatTDH } from './api6529.js';

// Create a GitHub Issue via API
async function createGitHubIssue(title, body, labels) {
  const token = CONFIG.GITHUB_TOKEN;

  if (!token) {
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

// Submit a vote on a proposal with TDH allocation
export async function submitVote(proposalId, vote, allocatedTDH) {
  if (vote !== 'yes' && vote !== 'no') {
    throw new Error('Vote must be "yes" or "no"');
  }

  const address = getAddress();
  if (!address) throw new Error('Wallet not connected');

  // Get identity and TDH
  const identity = await resolveIdentity(address);
  if (identity.tdh === 0) {
    throw new Error('You need TDH to vote. Collect The Memes NFTs to earn TDH.');
  }

  // Validate allocated TDH
  if (!allocatedTDH || allocatedTDH <= 0) {
    throw new Error('You must allocate some TDH to your vote.');
  }
  if (allocatedTDH > identity.tdh) {
    throw new Error(`Cannot allocate more TDH than you have (${formatTDH(identity.tdh)}).`);
  }

  // Sign the vote
  const { signature, timestamp } = await signVote(proposalId, vote);

  const voteData = {
    proposalId,
    vote,
    voter: identity.primaryAddress,
    voterHandle: identity.handle,
    voterTDH: identity.tdh,
    allocatedTDH,
    timestamp,
    signature,
    submittedBy: address
  };

  // Submit via GitHub API
  const title = `[VOTE] ${proposalId} ${vote}`;
  const body = '```json\n' + JSON.stringify(voteData, null, 2) + '\n```';

  const result = await createGitHubIssue(title, body, ['vote']);

  return { voteData, issue: result };
}
