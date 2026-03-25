// MEMES 24H Governance - Vote Submission
// Votes submitted via GitHub Issues on gov repo (embedded token)

import { CONFIG, GOV_API } from './config.js';
import { getAddress, signVote } from './wallet.js';
import { resolveIdentity, formatTDH } from './api6529.js';

// Create a GitHub Issue on the gov repo
async function createGitHubIssue(title, body, labels) {
  const res = await fetch(`${GOV_API}/issues`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CONFIG.ISSUES_TOKEN}`,
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

  const identity = await resolveIdentity(address);
  if (identity.tdh === 0) {
    throw new Error('You need TDH to vote. Collect The Memes NFTs to earn TDH.');
  }

  if (!allocatedTDH || allocatedTDH <= 0) {
    throw new Error('You must allocate some TDH to your vote.');
  }
  if (allocatedTDH > identity.tdh) {
    throw new Error(`Cannot allocate more TDH than you have (${formatTDH(identity.tdh)}).`);
  }

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

  const title = `[VOTE] ${proposalId} ${vote}`;
  const body = '```json\n' + JSON.stringify(voteData, null, 2) + '\n```';

  const result = await createGitHubIssue(title, body, ['vote']);

  return { voteData, issue: result };
}
