# 🍉 Watermelon Snap — Project Brief

## Overview

A multiplayer blockchain game where players take turns placing rubber bands on a watermelon until it explodes. The explosion point is determined by VRF (Verifiable Random Function), making the game provably fair.

**Target Platform:** Monad blockchain (EVM-compatible, 10k TPS, 0.4s blocks)
**Mission:** Monad Foundation's "Mission X: Verifiably Fair" grant program
**VRF Provider:** Pyth Entropy or Switchboard

---

## Game Modes

### Mode A: Multiplayer (2-8 players)

1. Players join a room, each pays entry fee
2. VRF determines hidden "snap threshold" (e.g., 47-156 rubber bands)
3. Players take turns adding 1, 2, or 3 rubber bands
4. Player who adds the fatal rubber band (crosses threshold) loses
5. Watermelon explodes, winners split the prize pool
6. Threshold is revealed on-chain for verification

### Mode B: Solo — "Press Your Luck" 🎰

Single-player mode where you play against the watermelon itself.

**Core Loop:**
1. Pay entry fee (or free-to-play with points)
2. VRF determines hidden threshold (30-100 bands)
3. You add bands one at a time
4. Each successful band increases your multiplier: 1.1x → 1.2x → 1.5x → 2x → 3x → ...
5. At any moment: **[Cash Out]** or **[Add Band]**
6. Cash out = lock in your winnings (entry × multiplier)
7. Explode = lose everything for this round

**Multiplier Curve (example):**
```
Bands    Multiplier
1-10     1.0x - 1.2x
11-20    1.2x - 1.5x  
21-30    1.5x - 2.0x
31-40    2.0x - 3.0x
41-50    3.0x - 5.0x
51-60    5.0x - 10x
61-70    10x - 25x
71+      25x - 100x (危険!)
```

**Why it works:**
- Classic "Crash game" psychology but with physical metaphor
- VRF threshold is committed before you start — provably fair
- You see the multiplier climbing, tension builds
- "One more band" addiction loop
- Threshold reveal after round shows you could've gone further (or were lucky to stop)

**Skill Illusion:**
- "Reading" the watermelon's stress level
- Pattern recognition (false — but feels real)
- Bankroll management across sessions
- Knowing when to walk away

### Mode C: Solo — "Prediction" 🎯

Guess the exact threshold or get as close as possible.

**Core Loop:**
1. VRF generates threshold (1-100)
2. You submit your prediction
3. Threshold revealed
4. Score = 100 - |prediction - actual|
5. Daily leaderboard: highest scores win prize pool

**Variations:**
- **Binary mode:** Over/Under a shown number
- **Range mode:** Pick a range (smaller range = higher payout)
- **Hot/Cold hints:** After wrong guess, told if threshold is higher/lower (costs points)

### Mode D: Daily Challenge 📅

Everyone plays the same VRF seed for 24 hours.

**Core Loop:**
1. One global threshold per day (revealed at end of day)
2. Unlimited attempts (or N free attempts)
3. Your score = bands added before cashing out
4. If you explode = 0 for that attempt
5. Leaderboard: highest cash-out score wins

**Why this works:**
- Fair competition — same RNG for everyone
- Replayable — learn from each attempt
- Social — compare with friends
- Low stakes entry to hook new players

---

## Game Mechanics

### Turn Structure
- Each turn: choose to add 1, 2, or 3 rubber bands
- Optional: "pass" ability (add 0), limited uses per game (e.g., 2 passes)
- Turn timer: 10 seconds to decide, auto-add 1 if timeout

### Skill Illusion
- Choosing how many bands = perceived strategy
- Psychological pressure on opponents
- Pass timing as "tactical reserve"
- In reality: threshold is random, choices just affect who's holding the bag

### Tension Building
- Watermelon visually deforms as bands increase
- Sound design: stretching, creaking, near-breaking sounds
- Screen shake increases near threshold
- "Danger zone" visual effects after certain % of average threshold

---

## Smart Contract Architecture

### Main Contract: WatermelonSnap.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IEntropyConsumer {
    function entropyCallback(uint64 sequenceNumber, bytes32 randomNumber) external;
}

contract WatermelonSnap is IEntropyConsumer {
    
    // ============ MULTIPLAYER STRUCTS ============
    
    struct Room {
        address[] players;
        uint256 entryFee;
        uint256 prizePool;
        uint256 currentBands;
        uint256 snapThreshold;      // Hidden until explosion
        bool thresholdSet;
        uint8 currentPlayerIndex;
        uint8 maxPlayers;
        uint8 minPlayers;
        RoomState state;
        mapping(address => uint8) passesRemaining;
        mapping(address => uint256) bandsAdded;
    }
    
    enum RoomState {
        WAITING,        // Waiting for players
        REQUESTING_VRF, // VRF requested, waiting for callback
        ACTIVE,         // Game in progress
        FINISHED        // Game ended
    }
    
    // ============ SOLO MODE STRUCTS ============
    
    struct SoloGame {
        address player;
        uint256 betAmount;
        uint256 currentBands;
        uint256 snapThreshold;      // Hidden until cash out or explosion
        uint256 currentMultiplier;  // In basis points (10000 = 1.0x)
        bool thresholdSet;
        SoloState state;
    }
    
    enum SoloState {
        REQUESTING_VRF,  // Waiting for threshold
        ACTIVE,          // Player adding bands
        CASHED_OUT,      // Player took winnings
        EXPLODED         // Watermelon exploded
    }
    
    mapping(uint256 => Room) public rooms;
    mapping(uint256 => SoloGame) public soloGames;
    uint256 public roomCounter;
    uint256 public soloGameCounter;
    
    // ============ CONSTANTS ============
    
    uint256 public constant MIN_THRESHOLD = 47;
    uint256 public constant MAX_THRESHOLD = 156;
    uint256 public constant SOLO_MIN_THRESHOLD = 30;
    uint256 public constant SOLO_MAX_THRESHOLD = 100;
    uint256 public constant PASSES_PER_PLAYER = 2;
    uint256 public constant TURN_TIMEOUT = 10 seconds;
    uint256 public constant PROTOCOL_FEE_BPS = 500; // 5%
    
    // Multiplier curve (basis points): index = bands, value = multiplier
    // 10000 = 1.0x, 15000 = 1.5x, 20000 = 2.0x, etc.
    uint256[] public multiplierCurve;
    
    // ============ EVENTS ============
    
    // Multiplayer events
    event RoomCreated(uint256 indexed roomId, address creator, uint256 entryFee);
    event PlayerJoined(uint256 indexed roomId, address player);
    event GameStarted(uint256 indexed roomId);
    event BandsAdded(uint256 indexed roomId, address player, uint8 amount, uint256 totalBands);
    event PlayerPassed(uint256 indexed roomId, address player);
    event WatermelonExploded(uint256 indexed roomId, address loser, uint256 threshold);
    event PrizeDistributed(uint256 indexed roomId, address[] winners, uint256 prizePerWinner);
    
    // Solo events
    event SoloGameStarted(uint256 indexed gameId, address player, uint256 betAmount);
    event SoloBandAdded(uint256 indexed gameId, uint256 totalBands, uint256 currentMultiplier);
    event SoloCashOut(uint256 indexed gameId, address player, uint256 payout, uint256 threshold);
    event SoloExploded(uint256 indexed gameId, address player, uint256 threshold);
    
    // ============ MULTIPLAYER FUNCTIONS ============
    
    function createRoom(uint256 entryFee, uint8 maxPlayers) external payable returns (uint256 roomId);
    function joinRoom(uint256 roomId) external payable;
    function startGame(uint256 roomId) external;
    function addBands(uint256 roomId, uint8 amount) external; // amount: 1, 2, or 3
    function pass(uint256 roomId) external;
    function forceTimeout(uint256 roomId) external;
    
    // ============ SOLO FUNCTIONS ============
    
    function startSoloGame() external payable returns (uint256 gameId);
    function soloAddBand(uint256 gameId) external;
    function soloCashOut(uint256 gameId) external;
    
    // ============ VRF ============
    
    function entropyCallback(uint64 sequenceNumber, bytes32 randomNumber) external;
    
    // ============ VIEW FUNCTIONS ============
    
    function getRoomState(uint256 roomId) external view returns (
        address[] memory players,
        uint256 currentBands,
        uint8 currentPlayerIndex,
        RoomState state,
        uint256 prizePool
    );
    
    function getSoloGameState(uint256 gameId) external view returns (
        address player,
        uint256 currentBands,
        uint256 currentMultiplier,
        SoloState state,
        uint256 potentialPayout
    );
    
    function getMultiplierForBands(uint256 bands) public view returns (uint256);
    function getThreshold(uint256 roomId) external view returns (uint256); // Only after game ends
}
```

### Solo Mode Logic Detail

```solidity
// Multiplier calculation (exponential curve)
function getMultiplierForBands(uint256 bands) public pure returns (uint256) {
    // Base: 10000 = 1.0x
    // Formula: 1.0 + (bands^1.5 / 100)
    // Examples:
    //   10 bands → ~1.3x (13162)
    //   20 bands → ~1.9x (18944)
    //   30 bands → ~2.6x (26432)
    //   50 bands → ~4.5x (45355)
    //   70 bands → ~6.9x (68586)
    //   100 bands → ~11x (110000)
    
    if (bands == 0) return 10000;
    
    // Simplified: linear + exponential component
    uint256 linear = bands * 200; // +0.02x per band
    uint256 exponential = (bands * bands) / 10; // quadratic boost
    
    return 10000 + linear + exponential;
}

function startSoloGame() external payable returns (uint256 gameId) {
    require(msg.value >= MIN_BET, "Bet too small");
    
    gameId = ++soloGameCounter;
    
    SoloGame storage game = soloGames[gameId];
    game.player = msg.sender;
    game.betAmount = msg.value;
    game.currentBands = 0;
    game.currentMultiplier = 10000; // 1.0x
    game.state = SoloState.REQUESTING_VRF;
    
    // Request VRF for threshold
    _requestSoloThreshold(gameId);
    
    emit SoloGameStarted(gameId, msg.sender, msg.value);
}

function soloAddBand(uint256 gameId) external {
    SoloGame storage game = soloGames[gameId];
    require(game.player == msg.sender, "Not your game");
    require(game.state == SoloState.ACTIVE, "Game not active");
    
    game.currentBands++;
    game.currentMultiplier = getMultiplierForBands(game.currentBands);
    
    if (game.currentBands >= game.snapThreshold) {
        // BOOM!
        game.state = SoloState.EXPLODED;
        emit SoloExploded(gameId, msg.sender, game.snapThreshold);
        // No payout - house wins
    } else {
        emit SoloBandAdded(gameId, game.currentBands, game.currentMultiplier);
    }
}

function soloCashOut(uint256 gameId) external {
    SoloGame storage game = soloGames[gameId];
    require(game.player == msg.sender, "Not your game");
    require(game.state == SoloState.ACTIVE, "Game not active");
    
    game.state = SoloState.CASHED_OUT;
    
    uint256 payout = (game.betAmount * game.currentMultiplier) / 10000;
    uint256 fee = (payout * PROTOCOL_FEE_BPS) / 10000;
    uint256 netPayout = payout - fee;
    
    payable(msg.sender).transfer(netPayout);
    
    emit SoloCashOut(gameId, msg.sender, netPayout, game.snapThreshold);
}
```

### VRF Integration (Pyth Entropy)

```solidity
import "@pythnetwork/entropy-sdk-solidity/IEntropy.sol";
import "@pythnetwork/entropy-sdk-solidity/IEntropyConsumer.sol";

contract WatermelonSnap is IEntropyConsumer {
    IEntropy public entropy;
    address public entropyProvider;
    
    mapping(uint64 => uint256) public vrfRequestToRoom;
    
    function requestThreshold(uint256 roomId) internal {
        bytes32 userRandomNumber = keccak256(abi.encodePacked(block.timestamp, roomId, msg.sender));
        uint256 fee = entropy.getFee(entropyProvider);
        
        uint64 sequenceNumber = entropy.requestWithCallback{value: fee}(
            entropyProvider,
            userRandomNumber
        );
        
        vrfRequestToRoom[sequenceNumber] = roomId;
        rooms[roomId].state = RoomState.REQUESTING_VRF;
    }
    
    function entropyCallback(
        uint64 sequenceNumber,
        address provider,
        bytes32 randomNumber
    ) external override {
        require(msg.sender == address(entropy), "Only entropy");
        
        uint256 roomId = vrfRequestToRoom[sequenceNumber];
        Room storage room = rooms[roomId];
        
        // Calculate threshold in range [MIN_THRESHOLD, MAX_THRESHOLD]
        uint256 range = MAX_THRESHOLD - MIN_THRESHOLD + 1;
        uint256 threshold = MIN_THRESHOLD + (uint256(randomNumber) % range);
        
        room.snapThreshold = threshold;
        room.thresholdSet = true;
        room.state = RoomState.ACTIVE;
        
        emit GameStarted(roomId);
    }
}
```

---

## Frontend Architecture

### Tech Stack
- **Framework:** Next.js 14 (App Router)
- **Styling:** Tailwind CSS
- **Web3:** wagmi v2 + viem
- **State:** Zustand
- **Animations:** Framer Motion
- **3D (optional):** Three.js / React Three Fiber for watermelon deformation
- **Sound:** Howler.js

### Key Components

```
src/
├── app/
│   ├── page.tsx                 # Landing / mode select
│   ├── solo/page.tsx            # Solo game
│   ├── daily/page.tsx           # Daily challenge
│   ├── room/[id]/page.tsx       # Multiplayer room
│   └── layout.tsx
├── components/
│   ├── Watermelon/
│   │   ├── Watermelon3D.tsx     # 3D watermelon with deformation
│   │   ├── WatermelonSprite.tsx # 2D fallback
│   │   ├── StressMeter.tsx      # Visual tension indicator
│   │   └── ExplosionEffect.tsx
│   ├── Game/
│   │   ├── GameRoom.tsx         # Multiplayer game
│   │   ├── SoloGame.tsx         # Solo "Press Your Luck"
│   │   ├── PlayerList.tsx
│   │   ├── TurnControls.tsx     # [1] [2] [3] buttons (multi)
│   │   ├── SoloControls.tsx     # [Cash Out] [Add Band] (solo)
│   │   ├── MultiplierDisplay.tsx
│   │   ├── BandCounter.tsx
│   │   └── TurnTimer.tsx
│   ├── Room/
│   │   ├── ModeSelect.tsx       # Solo / Multi / Daily selector
│   │   ├── CreateRoomModal.tsx
│   │   ├── RoomList.tsx
│   │   └── JoinRoomButton.tsx
│   └── UI/
│       ├── ConnectWallet.tsx
│       ├── BetInput.tsx         # For solo mode bet amount
│       ├── TransactionToast.tsx
│       └── VerifyFairnessModal.tsx
├── hooks/
│   ├── useGameContract.ts
│   ├── useSoloGame.ts           # Solo game state management
│   ├── useRoom.ts
│   ├── useGameEvents.ts
│   ├── useMultiplier.ts         # Calculate current multiplier
│   └── useSoundEffects.ts
├── lib/
│   ├── contracts.ts             # ABIs and addresses
│   ├── sounds.ts
│   └── utils.ts
└── stores/
    └── gameStore.ts
```

### Game States UI

**MODE SELECT:**
```
┌─────────────────────────────────────┐
│         🍉 WATERMELON SNAP          │
│                                     │
│  ┌───────────┐    ┌───────────┐    │
│  │  🎮 SOLO  │    │ 👥 MULTI  │    │
│  │           │    │           │    │
│  │ Press Your│    │ Hot Potato│    │
│  │   Luck    │    │  Battle   │    │
│  └───────────┘    └───────────┘    │
│                                     │
│  ┌───────────┐    ┌───────────┐    │
│  │ 📅 DAILY  │    │ 🎯 PREDICT│    │
│  │ Challenge │    │  (Soon)   │    │
│  └───────────┘    └───────────┘    │
└─────────────────────────────────────┘
```

**SOLO MODE - ACTIVE:**
```
┌─────────────────────────────────────┐
│  🍉 SOLO RUN                        │
│  Bet: 0.1 MON                       │
│                                     │
│      [WATERMELON VISUAL]            │
│      Bands: 34                      │
│                                     │
│  ╔═══════════════════════════════╗  │
│  ║  MULTIPLIER: 2.47x            ║  │
│  ║  Potential: 0.247 MON         ║  │
│  ╚═══════════════════════════════╝  │
│                                     │
│  ┌─────────────┐  ┌─────────────┐  │
│  │ 💰 CASH OUT │  │ ➕ ADD BAND │  │
│  │   0.247 MON │  │   (RISKY!)  │  │
│  └─────────────┘  └─────────────┘  │
│                                     │
│  [Stress meter: ████████░░ 80%]    │
└─────────────────────────────────────┘
```

**SOLO MODE - CASHED OUT:**
```
┌─────────────────────────────────────┐
│  💰 YOU CASHED OUT!                 │
│                                     │
│      [RELIEVED WATERMELON]          │
│                                     │
│  Bands placed: 34                   │
│  Multiplier: 2.47x                  │
│  Payout: 0.247 MON ✓                │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ The threshold was: 41       │   │
│  │ You could've gone 7 more!   │   │
│  │ That would've been 3.21x... │   │
│  └─────────────────────────────┘   │
│                                     │
│  [Verify Fairness] [Play Again]     │
└─────────────────────────────────────┘
```

**SOLO MODE - EXPLODED:**
```
┌─────────────────────────────────────┐
│  💥 BOOM! 💥                        │
│                                     │
│      [EXPLOSION ANIMATION]          │
│                                     │
│  You pushed too far!                │
│  Bands placed: 41                   │
│  Threshold was: 41                  │
│                                     │
│  Lost: 0.1 MON                      │
│  You were at 3.21x...               │
│                                     │
│  [Verify Fairness] [Try Again]      │
└─────────────────────────────────────┘
```

**MULTIPLAYER - WAITING:**
┌─────────────────────────────────────┐
│  Room #42 | Entry: 0.1 MON          │
│  Players: 3/6                       │
│  [Player1] [Player2] [Player3]      │
│  [ ] [ ] [ ]                        │
│                                     │
│  [Start Game] (host only, if min)   │
│  [Leave Room]                       │
└─────────────────────────────────────┘

ACTIVE:
┌─────────────────────────────────────┐
│  🍉 Bands: 34 / ???                 │
│                                     │
│      [WATERMELON VISUAL]            │
│      (increasingly stressed)        │
│                                     │
│  Your turn! ⏱️ 7s                   │
│  [+1] [+2] [+3] [Pass (2 left)]     │
│                                     │
│  Players:                           │
│  ✓ Player1: 12 bands                │
│  ✓ Player2: 11 bands                │
│  → You: 11 bands (your turn)        │
│    Player4: 0 bands                 │
└─────────────────────────────────────┘

EXPLODED:
┌─────────────────────────────────────┐
│  💥 BOOM! 💥                        │
│                                     │
│  [EXPLOSION ANIMATION]              │
│                                     │
│  Player3 added the fatal band!      │
│  Threshold was: 47 bands            │
│                                     │
│  Winners: Player1, Player2, You     │
│  Prize: 0.095 MON each              │
│                                     │
│  [Verify Fairness] [Play Again]     │
└─────────────────────────────────────┘
```

---

## Visual & Audio Design

### Watermelon Deformation Stages

| Bands % | Visual | Sound |
|---------|--------|-------|
| 0-25% | Normal watermelon | Soft rubber stretch |
| 25-50% | Slight compression, visible bands | Creaking |
| 50-75% | Noticeable deformation, cracks appear | Tension building |
| 75-90% | Severe deformation, juice dripping | Loud creaking, heartbeat |
| 90%+ | Pulsing, screen shake | Intense music, warning sounds |
| SNAP | Explosion particles, juice splatter | Explosion + wet splat |

### Color Palette
- Background: Deep purple/dark (#1a0a2e)
- Watermelon: Classic green exterior, red interior
- Rubber bands: Bright neon colors (yellow, pink, blue)
- UI accents: Monad purple (#836EF9)
- Danger: Red/orange gradient

### Sound Effects Needed
- `band_stretch_1.mp3` - `band_stretch_5.mp3` (variations)
- `band_snap_small.mp3` (tension sounds)
- `creak_1.mp3` - `creak_3.mp3`
- `heartbeat_loop.mp3`
- `explosion.mp3`
- `splat.mp3`
- `victory_jingle.mp3`
- `lose_sound.mp3`
- `turn_notification.mp3`
- `timer_tick.mp3`

---

## Monetization

### Revenue Streams

1. **Protocol Fee:** 5% of each prize pool
2. **Cosmetic NFTs:**
   - Rubber band skins (neon, gold, fire, ice, rainbow)
   - Watermelon skins (pumpkin, head, egg, bomb, disco ball)
   - Explosion effects (confetti, fireworks, pixel art)
3. **Season Pass:** Unlock exclusive cosmetics + reduced fees
4. **Spectator Predictions:** Side bets on outcomes (separate pool)

### NFT Cosmetics Contract

```solidity
contract WatermelonCosmetics is ERC1155 {
    enum CosmeticType { RUBBER_BAND, WATERMELON, EXPLOSION }
    
    struct Cosmetic {
        CosmeticType cosmeticType;
        string name;
        string metadataURI;
        uint256 price;
        bool isLimited;
        uint256 maxSupply;
        uint256 minted;
    }
    
    mapping(uint256 => Cosmetic) public cosmetics;
    mapping(address => uint256) public equippedBand;
    mapping(address => uint256) public equippedMelon;
    mapping(address => uint256) public equippedExplosion;
    
    function mint(uint256 cosmeticId) external payable;
    function equip(uint256 cosmeticId) external;
}
```

---

## Development Phases

### Phase 1: MVP (1-2 weeks)
- [ ] Smart contract: multiplayer game logic
- [ ] Smart contract: solo "Press Your Luck" mode
- [ ] Pyth Entropy integration for both modes
- [ ] Simple 2D frontend with mode selection
- [ ] Basic turn system (multiplayer)
- [ ] Cash out / add band flow (solo)
- [ ] Prize distribution

### Phase 2: Polish (1 week)
- [ ] 3D watermelon with deformation
- [ ] Sound effects
- [ ] Animations (explosion, bands, multiplier ticks)
- [ ] Mobile responsive
- [ ] Stress meter visual

### Phase 3: Social (1 week)
- [ ] Room sharing links
- [ ] Spectator mode
- [ ] Leaderboards (solo high scores, multiplayer wins)
- [ ] Share explosion clips / near-misses
- [ ] Daily challenge mode

### Phase 4: Monetization (post-launch)
- [ ] Cosmetic NFTs
- [ ] Season system
- [ ] Referral program

---

## Deployment

### Contracts
- Network: Monad Mainnet
- VRF: Pyth Entropy (address TBD for Monad)

### Frontend
- Hosting: Vercel
- Domain: watermelonsnap.xyz / melonsnap.gg

### Required Environment Variables
```
NEXT_PUBLIC_CHAIN_ID=
NEXT_PUBLIC_RPC_URL=
NEXT_PUBLIC_GAME_CONTRACT=
NEXT_PUBLIC_COSMETICS_CONTRACT=
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
```

---

## Open Questions

### Multiplayer
1. **Min/max players per room?** Suggested: 2-8
2. **Entry fee range?** Let room creator decide, or fixed tiers?
3. **Threshold range?** 47-156 feels right for ~1-3 min games
4. **Should passes cost something?** Or just limited count?
5. **Spectator betting?** Separate feature or core to v1?

### Solo Mode
6. **Multiplier curve shape?** Linear, quadratic, exponential? Current: quadratic
7. **House edge?** 5% protocol fee on cash outs — is that enough margin?
8. **Min/max bet?** Suggested: 0.01 - 10 MON
9. **Liquidity source?** House bankroll vs peer-funded pools?
10. **Auto cash-out option?** Let users set a target multiplier?
11. **Free play mode?** Points-based version to onboard users?

---

## References

- [Pyth Entropy Docs](https://docs.pyth.network/entropy)
- [Switchboard Docs](https://docs.switchboard.xyz/)
- [Monad Docs](https://docs.monad.xyz/)
- [Mission X Info Pack](https://monad-foundation.notion.site/mission-x-verifiably-fair-info-pack)
- [Watermelon rubber band explosion videos](https://www.youtube.com/results?search_query=watermelon+rubber+bands+explosion)

---

## Commands for Claude Code

Start with:
```bash
# Initialize project
npx create-next-app@latest watermelon-snap --typescript --tailwind --app

# Install dependencies
cd watermelon-snap
npm install wagmi viem @tanstack/react-query zustand framer-motion howler
npm install -D @types/howler

# For smart contracts
npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox
npx hardhat init
```

Then ask Claude Code to:
1. "Set up the smart contract with both multiplayer and solo mode based on the brief"
2. "Create the mode selection landing page"
3. "Implement the solo game UI with multiplier display and cash out button"
4. "Build the multiplayer game room UI"
5. "Implement the watermelon deformation visual with stress meter"
6. "Add sound effects system"
7. "Connect frontend to contract with wagmi hooks for both modes"

### Suggested Build Order (Solo-first approach)
Solo mode is simpler and can be shipped faster:
1. Solo contract + VRF
2. Solo frontend
3. Test on testnet, iterate
4. Add multiplayer contract
5. Add multiplayer frontend
6. Polish both modes together
