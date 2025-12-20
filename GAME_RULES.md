# Watermelon Snap Solo - Game Rules

## Overview

A "Press Your Luck" arcade game where you add rubber bands to a watermelon until you cash out or it explodes. Compete for the highest score on the seasonal leaderboard to win prizes from the pool.

## How to Play

1. **Start Game** - Pay entry fee (0.01 MON testnet / 1 MON mainnet)
2. **VRF generates hidden threshold** - Random number 1-50 determines explosion point
3. **Add bands** - Each band increases your multiplier and potential score
4. **Cash out** - Lock in your score before explosion
5. **Explode** - If bands reach threshold, score = 0

## Scoring System

**Score Formula:** `score = bands × multiplier / 100`

**Multiplier:** 2.5% exponential growth per band (`1.025^bands`)

| Bands | Multiplier | Score |
|-------|------------|-------|
| 1 | 1.025x | 1 |
| 5 | 1.13x | 56 |
| 10 | 1.28x | 128 |
| 15 | 1.45x | 217 |
| 20 | 1.64x | 328 |
| 25 | 1.85x | 463 |
| 30 | 2.10x | 630 |
| 40 | 2.69x | 1,974 |
| 49 | 3.35x | 16,415 |

## Survival Probability

Threshold is uniformly distributed 1-50:

| Bands | Survival Chance |
|-------|-----------------|
| 1 | 98% (49/50) |
| 5 | 90% (45/50) |
| 10 | 80% (40/50) |
| 20 | 60% (30/50) |
| 30 | 40% (20/50) |
| 40 | 20% (10/50) |
| 49 | 2% (1/50) |

## Seasons & Prizes

- **Season duration:** 24 hours
- **Entry fee split:** 90% prize pool, 10% protocol
- **Leaderboard:** Top 10 scores per season
- **Prizes:** Distributed from pool to top players after season ends

Only your **best score** counts for the leaderboard. Playing multiple games lets you try for a higher score.

## Example Scenarios

### High Score Attempt
- Entry: 0.01 MON
- Hidden threshold: 35
- You add 30 bands safely (score = 630)
- You push to 34 bands (score = 875)
- You cash out
- **Result:** 875 points on leaderboard

### Explosion
- Entry: 0.01 MON
- Hidden threshold: 12
- You add 12 bands
- **BOOM!** Watermelon explodes
- **Result:** 0 points, entry lost

### Worst Case
- Hidden threshold: 1
- First band triggers explosion
- 2% chance of this happening

## Strategy

- **Safe play:** Cash out early, get low but guaranteed score
- **Risk play:** Push for high bands, higher score but more explosion risk
- **Optimal:** Balance risk vs reward based on current leaderboard standings

To win prizes, you need a top 10 score. Check the leaderboard and decide if you need to take risks.

## Provably Fair

1. Threshold is determined by Pyth Entropy VRF **before** you play
2. Hidden until game ends (cash out or explosion)
3. Revealed on-chain after game concludes
4. Fully verifiable randomness

## Smart Contract

- **Network:** Monad Testnet (Chain ID: 10143)
- **Entry Fee:** 0.01 MON (testnet) / 1 MON (mainnet)
- **VRF Provider:** Pyth Entropy

## Contract Functions

| Function | Description |
|----------|-------------|
| `startGame()` | Start a new game (send entry fee + VRF fee) |
| `addBand(gameId)` | Add one rubber band |
| `cashOut(gameId)` | Record your score |
| `getGameState(gameId)` | View game status |
| `getGameCost()` | Get entry fee + VRF fee |
| `getLeaderboard(season)` | View top 10 scores |
| `getSeasonInfo()` | Current season details |

## Economics Summary

| Metric | Value |
|--------|-------|
| Entry Fee | 0.01 MON (testnet) / 1 MON (mainnet) |
| Prize Pool | 90% of all entry fees |
| Protocol Fee | 10% of entry fees |
| Max Score | ~16,415 (49 bands) |
| Season Length | 24 hours |
| Leaderboard Size | Top 10 |
