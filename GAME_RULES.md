# Watermelon Snap Solo - Game Rules

## Overview

A "Press Your Luck" arcade game where you add rubber bands to a watermelon until you cash out or it explodes. Compete for the highest score on the seasonal leaderboard to win prizes from the pool.

## How to Play

1. **Start Game** - Pay entry fee (0.01 MON testnet / 10 MON mainnet)
2. **VRF generates hidden threshold** - Random number 1-15 determines explosion point
3. **Add bands** - Each band increases your multiplier and potential score
4. **Cash out** - Lock in your score before explosion
5. **Explode** - If bands reach threshold, score = 0

## Scoring System

**Score Formula:** `score = bands × multiplier / 100`

**Multiplier:** 15% exponential growth per band (`1.15^bands`)

| Bands | Multiplier | Score |
|-------|------------|-------|
| 1 | 1.15x | 115 |
| 3 | 1.52x | 456 |
| 5 | 2.01x | 1,006 |
| 7 | 2.66x | 1,862 |
| 10 | 4.05x | 4,046 |
| 12 | 5.35x | 6,419 |
| 14 | 7.08x | 9,906 |

## Survival Probability

Threshold is uniformly distributed 1-15:

| Bands | Survival Chance |
|-------|-----------------|
| 1 | 93.3% (14/15) |
| 3 | 80.0% (12/15) |
| 5 | 66.7% (10/15) |
| 7 | 53.3% (8/15) |
| 10 | 33.3% (5/15) |
| 12 | 20.0% (3/15) |
| 14 | 6.7% (1/15) |

## Seasons & Prizes

- **Season duration:** 24 hours
- **Entry fee split:** 90% prize pool, 10% protocol
- **Leaderboard:** Top 10 scores per season
- **Prizes:** Distributed from pool to top players after season ends

Only your **best score** counts for the leaderboard. Playing multiple games lets you try for a higher score.

## Example Scenarios

### High Score Attempt
- Entry: 0.01 MON
- Hidden threshold: 14
- You add 10 bands safely (score = 4,046)
- You push to 12 bands (score = 6,419)
- You cash out
- **Result:** 6,419 points on leaderboard

### Explosion
- Entry: 0.01 MON
- Hidden threshold: 8
- You add 8 bands
- **BOOM!** Watermelon explodes
- **Result:** 0 points, entry lost

### Worst Case
- Hidden threshold: 1
- First band triggers explosion
- 6.7% chance of this happening

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
| Entry Fee | 0.01 MON (testnet) / 10 MON (mainnet) |
| Prize Pool | 90% of all entry fees |
| Protocol Fee | 10% of entry fees |
| Max Score | ~9,906 (14 bands) |
| Max Bands | 14 (threshold 1-15) |
| Season Length | 24 hours |
| Leaderboard Size | Top 10 |
