# Remaining Issues - Watermelon Game

Issues identified during analysis that require contract updates or additional work.

## Critical - Contract Updates Required

### C1: VRF Callback Validation - FIXED
**Severity**: Critical
**File**: `contracts/WatermelonSnapSolo.sol` (entropyCallback function)

**Issue**: The `entropyCallback` function didn't validate that `gameId` is non-zero before accessing `soloGames[gameId]`. If a callback arrives with unknown `sequenceNumber`, it could access uninitialized storage.

**Status**: Fixed - added `if (gameId == 0) return;` check to silently ignore invalid callbacks.

---

### C2: Prize Pool Accounting - NOT A BUG
**Severity**: N/A (already correct)
**File**: `contracts/WatermelonSnapSolo.sol` (cancelStaleGame function)

**Analysis**: Upon code review, the implementation correctly uses `seasonPrizePool[game.season]` (not `currentSeasonPrizePool`), so refunds are deducted from the correct season's pool. No fix needed.

---

## High Priority - Contract Updates Required

### H1: Leaderboard Gas Bomb - NOT AN ISSUE
**Severity**: N/A
**File**: `contracts/WatermelonSnapSolo.sol`

**Analysis**: Leaderboard is capped at LEADERBOARD_SIZE (10 entries). All operations are O(10) which is constant gas. Not a real issue.

---

### H2: Prize Distribution Griefing - FIXED
**Severity**: High
**File**: `contracts/WatermelonSnapSolo.sol`

**Issue**: If any winner's address is a contract that reverts on receive, the entire distribution fails.

**Status**: Fixed with hybrid push/pull pattern:
- Try direct transfer first (instant payout for normal wallets)
- If transfer fails, fallback to `pendingPrizes` mapping
- Added `claimPrize()` function for failed transfers only
- 99% of users get instant payouts, no extra step needed

---

### H3: Nonce Conflicts with Multiple Tabs - FIXED
**Severity**: High
**File**: `frontend/hooks/useBurnerWallet.ts`

**Issue**: If user has multiple browser tabs open, nonce conflicts can occur.

**Status**: Fixed with:
- BroadcastChannel API to detect other tabs
- Transaction locking via localStorage
- Warning shown in UI when multiple tabs detected
- Lock acquisition required before any burner transaction

---

## Medium Priority

### M1: Operator Authorization Centralization - FIXED
**Severity**: Medium
**File**: `contracts/WatermelonSnapSolo.sol`

**Issue**: If operator key is compromised, attacker can drain burner funds.

**Status**: Fixed with:
- Added `operatorAllowance` mapping to limit spending
- Added `setOperatorAllowance(uint256)` function
- `startGameFor` checks and deducts from allowance (0 = unlimited for backwards compat)
- Allowance cleared when operator is revoked

---

### M2: Front-Running on Cash Out
**Severity**: Medium
**File**: `contracts/WatermelonGame.sol`

**Issue**: Player's `cashOut` transaction can be observed in mempool. MEV bots could theoretically manipulate gas prices or ordering, though impact is limited on Monad.

**Note**: Low practical risk on Monad testnet.

---

### M3: Private Key in localStorage - MITIGATED
**Severity**: Medium
**File**: `frontend/hooks/useBurnerWallet.ts`

**Issue**: Burner wallet private key stored in localStorage is accessible to any JS on the domain (XSS vulnerability).

**Status**: Partially mitigated with:
- Added max safe balance warning (3 MON) - prompts user to withdraw excess
- UI warning when balance exceeds safe threshold
- Note: Full fix would require WebCrypto/secure enclave which is out of scope

---

### M4: Operator Can Grief Player
**Severity**: Medium
**File**: `contracts/WatermelonGame.sol`

**Issue**: Authorized operator can start games on behalf of player without their explicit consent per-game. Malicious operator could drain player's contract balance.

**Note**: Current UX has same user control burner, so risk is limited to key theft.

---

## Game Economics Concerns

### E1: Whale Advantage
**Issue**: Players with more capital can play more games, increasing chance of high score. Top 10 leaderboard rewards volume over skill.

**Consider**: Cap games per address per season, or use quadratic scoring.

---

### E2: Late-Season Sniping - MITIGATED
**Issue**: Players can wait until season end, see current leaderboard, and only play if they can likely place.

**Status**: Mitigated by hiding full leaderboard:
- Users only see their own rank and score
- Other players' scores are hidden
- Shows "X players competing" but not their scores
- Prevents calculating exact score needed to place

---

### E3: Sybil Resistance
**Issue**: Single entity can create multiple addresses to claim multiple leaderboard spots.

**Consider**: Minimum stake requirement, or reputation system.

---

## Completed Fixes

### Frontend
- [x] **FC1**: Burner wallet race condition - using fresh values from `refreshStatus()`
- [x] **FH2**: VRF polling timeout - stops after 5 minutes with user notification
- [x] **Payout calculation** - verified correct, last winner gets remainder

### Contract (not deployed yet)
- [x] **C1**: VRF callback validation - added gameId == 0 check
- [x] **C2**: Prize pool accounting - verified already correct
- [x] **H1**: Leaderboard gas - verified O(10) constant, not an issue
- [x] **H2**: Prize distribution griefing - implemented pull pattern with `claimPrize()`
- [x] **M1**: Operator spending limits - added `operatorAllowance` and `setOperatorAllowance()`

### Frontend
- [x] **H3**: Nonce conflicts - BroadcastChannel + localStorage locking
- [x] **M3**: Security warnings - excessive balance and multi-tab warnings
- [x] **E2**: Late-season sniping - hidden leaderboard, show only user's rank

---

## Deployment Notes

Contract is deployed at: `0x69862066268503d92b0eE0c6deCa2d8aAC40f7Bc`

When ready to update contract:
1. Deploy new contract with C1 fix (H2 pull pattern optional)
2. Update `CONTRACT_ADDRESS` in `frontend/lib/contract.ts`
3. Update ABI if function signatures change
4. Migrate any necessary state (current season, etc.)

---

*Generated: 2024-12-22*
