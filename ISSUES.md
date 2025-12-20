# Watermelon Snap - Issues Tracker

## CRITICAL

- [x] **1. Deploy script mismatch** (`scripts/deploy.ts:23,34`) - FIXED in f54c3ed

## HIGH

- [x] **2. Missing error state styling** (`frontend/components/Game.tsx:156-159`) - FIXED in 78bab59

## MEDIUM

- [x] **3. Unsafe enum casting** (`frontend/hooks/useWatermelonGame.ts:124`) - FIXED in e6bba81
- [x] **4. Race condition risk** - FIXED in cb8c939 (added isValidatingGame flag)
- [x] **5. Score overflow edge case** - FIXED in dd34300 (added defensive check)

## LOW

- [x] **6. Contract address hardcoded** - FIXED in a7c5b17 (uses NEXT_PUBLIC_CONTRACT_ADDRESS)
- [x] **7. Missing edge case tests** - FIXED (5 new tests: VRF, leaderboard, season)
- [x] **8. Stale mock contract** - REMOVED (tests use MockEntropy instead)
- [x] **9. Unused economics scripts** - SKIPPED (untracked files - user can delete manually)

## Code Quality

- [x] **10. Error message truncation** - FIXED (increased to 100 chars)
- [x] **11. Loading states not distinguished** - FIXED (distinct messages per phase)
- [x] **12. Demo/Live mode confusion** - FIXED (added colored badge indicator)

---

# Future Improvements

## UX/Gameplay

| Issue | Impact | Complexity | Status |
|-------|--------|------------|--------|
| VRF wait time (5-30s before playing) | Frustrating delay | Low | TODO: Add loading animation |
| No game history UI | Can't review past games | Low | DONE: /history page |
| Session key popup friction | Extra step for users | Low | Open |
| Can cash out at 0 bands (score=0) | Pointless action allowed | Low | Open |

## Economic/Competitive

| Issue | Impact | Complexity | Status |
|-------|--------|------------|--------|
| Whale advantage | More games = more lucky threshold chances | N/A | Design tradeoff |
| 24h seasons | Short competition window | Low | Open |
| Manual prize distribution | Trust required, operational burden | Medium | DONE: Auto-distribution |
| No minimum players per season | Season could have 1 player | Low | Open |
| Late-season sniping | Players wait to check if worth playing | N/A | Design tradeoff |

## Technical

| Issue | Impact | Complexity | Status |
|-------|--------|------------|--------|
| Unbounded `playerGames[]` array | Gas grows for heavy players | Low | Mitigated (paginated) |
| No pause mechanism | Can't stop contract if bug found | Medium | DONE: pause()/unpause() |
| No contract upgrade path | Stuck with current logic | High | Accepted |
| Threshold=1 instant death | 6.7% chance of zero-score game | N/A | Design decision |

## Quick Wins

- [ ] Add VRF loading animation with progress indicator
- [ ] Disable 0-band cashout in contract
- [ ] Add "Add 5 bands" button to reduce transactions
- [ ] Show estimated prize share based on pool and rank
- [ ] Auto-refresh leaderboard during active season
- [ ] Add sound effects (band stretch, explosion)

## Bigger Improvements

- [ ] Batch band additions: `addBands(gameId, count)`
- [x] Auto prize distribution on first game of new season - DONE
- [ ] Configurable season duration (weekly option)
- [ ] Achievement/badge system for milestones
- [ ] Game replay/share functionality

## Accepted Tradeoffs

1. **Threshold 1-15 uniform distribution** - 6.7% instant death accepted for game tension
2. **Whale advantage** - Inherent to pay-to-play leaderboard model
3. **No safe zone** - Would allow risk-free point farming
4. **No upgrade path** - Simplicity over flexibility, pause handles emergencies

## Game Parameters

| Parameter | Value |
|-----------|-------|
| Threshold range | 1-15 |
| Max bands | 14 |
| Multiplier rate | 15% per band |
| Max score | ~9,906 |
| Season duration | 24 hours |
| Prize pool share | 90% of entry fees |
| Caller reward | 1% of pool |

## Entry Fees

| Network | Entry Fee |
|---------|-----------|
| Testnet | 0.01 MON |
| Mainnet | 10 MON |

## Prize Distribution

| Rank | Share |
|------|-------|
| 1st | 40% |
| 2nd | 25% |
| 3rd | 15% |
| 4th | 8% |
| 5th | 5% |
| 6th-10th | 1.4% each |

*Remaining shares go to last winner if fewer than 10 players.*
