# Watermelon Snap Deployment Guide

Complete guide for deploying Watermelon Snap to Monad Testnet and Mainnet.

## Prerequisites

- Node.js v18+
- npm or yarn
- Git
- Wallet with MON tokens (testnet or mainnet)

## 1. Clone & Install

```bash
git clone <your-repo-url>
cd watermelon
npm install
cd frontend && npm install && cd ..
```

## 2. Environment Setup

### Root `.env` (Contract Deployment)

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Testnet
MONAD_TESTNET_RPC=https://testnet-rpc.monad.xyz
PRIVATE_KEY=your_deployer_private_key_here

# Mainnet (when ready)
MONAD_RPC=https://rpc.monad.xyz

# Pyth Entropy (VRF)
ENTROPY_ADDRESS=0x36825bf3Fbdf5a29E2d5148bfe7Dcf7B5639e320
ENTROPY_PROVIDER=0x6CC14824Ea2918f5De5C2f75A9Da968ad4BD6344
```

### Frontend `.env.local`

```bash
cd frontend
cp .env.example .env.local
```

Edit `frontend/.env.local`:

```env
# Will be updated after deployment
NEXT_PUBLIC_CONTRACT_ADDRESS=
NEXT_PUBLIC_SESSION_MANAGER_ADDRESS=

# Privy (get from https://dashboard.privy.io)
NEXT_PUBLIC_PRIVY_APP_ID=your_privy_app_id
```

---

## 3. Testnet Deployment

### Step 1: Get Testnet MON

1. Go to [Monad Testnet Faucet](https://faucet.monad.xyz)
2. Connect wallet and request testnet MON
3. You need ~1 MON for deployment + initial prize pool

### Step 2: Compile Contracts

```bash
npx hardhat compile
```

### Step 3: Run Tests

```bash
npx hardhat test
```

All tests should pass before deployment.

### Step 4: Deploy Game Contract

```bash
npx hardhat run scripts/deploy.ts --network monadTestnet
```

Output:
```
Deploying WatermelonSnapSolo...
WatermelonSnapSolo deployed to: 0x...
```

**Save this address!**

### Step 5: Deploy Session Key Manager (Optional - for EIP-7702)

```bash
npx hardhat run scripts/deploySessionManager.ts --network monadTestnet
```

Output:
```
SessionKeyManager deployed to: 0x...
```

**Save this address!**

### Step 6: Fund Prize Pool

```bash
CONTRACT_ADDRESS=0x...your_game_contract... AMOUNT=1 npx hardhat run scripts/sponsorPool.ts --network monadTestnet
```

Or manually via cast:
```bash
cast send <CONTRACT_ADDRESS> "sponsorPrizePool()" --value 1ether --private-key $PRIVATE_KEY --rpc-url https://testnet-rpc.monad.xyz
```

### Step 7: Configure Frontend

Edit `frontend/.env.local`:

```env
NEXT_PUBLIC_CONTRACT_ADDRESS=0x...your_game_contract...
NEXT_PUBLIC_SESSION_MANAGER_ADDRESS=0x...your_session_manager...
NEXT_PUBLIC_PRIVY_APP_ID=your_privy_app_id
```

### Step 8: Build & Test Frontend

```bash
cd frontend
npm run build
npm run dev
```

Open http://localhost:3000 and test:
- [ ] Wallet connection works
- [ ] Can start a game (pays entry fee + VRF fee)
- [ ] VRF callback arrives (game becomes ACTIVE)
- [ ] Can add bands
- [ ] Can cash out / explode
- [ ] Leaderboard updates
- [ ] Session keys work (if deployed)

### Step 9: Deploy Frontend

**Vercel (Recommended):**
```bash
npm i -g vercel
cd frontend
vercel --prod
```

Add environment variables in Vercel dashboard:
- `NEXT_PUBLIC_CONTRACT_ADDRESS`
- `NEXT_PUBLIC_SESSION_MANAGER_ADDRESS`
- `NEXT_PUBLIC_PRIVY_APP_ID`

**Or self-hosted:**
```bash
cd frontend
npm run build
npm run start
```

---

## 4. Mainnet Deployment

### Pre-Mainnet Checklist

- [ ] All tests passing
- [ ] Testnet deployment verified working
- [ ] Contract audited (recommended)
- [ ] Prize pool funding strategy decided
- [ ] Admin keys secured (hardware wallet recommended)
- [ ] Monitoring/alerting setup

### Step 1: Update Environment

Edit `.env`:
```env
MONAD_RPC=https://rpc.monad.xyz
PRIVATE_KEY=your_mainnet_deployer_key

# Mainnet Pyth Entropy (verify addresses on docs.pyth.network)
ENTROPY_ADDRESS=0x...mainnet_entropy...
ENTROPY_PROVIDER=0x...mainnet_provider...
```

### Step 2: Deploy Contracts

```bash
# Game contract
npx hardhat run scripts/deploy.ts --network monad

# Session manager (optional)
npx hardhat run scripts/deploySessionManager.ts --network monad
```

### Step 3: Verify Contracts (if explorer supports)

```bash
npx hardhat verify --network monad <CONTRACT_ADDRESS> <ENTROPY_ADDRESS> <ENTROPY_PROVIDER>
```

### Step 4: Fund Prize Pool

```bash
CONTRACT_ADDRESS=0x...mainnet_game_contract... AMOUNT=10 npx hardhat run scripts/sponsorPool.ts --network monad
```

### Step 5: Update Frontend for Mainnet

Create `frontend/.env.production`:
```env
NEXT_PUBLIC_CONTRACT_ADDRESS=0x...mainnet_game_contract...
NEXT_PUBLIC_SESSION_MANAGER_ADDRESS=0x...mainnet_session_manager...
NEXT_PUBLIC_PRIVY_APP_ID=your_privy_app_id
```

Update `frontend/lib/contract.ts` if needed for mainnet chain config.

### Step 6: Deploy Frontend to Production

```bash
cd frontend
vercel --prod
```

---

## 5. Contract Addresses Reference

### Testnet (Chain ID: 10143)

| Contract | Address |
|----------|---------|
| WatermelonSnapSolo | `0xC9b820C2437eFEa3CDE50Df75C3d8D9E6c5DBDf7` |
| SessionKeyManager | `<your_deployed_address>` |
| Pyth Entropy | `0x36825bf3Fbdf5a29E2d5148bfe7Dcf7B5639e320` |

### Mainnet (Chain ID: 143)

| Contract | Address |
|----------|---------|
| WatermelonSnapSolo | `0x91d125B5d8BA84eB1FFf67e1A901a24F21962340` |
| SessionKeyManager | `0x7003Eef4D1711B3bD909fa53a6D52AdeEF9A1df5` |
| Pyth Entropy | `0xD458261E832415CFd3BAE5E416FdF3230ce6F134` |
| Entropy Provider | `0x52DeaA1c84233F7bb8C8A45baeDE41091c616506` |

---

## 6. Admin Operations

### Check Season Info

```bash
cast call <CONTRACT> "getSeasonInfo()" --rpc-url https://testnet-rpc.monad.xyz
```

### Check Prize Pool

```bash
cast call <CONTRACT> "prizePool()" --rpc-url https://testnet-rpc.monad.xyz
```

### Sponsor Prize Pool

```bash
cast send <CONTRACT> "sponsorPrizePool()" --value 10ether --private-key $PRIVATE_KEY --rpc-url https://testnet-rpc.monad.xyz
```

### End Season & Distribute Prizes

```bash
cast send <CONTRACT> "endSeason()" --private-key $PRIVATE_KEY --rpc-url https://testnet-rpc.monad.xyz
```

### Emergency: Pause (if implemented)

```bash
cast send <CONTRACT> "pause()" --private-key $PRIVATE_KEY --rpc-url https://testnet-rpc.monad.xyz
```

---

## 7. Monitoring

### Key Metrics to Track

1. **Game Activity**
   - Games started per hour
   - Average bands per game
   - Explosion rate

2. **Economics**
   - Prize pool balance
   - Entry fees collected
   - VRF costs

3. **VRF Health**
   - Callback success rate
   - Average callback time
   - Stale game rate

### Event Monitoring

Watch for events:
```bash
cast logs --address <CONTRACT> --rpc-url https://testnet-rpc.monad.xyz
```

Key events:
- `SoloGameStarted` - New game created
- `SoloGameReady` - VRF fulfilled
- `SoloScored` - Player cashed out
- `SoloExploded` - Player lost
- `SoloGameCancelled` - Stale game refunded

---

## 8. Troubleshooting

### "VRF not responding"

1. Check Pyth Entropy provider status
2. Verify VRF fee is sufficient
3. After 1 hour, games can be cancelled for refund

### "Transaction reverted"

1. Check wallet has enough MON for gas
2. Verify contract address is correct
3. Check game state (can't add band to finished game)

### "Session key not working"

1. Ensure `SESSION_MANAGER_ADDRESS` is set in env
2. Check wallet supports EIP-7702
3. Session expires after 1 hour - restart game

### "Frontend not connecting"

1. Verify Privy App ID is correct
2. Check network is Monad Testnet (Chain ID: 10143)
3. Clear browser cache/localStorage

---

## 9. Security Considerations

### For Mainnet

1. **Use Hardware Wallet** for deployer/admin keys
2. **Multi-sig** for prize pool management (consider Gnosis Safe)
3. **Rate Limiting** - Monitor for abuse patterns
4. **Audit** - Get professional audit before mainnet
5. **Bug Bounty** - Consider running a bug bounty program
6. **Gradual Rollout** - Start with small prize pool

### Key Risks

| Risk | Mitigation |
|------|------------|
| VRF manipulation | Using Pyth Entropy (trusted provider) |
| Front-running | Threshold determined by VRF after game start |
| Reentrancy | ReentrancyGuard on all state-changing functions |
| Integer overflow | Solidity 0.8+ built-in checks |
| Stale games | 1-hour timeout with refund mechanism |

---

## 10. Quick Reference

### Testnet Deploy (One-liner)

```bash
npx hardhat compile && npx hardhat test && npx hardhat run scripts/deploy.ts --network monadTestnet && npx hardhat run scripts/deploySessionManager.ts --network monadTestnet
```

### Check Deployment

```bash
# Game contract
cast call <GAME_ADDRESS> "getSeasonInfo()" --rpc-url https://testnet-rpc.monad.xyz

# Session manager
cast call <SESSION_ADDRESS> "MAX_SESSION_DURATION()" --rpc-url https://testnet-rpc.monad.xyz
```

### URLs

- Monad Testnet RPC: `https://testnet-rpc.monad.xyz`
- Monad Mainnet RPC: `https://rpc.monad.xyz`
- Monad Explorer: `https://testnet.monadexplorer.com`
- Pyth Entropy Docs: `https://docs.pyth.network/entropy`
- Privy Dashboard: `https://dashboard.privy.io`

---

*Last updated: December 2024*
