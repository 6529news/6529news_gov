// MEMES 24H Governance - Main Application Controller
// Hash-based routing SPA

import { CONFIG, GOV_API, ENGINE_API } from './config.js';
import { connectWallet, disconnectWallet, getAddress, isConnected, tryReconnect } from './wallet.js';
import { resolveIdentity, formatTDH, shortAddress, verifyWave } from './api6529.js';
import { listProposals, getProposal, getProposalVotes, tallyVotes, createProposal, hasVoted, getAllocatedTDH, deleteProposal, invalidateCache } from './proposals.js';
import { submitVote } from './voting.js';

// State
let userIdentity = null;
let currentView = 'dashboard';

// DOM
const app = document.getElementById('app');
const userArea = document.getElementById('userArea');

// === ROUTING ===
function route() {
  const hash = window.location.hash || '#/';
  if (hash === '#/' || hash === '#') renderDashboard();
  else if (hash.startsWith('#/proposal/')) renderProposalDetail(hash.split('#/proposal/')[1]);
  else if (hash.startsWith('#/request/')) renderProposalDetail(hash.split('#/request/')[1]);
  else if (hash === '#/create') renderCreateProposal();
  else if (hash === '#/requests') renderDashboard();
  else if (hash === '#/config') renderConfig();
  else if (hash === '#/profile') renderProfile();
  else if (hash.startsWith('#/profile/')) renderProfile(hash.split('#/profile/')[1]);
  else renderDashboard();
}

window.addEventListener('hashchange', route);

// === WALLET CONNECTION ===
window.connectWalletBtn = async function() {
  try {
    const address = await connectWallet();
    userIdentity = await resolveIdentity(address);
    renderUserArea();
    route(); // refresh current view
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.disconnectWalletBtn = function() {
  disconnectWallet();
  userIdentity = null;
  renderUserArea();
  route();
};

window.addEventListener('wallet-changed', async (e) => {
  if (e.detail.address) {
    userIdentity = await resolveIdentity(e.detail.address);
  } else {
    userIdentity = null;
  }
  renderUserArea();
  route();
});

// === USER AREA ===
async function renderUserArea() {
  if (!userIdentity) {
    userArea.innerHTML = `
      <button class="btn btn-connect" onclick="connectWalletBtn()">Connect Wallet</button>
    `;
    return;
  }

  // Calculate TDH budget
  let allocatedTDH = 0, availableTDH = userIdentity.tdh;
  try {
    const { total } = await getAllocatedTDH(userIdentity.primaryAddress);
    allocatedTDH = total;
    availableTDH = Math.max(0, userIdentity.tdh - total);
  } catch {}

  const delegateTag = userIdentity.isDelegate ? '<span class="tag-delegate">via delegate</span>' : '';
  const pfpSrc = userIdentity.pfp
    ? (userIdentity.pfp.startsWith('ipfs://') ? userIdentity.pfp.replace('ipfs://', 'https://ipfs.io/ipfs/') : userIdentity.pfp)
    : '';
  const pfpHtml = pfpSrc ? `<img src="${pfpSrc}" class="user-pfp" alt="">` : '<div class="user-pfp-placeholder"></div>';

  const budgetHtml = allocatedTDH > 0
    ? `${formatTDH(availableTDH)} free &middot; ${formatTDH(allocatedTDH)} used`
    : `${formatTDH(userIdentity.tdh)} TDH`;

  userArea.innerHTML = `
    <div class="user-info">
      <a href="#/profile" class="user-link">
        ${pfpHtml}
        <div class="user-details">
          <div class="user-handle">${userIdentity.handle || shortAddress(userIdentity.address)} ${delegateTag}</div>
          <div class="user-tdh">${budgetHtml} &middot; Level ${userIdentity.level}</div>
        </div>
      </a>
      <button class="btn btn-sm btn-disconnect" onclick="disconnectWalletBtn()">Disconnect</button>
    </div>
  `;
}

// === DASHBOARD ===
async function fetchConfig() {
  try {
    // Fetch from engine's GitHub Pages (public, no auth needed)
    const res = await fetch(`https://${CONFIG.ENGINE_OWNER}.github.io/${CONFIG.ENGINE_REPO}/${CONFIG.WAVES_CONFIG_PATH}?t=${Date.now()}`);
    if (!res.ok) throw new Error(res.status);
    return res.json();
  } catch (e) {
    console.error('Config fetch failed:', e);
    return { waves: [], collections: [] };
  }
}

async function renderDashboard() {
  currentView = 'dashboard';
  app.innerHTML = '<div class="loading">Loading proposals...</div>';

  let proposals = [], config = { waves: [], collections: [] };
  try {
    [proposals, config] = await Promise.all([listProposals(), fetchConfig()]);
  } catch (e) {
    console.error('Dashboard load error:', e);
    app.innerHTML = `<div class="empty-state">Error loading: ${e.message}. <a href="#/" onclick="location.reload()">Retry</a></div>`;
    return;
  }

  const activeProposals = proposals.filter(p => p.status === 'active');
  const pastProposals = proposals.filter(p => p.status !== 'active');

  let html = `
    <div class="section-header">
      <h2>Active Proposals</h2>
      ${userIdentity && userIdentity.tdh >= CONFIG.MIN_TDH_PROPOSE
        ? '<a href="#/create" class="btn btn-primary">+ New Proposal</a>'
        : ''}
    </div>
  `;

  // Check voted status with a single API call (all votes at once)
  const userVotedSet = new Set();
  if (userIdentity) {
    try {
      const res = await fetch(`${CONFIG.WORKER_URL}/api/issues?labels=vote&state=open&per_page=100`, {cache: 'no-store'});
      if (res.ok) {
        const voteIssues = await res.json();
        const primaryAddr = userIdentity.primaryAddress.toLowerCase();
        for (const issue of voteIssues) {
          const match = issue.body?.match(/```json\n([\s\S]*?)\n```/);
          if (match) {
            try {
              const v = JSON.parse(match[1]);
              if ((v.voter || '').toLowerCase() === primaryAddr || (v.submittedBy || '').toLowerCase() === primaryAddr) {
                userVotedSet.add(v.proposalId);
              }
            } catch {}
          }
        }
      }
    } catch {}
  }

  if (activeProposals.length === 0) {
    html += '<div class="empty-state">No active proposals. ';
    if (userIdentity && userIdentity.tdh >= CONFIG.MIN_TDH_PROPOSE) {
      html += '<a href="#/create">Create one</a>';
    } else {
      html += `Need ${formatTDH(CONFIG.MIN_TDH_PROPOSE)} TDH to propose.`;
    }
    html += '</div>';
  } else {
    html += '<div class="proposals-grid">';
    for (const p of activeProposals) {
      html += renderProposalCard(p, userVotedSet.has(p.id));
    }
    html += '</div>';
  }

  // Current config
  html += `
    <div class="section-header" style="margin-top:32px">
      <h2>Current News Sources</h2>
      <a href="#/config" class="btn btn-sm">How It Works</a>
    </div>
    <div class="config-grid">
      ${config.waves.map(w => `
        <div class="config-item">
          <span class="config-type">${w.type}</span>
          <span class="config-name">${w.name}</span>
        </div>
      `).join('')}
      ${config.collections.map(c => `
        <div class="config-item">
          <span class="config-type">market</span>
          <span class="config-name">${c.name}</span>
        </div>
      `).join('')}
    </div>
  `;

  // Past proposals
  if (pastProposals.length > 0) {
    html += `<div class="section-header" style="margin-top:32px"><h2>Past Proposals</h2></div>`;
    html += '<div class="proposals-grid">';
    for (const p of pastProposals) {
      html += renderProposalCard(p);
    }
    html += '</div>';
  }

  app.innerHTML = html;
}

const ACTION_LABELS = { add: 'Add Wave', remove: 'Remove Wave', general: 'General', graphics: 'Graphics', governance: 'Governance', request: 'Request' };

function renderProposalCard(p, userHasVoted = false) {
  const isExpired = new Date(p.expiresAt) < new Date();
  const statusClass = p.status === 'active' ? (isExpired ? 'status-expired' : 'status-active') : (p.status === 'passed' ? 'status-passed' : 'status-failed');
  const statusLabel = p.status === 'active' ? (isExpired ? 'EXPIRED' : 'ACTIVE') : p.status.toUpperCase();
  const daysLeft = Math.max(0, Math.ceil((new Date(p.expiresAt) - new Date()) / 86400000));
  const actionLabel = ACTION_LABELS[p.action] || p.action;
  const tdhInfo = p.proposerAllocatedTDH ? ` · ${formatTDH(p.proposerAllocatedTDH)} TDH` : '';
  const link = p.action === 'request' ? `#/request/${p.id}` : `#/proposal/${p.id}`;
  const votedBadge = userHasVoted ? '<span class="proposal-voted-badge">✓ VOTED</span>' : '';

  return `
    <a href="${link}" class="proposal-card ${userHasVoted ? 'proposal-voted' : ''}">
      <div class="proposal-header">
        <span class="proposal-action action-${p.action}">${actionLabel}</span>
        ${votedBadge}
        <span class="proposal-status ${statusClass}">${statusLabel}</span>
      </div>
      <div class="proposal-wave">${p.waveName}</div>
      <div class="proposal-reason">${p.reason || ''}</div>
      <div class="proposal-meta">
        <span>by ${p.proposer.handle || shortAddress(p.proposer.address)}${tdhInfo}</span>
        <span>${p.status === 'active' && !isExpired ? daysLeft + 'd left' : ''}</span>
      </div>
    </a>
  `;
}

// === PROPOSAL DETAIL ===
async function renderProposalDetail(id) {
  currentView = 'proposal';
  app.innerHTML = '<div class="loading">Loading proposal...</div>';

  const proposal = await getProposal(id);
  if (!proposal) {
    app.innerHTML = '<div class="empty-state">Proposal not found. <a href="#/">Back</a></div>';
    return;
  }

  const votes = await getProposalVotes(id);
  const tally = await tallyVotes(votes, proposal);
  const isExpired = new Date(proposal.expiresAt) < new Date();
  const daysLeft = Math.max(0, Math.ceil((new Date(proposal.expiresAt) - new Date()) / 86400000));
  const voted = userIdentity ? await hasVoted(id) : false;

  const actionLabel = ACTION_LABELS[proposal.action] || proposal.action;

  // Calculate available TDH budget for voting
  let availableTDH = userIdentity ? userIdentity.tdh : 0;
  let allocatedInfo = '';
  if (userIdentity) {
    const { total: alreadyAllocated } = await getAllocatedTDH(userIdentity.primaryAddress);
    availableTDH = Math.max(0, userIdentity.tdh - alreadyAllocated);
    if (alreadyAllocated > 0) allocatedInfo = ` (${formatTDH(alreadyAllocated)} allocated elsewhere)`;
  }

  let voteSection = '';
  if (userIdentity && proposal.status === 'active' && !isExpired && !voted) {
    if (availableTDH <= 0) {
      voteSection = '<div class="voted-msg">All your TDH is allocated to other proposals/votes. Withdraw some to vote here.</div>';
    } else {
      voteSection = `
      <div class="vote-panel">
        <h3>Allocate TDH</h3>
        <div class="tdh-allocator">
          <div class="tdh-allocator-header">
            <label>TDH to allocate</label>
            <span class="tdh-allocator-max">Available: ${formatTDH(availableTDH)}${allocatedInfo}</span>
          </div>
          <div class="tdh-slider-row">
            <input type="range" id="tdhSlider" min="1" max="${availableTDH}" value="${availableTDH}" class="tdh-slider">
            <input type="number" id="tdhInput" min="1" max="${availableTDH}" value="${availableTDH}" class="tdh-input">
          </div>
          <div class="tdh-presets">
            <button class="btn btn-sm tdh-preset" data-pct="25">25%</button>
            <button class="btn btn-sm tdh-preset" data-pct="50">50%</button>
            <button class="btn btn-sm tdh-preset" data-pct="75">75%</button>
            <button class="btn btn-sm tdh-preset" data-pct="100">100%</button>
          </div>
        </div>
        <div class="vote-actions">
          <button class="btn btn-yes" id="btnYes">+ Positive TDH</button>
          <button class="btn btn-no" id="btnNo">- Negative TDH</button>
        </div>
        <div id="voteStatus" class="vote-status"></div>
      </div>
    `;
    }
  } else if (voted) {
    const userVote = tally.votes.find(v =>
      (v.voter || '').toLowerCase() === userIdentity.primaryAddress.toLowerCase() ||
      (v.submittedBy || '').toLowerCase() === userIdentity.primaryAddress.toLowerCase()
    );
    const voteType = userVote?.vote === 'yes' ? 'Positive' : 'Negative';
    const voteTDH = userVote?.allocatedTDH || userVote?.effectiveTDH || 0;
    const maxTDH = availableTDH + voteTDH;
    if (proposal.status === 'active' && !isExpired) {
      voteSection = `
      <div class="vote-panel">
        <div class="voted-msg" style="margin-bottom:12px">
          Your allocation: <strong class="vote-${userVote?.vote}">${voteType} ${formatTDH(voteTDH)} TDH</strong>
        </div>
        <h3>Modify Allocation</h3>
        <div class="tdh-allocator">
          <div class="tdh-allocator-header">
            <label>TDH to allocate</label>
            <span class="tdh-allocator-max">Available: ${formatTDH(maxTDH)}${allocatedInfo}</span>
          </div>
          <div class="tdh-slider-row">
            <input type="range" id="tdhSlider" min="1" max="${maxTDH}" value="${voteTDH}" class="tdh-slider">
            <input type="number" id="tdhInput" min="1" max="${maxTDH}" value="${voteTDH}" class="tdh-input">
          </div>
          <div class="tdh-presets">
            <button class="btn btn-sm tdh-preset" data-pct="25">25%</button>
            <button class="btn btn-sm tdh-preset" data-pct="50">50%</button>
            <button class="btn btn-sm tdh-preset" data-pct="75">75%</button>
            <button class="btn btn-sm tdh-preset" data-pct="100">100%</button>
          </div>
        </div>
        <div class="vote-actions">
          <button class="btn btn-yes" id="btnChangeYes">Confirm as + Positive</button>
          <button class="btn btn-no" id="btnChangeNo">Confirm as - Negative</button>
          <button class="btn btn-sm" id="btnWithdraw" style="margin-left:auto">Withdraw</button>
        </div>
        <div id="voteStatus" class="vote-status"></div>
      </div>`;
    } else {
      voteSection = `<div class="voted-msg">
        Your allocation: <strong>${voteType} ${formatTDH(voteTDH)} TDH</strong>
      </div>`;
    }
  } else if (!userIdentity) {
    voteSection = '<div class="voted-msg">Connect your wallet to vote.</div>';
  }

  // Check if current user is the proposer
  const isProposer = userIdentity && proposal.proposer?.address &&
    userIdentity.primaryAddress.toLowerCase() === proposal.proposer.address.toLowerCase();
  const deleteBtn = isProposer && proposal.status === 'active' && proposal.issueNumber
    ? `<button class="btn btn-no btn-sm" id="btnDelete" style="margin-left:auto">Delete Proposal</button>`
    : '';

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to Dashboard</a>
    <div class="proposal-detail">
      <div class="proposal-detail-header">
        <span class="proposal-action action-${proposal.action}">${actionLabel}</span>
        <h2>${proposal.waveName}</h2>
        ${deleteBtn}
      </div>

      <div class="proposal-info-grid">
        <div class="info-box">
          <div class="info-label">Proposer</div>
          <div class="info-value">${proposal.proposer.handle || shortAddress(proposal.proposer.address)}</div>
          <div class="info-sub">${formatTDH(proposal.proposer.tdh)} TDH</div>
        </div>
        <div class="info-box">
          <div class="info-label">Time Left</div>
          <div class="info-value">${isExpired ? 'Expired' : daysLeft + ' days'}</div>
          <div class="info-sub">${new Date(proposal.expiresAt).toLocaleDateString()}</div>
        </div>
        <div class="info-box">
          <div class="info-label">Status</div>
          <div class="info-value">${proposal.status.toUpperCase()}</div>
          <div class="info-sub">${tally.yesCount + tally.noCount} votes</div>
        </div>
      </div>

      <div class="reason-box">
        <div class="info-label">Reason</div>
        <p>${proposal.reason || 'No reason provided.'}</p>
      </div>

      <div class="tally-section">
        <div class="tally-header">
          <span>Progress: ${formatTDH(tally.yesTDH)} / ${formatTDH(CONFIG.TDH_THRESHOLD_PASS)} TDH</span>
          <span>${tally.progress.toFixed(1)}%</span>
        </div>
        <div class="tally-bar">
          <div class="tally-fill" style="width: ${tally.progress}%"></div>
        </div>
        <div class="tally-detail">
          <span class="tally-yes">+ Positive: ${formatTDH(tally.yesTDH)} TDH (${tally.yesCount})</span>
          <span class="tally-no">- Negative: ${formatTDH(tally.noTDH)} TDH (${tally.noCount})</span>
        </div>
      </div>

      ${voteSection}

      ${tally.votes.length > 0 ? `
        <div class="votes-list">
          <h3>Votes</h3>
          ${tally.votes.map(v => `
            <div class="vote-item">
              <span class="vote-badge vote-${v.vote}">${v.vote === 'yes' ? '+ Positive' : '- Negative'}</span>
              <span class="vote-handle">${v.voterHandle || shortAddress(v.voter)}</span>
              <span class="vote-tdh">${formatTDH(v.effectiveTDH || v.currentTDH)} TDH${v.allocatedTDH ? ' (allocated)' : ''}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;

  // TDH slider/input sync
  const slider = document.getElementById('tdhSlider');
  const input = document.getElementById('tdhInput');
  if (slider && input) {
    slider.addEventListener('input', () => { input.value = slider.value; });
    input.addEventListener('input', () => { slider.value = input.value; });

    // Preset buttons
    document.querySelectorAll('.tdh-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const pct = parseInt(btn.dataset.pct);
        const val = Math.max(1, Math.floor(availableTDH * pct / 100));
        slider.value = val;
        input.value = val;
      });
    });
  }

  // Vote handlers (new vote)
  const btnYes = document.getElementById('btnYes');
  const btnNo = document.getElementById('btnNo');
  if (btnYes) btnYes.addEventListener('click', () => handleVote(id, 'yes'));
  if (btnNo) btnNo.addEventListener('click', () => handleVote(id, 'no'));

  // Change vote handlers (withdraw old + submit new)
  const btnChangeYes = document.getElementById('btnChangeYes');
  const btnChangeNo = document.getElementById('btnChangeNo');
  if (btnChangeYes) btnChangeYes.addEventListener('click', () => handleChangeVote(id, 'yes', tally));
  if (btnChangeNo) btnChangeNo.addEventListener('click', () => handleChangeVote(id, 'no', tally));

  // Delete handler
  const btnDel = document.getElementById('btnDelete');
  if (btnDel) btnDel.addEventListener('click', async () => {
    if (!confirm('Delete this proposal? This cannot be undone.')) return;
    btnDel.disabled = true;
    btnDel.textContent = 'Deleting...';
    try {
      await deleteProposal(proposal.issueNumber, userIdentity.primaryAddress);
      showToast('Proposal deleted', 'success');
      invalidateCache();
      window.location.hash = '#/';
      route();
    } catch (err) {
      showToast(err.message, 'error');
      btnDel.disabled = false;
      btnDel.textContent = 'Delete Proposal';
    }
  });

  // Withdraw vote handler
  const btnWithdraw = document.getElementById('btnWithdraw');
  if (btnWithdraw) btnWithdraw.addEventListener('click', async () => {
    if (!confirm('Withdraw your vote? Your TDH will be freed.')) return;
    btnWithdraw.disabled = true;
    btnWithdraw.textContent = 'Withdrawing...';
    try {
      const primaryAddr = userIdentity.primaryAddress.toLowerCase();
      const myVote = tally.votes.find(v =>
        (v.voter || '').toLowerCase() === primaryAddr ||
        (v.submittedBy || '').toLowerCase() === primaryAddr
      );
      if (!myVote || !myVote.issueNumber) throw new Error('Vote issue not found');
      await deleteProposal(myVote.issueNumber, userIdentity.primaryAddress);
      showToast('Vote withdrawn', 'success');
      invalidateCache();
      renderProposalDetail(id);
    } catch (err) {
      showToast(err.message, 'error');
      btnWithdraw.disabled = false;
      btnWithdraw.textContent = 'Withdraw Vote';
    }
  });
}

async function handleVote(proposalId, vote) {
  const statusEl = document.getElementById('voteStatus');
  const tdhInput = document.getElementById('tdhInput');
  const allocatedTDH = tdhInput ? parseInt(tdhInput.value) : userIdentity.tdh;

  // Disable buttons
  const btnYes = document.getElementById('btnYes');
  const btnNo = document.getElementById('btnNo');
  if (btnYes) btnYes.disabled = true;
  if (btnNo) btnNo.disabled = true;


  if (statusEl) statusEl.innerHTML = '<span class="status-pending">Signing with wallet...</span>';

  try {
    const result = await submitVote(proposalId, vote, allocatedTDH);

    if (result.issue?.fallback) {
      if (statusEl) statusEl.innerHTML = '<span class="status-info">Redirected to GitHub to complete submission.</span>';
    } else {
      if (statusEl) statusEl.innerHTML = `
        <span class="status-success">
          Vote submitted successfully! Allocating ${formatTDH(allocatedTDH)} TDH.
          <br>Processing by GitHub Actions...
          <a href="${result.issue?.html_url}" target="_blank">View Issue</a>
        </span>
      `;
    }

    const voteTypeLabel = vote === 'yes' ? 'Positive' : 'Negative';
    showToast(`${voteTypeLabel} ${formatTDH(allocatedTDH)} TDH allocated!`, 'success');

    // Refresh the proposal view after a short delay to show updated tally
    invalidateCache();
    setTimeout(() => renderProposalDetail(proposalId), 2000);
  } catch (err) {
    if (statusEl) statusEl.innerHTML = `<span class="status-error">${err.message}</span>`;
    if (btnYes) btnYes.disabled = false;
    if (btnNo) btnNo.disabled = false;
    showToast(err.message, 'error');
  }
}

async function handleChangeVote(proposalId, newVote, tally) {
  const statusEl = document.getElementById('voteStatus');
  const tdhInput = document.getElementById('tdhInput');
  const allocatedTDH = tdhInput ? parseInt(tdhInput.value) : userIdentity.tdh;
  const btnChangeYes = document.getElementById('btnChangeYes');
  const btnChangeNo = document.getElementById('btnChangeNo');
  if (btnChangeYes) btnChangeYes.disabled = true;
  if (btnChangeNo) btnChangeNo.disabled = true;

  if (statusEl) statusEl.innerHTML = '<span class="status-pending">Withdrawing old vote...</span>';

  try {
    // 1. Withdraw old vote
    const primaryAddr = userIdentity.primaryAddress.toLowerCase();
    const myVote = tally.votes.find(v =>
      (v.voter || '').toLowerCase() === primaryAddr ||
      (v.submittedBy || '').toLowerCase() === primaryAddr
    );
    if (myVote && myVote.issueNumber) {
      await deleteProposal(myVote.issueNumber, userIdentity.primaryAddress);
    }
    invalidateCache();

    // 2. Submit new vote
    if (statusEl) statusEl.innerHTML = '<span class="status-pending">Signing new vote...</span>';
    const result = await submitVote(proposalId, newVote, allocatedTDH);

    const changeLabel = newVote === 'yes' ? 'Positive' : 'Negative';
    showToast(`Allocation changed to ${changeLabel} ${formatTDH(allocatedTDH)} TDH!`, 'success');
    invalidateCache();
    setTimeout(() => renderProposalDetail(proposalId), 2000);
  } catch (err) {
    if (statusEl) statusEl.innerHTML = `<span class="status-error">${err.message}</span>`;
    if (btnChangeYes) btnChangeYes.disabled = false;
    if (btnChangeNo) btnChangeNo.disabled = false;
    showToast(err.message, 'error');
  }
}

// === CREATE PROPOSAL ===
async function renderCreateProposal() {
  currentView = 'create';

  if (!userIdentity) {
    app.innerHTML = '<div class="empty-state">Connect your wallet to create a proposal. <a href="#/">Back</a></div>';
    return;
  }

  // Calculate available TDH budget
  const { total: alreadyAllocated, breakdown } = await getAllocatedTDH(userIdentity.primaryAddress);
  const available = userIdentity.tdh - alreadyAllocated;
  const minAlloc = CONFIG.MIN_TDH_PROPOSE;

  if (available < minAlloc) {
    app.innerHTML = `<div class="empty-state">
      Insufficient TDH budget. You need at least ${formatTDH(minAlloc)} available TDH.<br>
      Total: ${formatTDH(userIdentity.tdh)} | Allocated: ${formatTDH(alreadyAllocated)} | Available: ${formatTDH(available)}<br>
      <a href="#/">Back</a>
    </div>`;
    return;
  }

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to Dashboard</a>
    <div class="create-form">
      <h2>Create Proposal</h2>
      <p class="form-sub">Propose adding or removing a wave. Minimum ${formatTDH(minAlloc)} TDH to create. Your TDH is locked until the proposal expires or you withdraw it.</p>

      <div class="form-group">
        <label>Category</label>
        <select id="propAction">
          <option value="general">General Request</option>
          <option value="graphics">Graphics</option>
          <option value="governance">Governance Protocol</option>
        </select>
      </div>

      <div class="form-group">
        <label>Description</label>
        <textarea id="propReason" rows="3" placeholder="Describe your proposal..."></textarea>
      </div>

      <div class="form-group">
        <label>TDH to allocate</label>
        <div class="tdh-allocator">
          <div class="tdh-allocator-header">
            <span>Min: ${formatTDH(minAlloc)}</span>
            <span>Available: ${formatTDH(available)}${alreadyAllocated > 0 ? ` (${formatTDH(alreadyAllocated)} already allocated)` : ''}</span>
          </div>
          <div class="tdh-slider-row">
            <input type="range" id="tdhSlider" min="${minAlloc}" max="${available}" value="${minAlloc}" class="tdh-slider">
            <input type="number" id="tdhInput" min="${minAlloc}" max="${available}" value="${minAlloc}" class="tdh-input">
          </div>
          <div class="tdh-presets">
            <button class="btn btn-sm tdh-preset" data-val="${minAlloc}">Min (${formatTDH(minAlloc)})</button>
            <button class="btn btn-sm tdh-preset" data-pct="50">50%</button>
            <button class="btn btn-sm tdh-preset" data-pct="100">Max</button>
          </div>
        </div>
      </div>

      <div class="form-footer">
        <span class="form-cost">Total TDH: ${formatTDH(userIdentity.tdh)} | Available: ${formatTDH(available)}</span>
        <button class="btn btn-primary" id="btnSubmitProposal">Sign & Submit Proposal</button>
      </div>
      <div id="proposalStatus" class="vote-status" style="margin-top:16px"></div>
    </div>
  `;

  // TDH slider/input sync
  const slider = document.getElementById('tdhSlider');
  const input = document.getElementById('tdhInput');
  slider.addEventListener('input', () => { input.value = slider.value; });
  input.addEventListener('input', () => { slider.value = Math.min(Math.max(input.value, minAlloc), available); });
  document.querySelectorAll('.tdh-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.val) { slider.value = btn.dataset.val; input.value = btn.dataset.val; }
      else if (btn.dataset.pct) { const v = Math.floor(available * parseInt(btn.dataset.pct) / 100); slider.value = Math.max(v, minAlloc); input.value = slider.value; }
    });
  });

  // Submit handler
  document.getElementById('btnSubmitProposal').addEventListener('click', async () => {
    const action = document.getElementById('propAction').value;
    const reason = document.getElementById('propReason').value.trim();
    const allocatedTDH = parseInt(document.getElementById('tdhInput').value);
    if (!reason) { showToast('Enter a description', 'error'); return; }
    if (allocatedTDH < minAlloc) { showToast(`Minimum ${formatTDH(minAlloc)} TDH`, 'error'); return; }

    const statusEl = document.getElementById('proposalStatus');
    const btn = document.getElementById('btnSubmitProposal');
    btn.disabled = true;
    btn.textContent = 'Signing...';
    if (statusEl) statusEl.innerHTML = '<span class="status-pending">Signing proposal with wallet...</span>';

    try {
      const result = await createProposal(action, 'n/a', reason, allocatedTDH);
      showToast('Proposal submitted!', 'success');
      // Force cache clear and redirect immediately to dashboard
      invalidateCache();
      window.location.hash = '#/';
      route();
    } catch (err) {
      if (statusEl) statusEl.innerHTML = `<span class="status-error">${err.message}</span>`;
      btn.disabled = false;
      btn.textContent = 'Sign & Submit Proposal';
      showToast(err.message, 'error');
    }
  });
}

// === CONFIG VIEW ===
async function renderConfig() {
  app.innerHTML = '<div class="loading">Loading...</div>';

  const config = await fetchConfig();

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to Dashboard</a>
    <h2>How 6529 NEWS Works</h2>
    <p class="form-sub">All data is pulled automatically from 6529.io and OpenSea APIs. No manual intervention needed.</p>

    <h3 style="margin-top:24px">Main News Cards</h3>
    <div class="config-detail-grid">
      <div class="config-detail-item">
        <div class="config-detail-name">Minting Status</div>
        <div class="config-detail-meta"><span class="config-type">auto</span><span>Minting Tomorrow → Minting Today → Still Minting → Next Drop</span></div>
      </div>
      <div class="config-detail-item">
        <div class="config-detail-name">Top Memes (Projected Vote)</div>
        <div class="config-detail-meta"><span class="config-type">leaderboard</span><span>From Main Stage wave, updates every 4h</span></div>
      </div>
      <div class="config-detail-item">
        <div class="config-detail-name">Top SuperRare (Current Vote)</div>
        <div class="config-detail-meta"><span class="config-type">leaderboard</span><span>Random preview from top 10, updates every 4h</span></div>
      </div>
      <div class="config-detail-item">
        <div class="config-detail-name">New Submissions (7d)</div>
        <div class="config-detail-meta"><span class="config-type">auto</span><span>All submissions with media, ranked by TDH, 3 preview images</span></div>
      </div>
      <div class="config-detail-item">
        <div class="config-detail-name">Sales Recap</div>
        <div class="config-detail-meta"><span class="config-type">opensea</span><span>24h sales, volume, top 3 sold cards with preview</span></div>
      </div>
      <div class="config-detail-item">
        <div class="config-detail-name">Hot Wave Detection</div>
        <div class="config-detail-meta"><span class="config-type">ai</span><span>Any wave with 200+ msgs/h triggers AI summary (level-weighted). Auto-removes when activity drops.</span></div>
      </div>
      <div class="config-detail-item">
        <div class="config-detail-name">punk6529 Activity</div>
        <div class="config-detail-meta"><span class="config-type">hourly</span><span>Checked every hour. "Active Now" headline when posting. Full card if 5+ msgs/24h with AI summary.</span></div>
      </div>
    </div>

    <h3 style="margin-top:24px">NEWS Headline Strip</h3>
    <div class="config-detail-grid">
      <div class="config-detail-item"><div class="config-detail-name">Active Waves</div><div class="config-detail-meta"><span class="config-type">auto</span><span>Top 3 most active waves in last 4h, auto-discovered</span></div></div>
      <div class="config-detail-item"><div class="config-detail-name">punk6529 Last Seen</div><div class="config-detail-meta"><span class="config-type">hourly</span><span>Wave and timestamp of last message</span></div></div>
      <div class="config-detail-item"><div class="config-detail-name">Top Sale 24h</div><div class="config-detail-meta"><span class="config-type">opensea</span><span>Highest sale with card name and ETH price</span></div></div>
      <div class="config-detail-item"><div class="config-detail-name">Pebbles Market</div><div class="config-detail-meta"><span class="config-type">opensea</span><span>Floor price, sales count, last sale time</span></div></div>
      <div class="config-detail-item"><div class="config-detail-name">New Waves</div><div class="config-detail-meta"><span class="config-type">auto</span><span>Waves created in last 24h</span></div></div>
    </div>

    <h3 style="margin-top:24px">STATS Ticker</h3>
    <div class="config-detail-grid">
      <div class="config-detail-item"><div class="config-detail-name">Network TDH</div><div class="config-detail-meta"><span class="config-type">6529 api</span><span>Sum of all boosted TDH across all meme cards</span></div></div>
      <div class="config-detail-item"><div class="config-detail-name">Full Set Bid</div><div class="config-detail-meta"><span class="config-type">6529 api</span><span>Sum of highest offers across all cards</span></div></div>
      <div class="config-detail-item"><div class="config-detail-name">Holders / Full Set</div><div class="config-detail-meta"><span class="config-type">6529nfts</span><span>Collection holders count and full set holders count</span></div></div>
      <div class="config-detail-item"><div class="config-detail-name">#1 Memes</div><div class="config-detail-meta"><span class="config-type">leaderboard</span><span>Top projected vote artist and TDH</span></div></div>
      <div class="config-detail-item"><div class="config-detail-name">24h / 7d Volume</div><div class="config-detail-meta"><span class="config-type">opensea</span><span>Trading volume in ETH</span></div></div>
    </div>

    <h3 style="margin-top:24px">Update Schedule</h3>
    <div class="config-detail-grid">
      <div class="config-detail-item"><div class="config-detail-name">Every 4 hours</div><div class="config-detail-meta"><span>Full update: all news, stats, sales, submissions, waves</span></div></div>
      <div class="config-detail-item"><div class="config-detail-name">Every hour</div><div class="config-detail-meta"><span>punk6529 check + hot wave detection</span></div></div>
      <div class="config-detail-item"><div class="config-detail-name">Mon/Wed/Fri 19:00 UTC</div><div class="config-detail-meta"><span>Post-selection minting update (1h after 18:00 CET selection)</span></div></div>
    </div>

    <h3 style="margin-top:24px">Monitored Waves</h3>
    <div class="config-detail-grid">
      ${config.waves.map(w => `
        <div class="config-detail-item">
          <div class="config-detail-name">${w.name}</div>
          <div class="config-detail-meta">
            <span class="config-type">${w.type}</span>
            <span>Added by ${w.addedBy}</span>
          </div>
        </div>
      `).join('')}
      <div class="config-detail-item">
        <div class="config-detail-name">+ All active waves (auto-detected)</div>
        <div class="config-detail-meta"><span class="config-type">auto</span><span>Any wave with activity in last 4h appears in headlines</span></div>
      </div>
    </div>

    <h3 style="margin-top:24px">Market Collections</h3>
    <div class="config-detail-grid">
      ${config.collections.map(c => `
        <div class="config-detail-item">
          <div class="config-detail-name">${c.name}</div>
          <div class="config-detail-meta"><span class="config-type">opensea</span><span>${c.slug}</span></div>
        </div>
      `).join('')}
    </div>
  `;
}

// === PROFILE ===
async function renderProfile(addressParam) {
  currentView = 'profile';
  app.innerHTML = '<div class="loading">Loading profile...</div>';

  let identity;

  if (addressParam) {
    // Viewing someone else's profile
    identity = await resolveIdentity(addressParam);
  } else if (userIdentity) {
    // Viewing own profile
    identity = userIdentity;
  } else {
    app.innerHTML = '<div class="empty-state">Connect your wallet to view your profile. <a href="#/">Back</a></div>';
    return;
  }

  // Resolve pfp
  let pfpSrc = '';
  if (identity.pfp) {
    pfpSrc = identity.pfp.startsWith('ipfs://')
      ? identity.pfp.replace('ipfs://', 'https://ipfs.io/ipfs/')
      : identity.pfp;
  }

  // Find all proposals and votes by this user
  const proposals = await listProposals();
  const primaryAddr = identity.primaryAddress.toLowerCase();

  const userProposals = proposals.filter(p =>
    p.proposer.address.toLowerCase() === primaryAddr ||
    (p.proposer.handle && p.proposer.handle === identity.handle)
  );

  // Check votes across all active proposals
  let allocatedTDH = 0;
  let voteHistory = [];

  for (const p of proposals) {
    const votes = await getProposalVotes(p.id);
    for (const v of votes) {
      const voterAddr = (v.voter || '').toLowerCase();
      const submitterAddr = (v.submittedBy || '').toLowerCase();
      if (voterAddr === primaryAddr || submitterAddr === primaryAddr) {
        const currentTDH = identity.tdh;
        if (p.status === 'active') {
          allocatedTDH += currentTDH;
        }
        voteHistory.push({
          proposalId: p.id,
          waveName: p.waveName,
          vote: v.vote,
          status: p.status,
          tdhAtVote: v.voterTDH || v.currentTDH || 0
        });
      }
    }
  }

  const freeTDH = identity.tdh; // TDH is not locked, it's used as weight
  const canPropose = identity.tdh >= CONFIG.MIN_TDH_PROPOSE;

  // 6529 profile link
  const seizeLink = identity.handle
    ? `https://6529.io/${identity.handle}`
    : `https://6529.io/identity/${identity.primaryAddress}`;

  app.innerHTML = `
    <a href="#/" class="back-link">&larr; Back to Dashboard</a>

    <div class="profile-page">
      <!-- Profile Header -->
      <div class="profile-header">
        <div class="profile-pfp-container">
          ${pfpSrc
            ? `<img src="${pfpSrc}" class="profile-pfp" alt="${identity.handle || 'Profile'}">`
            : '<div class="profile-pfp-empty"></div>'
          }
        </div>
        <div class="profile-info">
          <h2 class="profile-name">${identity.handle || shortAddress(identity.primaryAddress)}</h2>
          ${identity.isDelegate ? '<span class="tag-delegate">Connected via delegate wallet</span>' : ''}
          <div class="profile-address">${identity.primaryAddress}</div>
          <a href="${seizeLink}" target="_blank" class="profile-6529-link">View on 6529.io &rarr;</a>
        </div>
      </div>

      <!-- Stats Grid -->
      <div class="profile-stats">
        <div class="profile-stat">
          <div class="profile-stat-value">${formatTDH(identity.tdh)}</div>
          <div class="profile-stat-label">Total TDH</div>
        </div>
        <div class="profile-stat">
          <div class="profile-stat-value">${identity.level}</div>
          <div class="profile-stat-label">Level</div>
        </div>
        <div class="profile-stat">
          <div class="profile-stat-value">${formatTDH(identity.rep)}</div>
          <div class="profile-stat-label">Rep</div>
        </div>
        <div class="profile-stat">
          <div class="profile-stat-value">${formatTDH(identity.cic)}</div>
          <div class="profile-stat-label">CIC</div>
        </div>
      </div>

      <!-- Governance Stats -->
      <div class="profile-section">
        <h3>Governance Activity</h3>
        <div class="profile-stats">
          <div class="profile-stat">
            <div class="profile-stat-value">${voteHistory.length}</div>
            <div class="profile-stat-label">Votes Cast</div>
          </div>
          <div class="profile-stat">
            <div class="profile-stat-value">${userProposals.length}</div>
            <div class="profile-stat-label">Proposals Created</div>
          </div>
          <div class="profile-stat">
            <div class="profile-stat-value">${formatTDH(allocatedTDH)}</div>
            <div class="profile-stat-label">TDH on Active Votes</div>
          </div>
          <div class="profile-stat">
            <div class="profile-stat-value">${canPropose ? 'Yes' : 'No'}</div>
            <div class="profile-stat-label">Can Propose (1M+)</div>
          </div>
        </div>
      </div>

      <!-- Consolidation -->
      ${identity.consolidationWallets.length > 1 ? `
        <div class="profile-section">
          <h3>Consolidated Wallets</h3>
          <div class="wallet-list">
            ${identity.consolidationWallets.map(w => `
              <div class="wallet-item">
                <span class="wallet-addr">${w}</span>
                ${w.toLowerCase() === identity.primaryAddress.toLowerCase() ? '<span class="tag-primary">Primary</span>' : ''}
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- User Proposals -->
      ${userProposals.length > 0 ? `
        <div class="profile-section">
          <h3>My Proposals</h3>
          <div class="proposals-grid">
            ${userProposals.map(p => renderProposalCard(p)).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Vote History -->
      ${voteHistory.length > 0 ? `
        <div class="profile-section">
          <h3>Vote History</h3>
          <div class="vote-history">
            ${voteHistory.map(v => `
              <div class="vote-history-item">
                <span class="vote-badge vote-${v.vote}">${v.vote === 'yes' ? '+ Positive' : '- Negative'}</span>
                <a href="#/proposal/${v.proposalId}" class="vote-history-wave">${v.waveName}</a>
                <span class="vote-history-tdh">${formatTDH(v.tdhAtVote)} TDH</span>
                <span class="proposal-status status-${v.status}">${v.status.toUpperCase()}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

// === REQUESTS (generic text + TDH vote) ===
async function renderRequests() {
  currentView = 'requests';
  app.innerHTML = '<div class="loading">Loading requests...</div>';

  const proposals = await listProposals();
  const requests = proposals.filter(p => p.action === 'request');
  const active = requests.filter(p => p.status === 'active' && new Date(p.expiresAt) > new Date());
  const past = requests.filter(p => p.status !== 'active' || new Date(p.expiresAt) <= new Date());

  let html = `
    <div class="section-header">
      <h2>Community Requests</h2>
      ${userIdentity && userIdentity.tdh >= CONFIG.MIN_TDH_PROPOSE
        ? '<a href="#/create-request" class="btn btn-primary">+ New Request</a>'
        : ''}
    </div>
    <p class="form-sub">Submit any request — feature ideas, UI changes, anything. Requests reaching ${formatTDH(CONFIG.TDH_THRESHOLD_REQUEST)} TDH get reviewed for production. Below that they stay in queue.</p>
  `;

  if (active.length === 0) {
    html += '<div class="empty-state">No active requests. ';
    if (userIdentity && userIdentity.tdh >= CONFIG.MIN_TDH_PROPOSE) {
      html += '<a href="#/create-request">Submit one</a>';
    }
    html += '</div>';
  } else {
    html += '<div class="proposals-grid">';
    for (const r of active) {
      html += renderRequestCard(r);
    }
    html += '</div>';
  }

  if (past.length > 0) {
    html += '<div class="section-header" style="margin-top:32px"><h2>Past Requests</h2></div>';
    html += '<div class="proposals-grid">';
    for (const r of past) html += renderRequestCard(r);
    html += '</div>';
  }

  app.innerHTML = html;
}

function renderRequestCard(r) {
  const isExpired = new Date(r.expiresAt) < new Date();
  const daysLeft = Math.max(0, Math.ceil((new Date(r.expiresAt) - new Date()) / 86400000));
  const statusClass = r.status === 'active' ? (isExpired ? 'status-expired' : 'status-active') : (r.status === 'passed' ? 'status-passed' : 'status-failed');
  const statusLabel = r.status === 'active' ? (isExpired ? 'EXPIRED' : 'ACTIVE') : r.status.toUpperCase();

  return `
    <a href="#/request/${r.id}" class="proposal-card">
      <div class="proposal-header">
        <span class="proposal-action action-request">Request</span>
        <span class="proposal-status ${statusClass}">${statusLabel}</span>
      </div>
      <div class="proposal-wave">${r.waveName || r.reason?.substring(0, 60) || 'Request'}</div>
      <div class="proposal-reason">${r.reason || ''}</div>
      <div class="proposal-meta">
        <span>by ${r.proposer.handle || shortAddress(r.proposer.address)}</span>
        <span>${r.status === 'active' && !isExpired ? daysLeft + 'd left' : ''}</span>
      </div>
    </a>
  `;
}

async function renderRequestDetail(id) {
  // Reuse proposal detail — requests are stored as proposals with action='request'
  return renderProposalDetail(id);
}

async function renderCreateRequest() {
  currentView = 'create-request';

  if (!userIdentity) {
    app.innerHTML = '<div class="empty-state">Connect your wallet to submit a request. <a href="#/requests">Back</a></div>';
    return;
  }

  const { total: alreadyAllocated } = await getAllocatedTDH(userIdentity.primaryAddress);
  const available = userIdentity.tdh - alreadyAllocated;
  const minAlloc = CONFIG.MIN_TDH_PROPOSE;

  if (available < minAlloc) {
    app.innerHTML = `<div class="empty-state">
      Insufficient TDH budget. Available: ${formatTDH(available)} (need ${formatTDH(minAlloc)}).<br>
      <a href="#/requests">Back</a>
    </div>`;
    return;
  }

  app.innerHTML = `
    <a href="#/requests" class="back-link">&larr; Back to Requests</a>
    <div class="create-form">
      <h2>Submit a Request</h2>
      <p class="form-sub">Any idea, feature, change — write it here. Community votes with TDH. Requests reaching ${formatTDH(CONFIG.TDH_THRESHOLD_REQUEST)} TDH get reviewed.</p>

      <div class="form-group">
        <label>Your Request</label>
        <textarea id="reqText" rows="4" placeholder="e.g. 'Let's change the background color!' or 'Add dark mode'"></textarea>
      </div>

      <div class="form-group">
        <label>TDH to allocate (min ${formatTDH(minAlloc)})</label>
        <div class="tdh-slider-row">
          <input type="range" id="tdhSlider" min="${minAlloc}" max="${available}" value="${minAlloc}" class="tdh-slider">
          <input type="number" id="tdhInput" min="${minAlloc}" max="${available}" value="${minAlloc}" class="tdh-input">
        </div>
        <div class="form-hint">Available: ${formatTDH(available)} TDH</div>
      </div>

      <div class="form-footer">
        <button class="btn btn-primary" id="btnSubmitRequest">Sign & Submit Request</button>
      </div>
      <div id="requestStatus" class="vote-status" style="margin-top:16px"></div>
    </div>
  `;

  const slider = document.getElementById('tdhSlider');
  const input = document.getElementById('tdhInput');
  slider.addEventListener('input', () => { input.value = slider.value; });
  input.addEventListener('input', () => { slider.value = Math.min(Math.max(input.value, minAlloc), available); });

  document.getElementById('btnSubmitRequest').addEventListener('click', async () => {
    const text = document.getElementById('reqText').value.trim();
    if (!text) { showToast('Write your request', 'error'); return; }
    const allocatedTDH = parseInt(document.getElementById('tdhInput').value);
    if (allocatedTDH < minAlloc) { showToast(`Minimum ${formatTDH(minAlloc)} TDH`, 'error'); return; }

    const btn = document.getElementById('btnSubmitRequest');
    const statusEl = document.getElementById('requestStatus');
    btn.disabled = true;
    btn.textContent = 'Signing...';
    if (statusEl) statusEl.innerHTML = '<span class="status-pending">Signing request with wallet...</span>';

    try {
      const result = await createProposal('request', 'generic-request', text, allocatedTDH);
      showToast('Request submitted!', 'success');
      invalidateCache();
      window.location.hash = '#/requests';
      route();
    } catch (err) {
      if (statusEl) statusEl.innerHTML = `<span class="status-error">${err.message}</span>`;
      btn.disabled = false;
      btn.textContent = 'Sign & Submit Request';
      showToast(err.message, 'error');
    }
  });
}

// === TOAST ===
function showToast(message, type = 'info') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

// === ALERT BANNER ===
async function updateAlertBanner() {
  try {
    const proposals = await listProposals();
    const active = proposals.filter(p => p.status === 'active' && new Date(p.expiresAt) > new Date());
    const banner = document.getElementById('alertBanner');

    if (active.length > 0 && banner) {
      const nearest = active.reduce((a, b) =>
        new Date(a.expiresAt) < new Date(b.expiresAt) ? a : b
      );
      const daysLeft = Math.max(0, Math.ceil((new Date(nearest.expiresAt) - new Date()) / 86400000));

      banner.style.display = 'flex';
      banner.innerHTML = `
        <span class="alert-dot"></span>
        ${active.length} active proposal${active.length > 1 ? 's' : ''} need${active.length === 1 ? 's' : ''} your vote!
        Nearest deadline: ${daysLeft} day${daysLeft !== 1 ? 's' : ''} left.
        <a href="#/">Vote now</a>
      `;
    }
  } catch (e) {}
}

// === INIT ===
(async () => {
  const reconnected = await tryReconnect();
  if (reconnected) {
    userIdentity = await resolveIdentity(reconnected);
  }
  renderUserArea();
  route();
  updateAlertBanner();
})();
