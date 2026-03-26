# 6529 NEWS — Governance Guide

## What is 6529 NEWS Governance?

A decentralized governance system where the 6529 community uses their TDH to vote on proposals. No GitHub account needed — just connect your wallet.

## How It Works

### Creating a Proposal
1. Connect your wallet (supports delegate wallets)
2. Click **"+ New Proposal"**
3. Choose a category:
   - **General Request** — any idea, feature, or change
   - **Graphics** — visual/UI changes
   - **Governance Protocol** — changes to governance rules
4. Write a description
5. Allocate TDH (minimum **1M TDH** to create)
6. Sign with your wallet — done!

### Voting on Proposals
- Any wallet holder can vote YES or NO
- Allocate any amount of your available TDH
- Your TDH is your voting weight

### TDH Budget
- Your total TDH is split across all active proposals/votes
- If you have 2.3M TDH and allocate 1M to a proposal, you have 1.3M left for other votes
- The proposer's allocated TDH counts as a YES vote toward the threshold

### Thresholds
| Action | TDH Required |
|--------|-------------|
| Create a proposal | 1,000,000 (1M) minimum |
| Vote on a proposal | Any amount |
| Proposal approved | 30,000,000 (30M) total YES TDH |

### Proposal Lifecycle
1. **Active** — open for voting (10 days)
2. **Approved** — reached 30M TDH → queued for implementation
3. **Expired** — didn't reach threshold in time
4. **Deleted** — withdrawn by the proposer

### Categories
| Category | Color | Use |
|----------|-------|-----|
| General Request | 🔵 Blue | Any idea or feature request |
| Graphics | 🟣 Purple | Visual/UI changes |
| Governance Protocol | 🟢 Cyan | Changes to governance rules |

## Technical Details

### How Proposals Are Stored
- All proposals are GitHub Issues on the [6529news_gov](https://github.com/6529news/6529news_gov) public repo
- Each proposal includes a digital signature (EIP-712) and timestamp
- Votes are also GitHub Issues with signatures
- Everything is transparent and verifiable

### Wallet Support
- MetaMask, Rabby, and any EIP-1193 wallet
- Follows the 6529 delegate system — a hot wallet connected as delegate is enough
- TDH is read from your primary wallet via 6529.io API

### Security
- **No tokens stored in frontend** — proposals submitted via Cloudflare Worker proxy
- **Digital signatures** — every proposal and vote is signed with EIP-712
- **1M TDH minimum** — prevents spam
- **Public audit trail** — all issues visible on GitHub

## Links
- **News Card**: [6529news.github.io/6529news_engine](https://6529news.github.io/6529news_engine/)
- **Governance**: [6529news.github.io/6529news_gov](https://6529news.github.io/6529news_gov/)
- **GitHub Issues**: [github.com/6529news/6529news_gov/issues](https://github.com/6529news/6529news_gov/issues)

---

*6529 NEWS — Decentralized News Powered by TDH*
