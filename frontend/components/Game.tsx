"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useChainId, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { formatEther } from "viem";
import {
  MONAD_CHAIN,
  GameState,
  getDangerLevel,
  SOLO_MAX_THRESHOLD,
  CONTRACT_ADDRESS,
  CONTRACT_ABI,
  formatTimeLeft,
  getGasPrice,
} from "@/lib/contract";
import { useWatermelonGame } from "@/hooks/useWatermelonGame";
import { useBurnerWallet } from "@/hooks/useBurnerWallet";

interface GameProps {
  onGameEnd?: () => void;
}

export function Game({ onGameEnd }: GameProps) {
  const { authenticated, ready } = usePrivy();
  const { wallets } = useWallets();
  const activeWallet = wallets[0];
  const address = activeWallet?.address as `0x${string}` | undefined;
  const isConnected = authenticated && !!address;
  const chainId = useChainId();
  const [mounted, setMounted] = useState(false);
  const [burnerMode, setBurnerMode] = useState(false);
  const [isSettingUpBurner, setIsSettingUpBurner] = useState(false);
  const [isStartingGame, setIsStartingGame] = useState(false);

  // Optimistic UI state for instant feedback
  const [optimisticBands, setOptimisticBands] = useState<number | null>(null);

  const {
    gameId,
    status,
    setStatus,
    isWaitingForVRF,
    isPending,
    isConfirming,
    isValidatingGame,
    gameState,
    season,
    cost,
    bestScore,
    isGameActive,
    isGameOver,
    isExploded,
    isScored,
    isCancelled,
    isStale,
    dangerLevel,
    startGame,
    addBand,
    cashOut,
    cancelGame,
    resetGame,
    checkStatus,
    refetchGameState,
    refetchPlayerGames,
    refetchPlayerBest,
  } = useWatermelonGame(address);

  const burner = useBurnerWallet(address);
  const prevIsGameOver = useRef(false);
  const [timeLeft, setTimeLeft] = useState("");
  const [showGameResult, setShowGameResult] = useState(false);

  // Track when game ends to show result only for recent games (not on refresh)
  const RESULT_DISPLAY_TIMEOUT = 2 * 60 * 1000; // 2 minutes
  useEffect(() => {
    if (isGameOver && gameId) {
      const endedAt = sessionStorage.getItem(`game_ended_${gameId}`);
      if (!endedAt) {
        // Game just ended - save timestamp and show result
        sessionStorage.setItem(`game_ended_${gameId}`, Date.now().toString());
        setShowGameResult(true);
      } else {
        // Check if ended recently
        const elapsed = Date.now() - parseInt(endedAt, 10);
        setShowGameResult(elapsed < RESULT_DISPLAY_TIMEOUT);
      }
    } else {
      setShowGameResult(false);
    }
  }, [isGameOver, gameId]);

  // Season info
  const { data: seasonInfo } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getSeasonInfo",
  });

  const prizePool = seasonInfo ? seasonInfo[1] : BigInt(0);
  const endTime = seasonInfo ? Number(seasonInfo[3]) : 0;
  const isSeasonFinalized = seasonInfo ? seasonInfo[4] : false;
  const isSeasonEnded = endTime > 0 && Date.now() / 1000 > endTime;

  // Player rank - season is an object with { number, prizePool, endTime }
  const seasonNumber = season?.number || 1;
  const canTriggerPayouts = isSeasonEnded && !isSeasonFinalized && prizePool > 0n;

  // Finalize season transaction
  const { writeContract: writeFinalize, data: finalizeTxHash, isPending: isFinalizePending } = useWriteContract();
  const { isLoading: isFinalizeConfirming, isSuccess: isFinalizeSuccess } = useWaitForTransactionReceipt({ hash: finalizeTxHash });
  const [finalizeStatus, setFinalizeStatus] = useState("");

  const gasPrice = getGasPrice(chainId);
  const triggerPayouts = useCallback(() => {
    setFinalizeStatus("Triggering payouts...");
    writeFinalize(
      {
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "finalizeSeason",
        args: [BigInt(seasonNumber)],
        gas: 500_000n, // finalizeSeason iterates leaderboard + transfers
        ...gasPrice,
      },
      {
        onSuccess: () => setFinalizeStatus("Confirming..."),
        onError: (err) => setFinalizeStatus(`Error: ${err.message.slice(0, 50)}`),
      }
    );
  }, [writeFinalize, seasonNumber, gasPrice]);

  // Clear status on success
  useEffect(() => {
    if (isFinalizeSuccess) {
      setFinalizeStatus("Payouts distributed! You earned 1% reward.");
      setTimeout(() => setFinalizeStatus(""), 5000);
    }
  }, [isFinalizeSuccess]);
  const { data: playerRank, refetch: refetchPlayerRank } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getPlayerRank",
    args: [BigInt(seasonNumber), address!],
    query: { enabled: !!address && seasonNumber > 0 },
  });

  const rank = playerRank ? Number(playerRank) : 0;

  // Leaderboard for competitor count
  const { data: leaderboard, refetch: refetchLeaderboard } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getLeaderboard",
    args: [BigInt(seasonNumber)],
    query: { enabled: seasonNumber > 0, staleTime: 60000 },
  });

  const competitorCount = leaderboard
    ? leaderboard.filter(
        (e) => e.player !== "0x0000000000000000000000000000000000000000" && e.score > 0n
      ).length
    : 0;

  useEffect(() => {
    setMounted(true);
  }, []);

  // Countdown timer
  useEffect(() => {
    if (!endTime) return;
    const update = () => setTimeLeft(formatTimeLeft(endTime));
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [endTime]);

  // Trigger onGameEnd when game transitions to over (explosion or score)
  useEffect(() => {
    if (isGameOver && !prevIsGameOver.current) {
      onGameEnd?.();
    }
    prevIsGameOver.current = isGameOver;
  }, [isGameOver, onGameEnd]);

  // Clear isStartingGame only when game actually becomes ACTIVE
  // This prevents the "Start Game" button from appearing during state transitions
  useEffect(() => {
    if (isStartingGame && isGameActive) {
      setIsStartingGame(false);
    }
  }, [isStartingGame, isGameActive]);


  // Handle starting game with burner
  const handleStartGame = useCallback(async () => {
    // Verify wallet is on correct chain before starting
    const provider = await activeWallet?.getEthereumProvider();
    if (!provider) {
      setStatus?.("Wallet not connected");
      return;
    }

    const walletChainId = await provider.request({ method: "eth_chainId" });
    const walletChain = parseInt(walletChainId as string, 16);

    if (walletChain !== MONAD_CHAIN.id) {
      setStatus?.("Switching to Monad...");
      try {
        // First try to switch (chain might already exist)
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: `0x${MONAD_CHAIN.id.toString(16)}` }],
        });
      } catch (switchError: unknown) {
        // Chain doesn't exist, add it first
        if ((switchError as { code?: number })?.code === 4902) {
          try {
            await provider.request({
              method: "wallet_addEthereumChain",
              params: [{
                chainId: `0x${MONAD_CHAIN.id.toString(16)}`,
                chainName: MONAD_CHAIN.name,
                nativeCurrency: MONAD_CHAIN.nativeCurrency,
                rpcUrls: [MONAD_CHAIN.rpcUrls.default.http[0]],
                blockExplorerUrls: [MONAD_CHAIN.blockExplorers.default.url],
              }],
            });
          } catch (addError) {
            console.error("Failed to add chain:", addError);
          }
        } else {
          console.error("Failed to switch chain:", switchError);
        }
      }

      // Verify switch worked
      const newChainId = await provider.request({ method: "eth_chainId" });
      const newChain = parseInt(newChainId as string, 16);
      if (newChain !== MONAD_CHAIN.id) {
        setStatus?.("Please manually switch to Monad (Chain 143)");
        return;
      }
    }

    setIsSettingUpBurner(true);
    setStatus?.("Checking session...");

    // Get fresh status
    const freshStatus = await burner.refreshStatus();
    if (!freshStatus) {
      setStatus?.("Failed to check status");
      setIsSettingUpBurner(false);
      return;
    }

    // Check authorization using fresh values
    if (!freshStatus.isAuthorized) {
      setStatus?.("Authorizing burner wallet...");
      const authorized = await burner.authorizeBurner();
      if (!authorized) {
        setStatus?.("Authorization failed");
        setIsSettingUpBurner(false);
        return;
      }
    }

    // Check balance and fund BEFORE trying to start
    // Mainnet entry fee is 10 MON + ~0.5 for VRF/gas
    const minBalance = BigInt(10.5 * 10**18); // 10.5 MON minimum
    if (freshStatus.balance < minBalance) {
      setStatus?.("Funding game session...");
      const funded = await burner.fundBurner();
      if (!funded) {
        setStatus?.("Funding failed");
        setIsSettingUpBurner(false);
        return;
      }
    }

    setIsSettingUpBurner(false);
    setBurnerMode(true);
    setIsStartingGame(true);
    setStatus?.("Starting game...");

    const hash = await burner.startGameWithBurner();

    if (hash) {
      setStatus?.("Waiting for VRF...");
      // Transaction is confirmed - immediately refetch player games to pick up new gameId
      // Note: isStartingGame will be cleared by effect when game becomes ACTIVE
      await refetchPlayerGames?.();
    } else {
      setStatus?.("Failed to start game");
      setBurnerMode(false);
      setIsStartingGame(false);
    }
  }, [burner, setStatus, refetchPlayerGames]);

  // Handle add band with burner
  const [isAddingBand, setIsAddingBand] = useState(false);
  const isAddingBandRef = useRef(false);

  const handleAddBand = useCallback(async () => {
    if (!gameId || isAddingBandRef.current) return;

    if (burnerMode && burner.isAuthorized) {
      // Prevent double execution
      isAddingBandRef.current = true;

      // Optimistic update - show new band count immediately
      const newBands = gameState.currentBands + 1;
      setOptimisticBands(newBands);
      setIsAddingBand(true);

      const hash = await burner.addBandWithBurner(gameId);
      setIsAddingBand(false);
      isAddingBandRef.current = false;

      if (hash) {
        // Wait for refetch to complete BEFORE clearing optimistic state
        await refetchGameState?.();
        setOptimisticBands(null);
      } else {
        setOptimisticBands(null);
        setStatus?.("Failed to add band");
      }
    } else {
      addBand();
    }
  }, [burnerMode, burner, gameId, gameState.currentBands, addBand, setStatus, refetchGameState]);

  // Handle cash out with burner
  const [isCashingOut, setIsCashingOut] = useState(false);
  const isCashingOutRef = useRef(false);

  const handleCashOut = useCallback(async () => {
    if (!gameId || isCashingOutRef.current) return;

    if (burnerMode && burner.isAuthorized) {
      // Prevent double execution
      isCashingOutRef.current = true;
      setIsCashingOut(true);

      const hash = await burner.cashOutWithBurner(gameId);
      setIsCashingOut(false);
      isCashingOutRef.current = false;

      if (hash) {
        // Refetch all game-related data immediately
        await Promise.all([
          refetchGameState?.(),
          refetchPlayerBest?.(),
          refetchPlayerRank(),
          refetchLeaderboard(),
        ]);
        // Auto-withdraw silently in background (don't override game result display)
        if (burner.canWithdraw) {
          burner.withdrawToUser().then(() => burner.refreshStatus());
        }
        setBurnerMode(false);
      } else {
        setStatus?.("Failed to cash out");
      }
    } else {
      cashOut();
    }
  }, [burnerMode, burner, gameId, cashOut, setStatus, refetchGameState, refetchPlayerBest, refetchPlayerRank, refetchLeaderboard]);

  if (!mounted || !ready) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-black border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="text-center py-20">
        <div className="text-6xl mb-4">🍉</div>
        <p className="text-gray-500">Connect your wallet to play</p>
      </div>
    );
  }

  if (chainId !== MONAD_CHAIN.id) {
    const handleSwitchNetwork = async () => {
      try {
        const provider = await activeWallet?.getEthereumProvider();
        if (!provider) return;
        // Try to switch first
        try {
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: `0x${MONAD_CHAIN.id.toString(16)}` }],
          });
        } catch (switchError: unknown) {
          // Chain doesn't exist (4902), add it
          if ((switchError as { code?: number })?.code === 4902) {
            await provider.request({
              method: "wallet_addEthereumChain",
              params: [{
                chainId: `0x${MONAD_CHAIN.id.toString(16)}`,
                chainName: MONAD_CHAIN.name,
                nativeCurrency: MONAD_CHAIN.nativeCurrency,
                rpcUrls: [MONAD_CHAIN.rpcUrls.default.http[0]],
                blockExplorerUrls: [MONAD_CHAIN.blockExplorers.default.url],
              }],
            });
          }
        }
      } catch (e) {
        console.error("Failed to switch:", e);
      }
    };
    return (
      <div className="text-center py-20">
        <div className="text-6xl mb-4">⚠️</div>
        <p className="text-gray-500 mb-4">Switch to Monad Mainnet to play</p>
        <button
          onClick={handleSwitchNetwork}
          className="px-6 py-2 bg-black text-white rounded-full font-medium hover:bg-gray-800"
        >
          Switch Network
        </button>
        <p className="text-xs text-gray-400 mt-2">Chain ID: 143</p>
      </div>
    );
  }

  const isProcessing = isPending || isConfirming || isValidatingGame || isSettingUpBurner || isCashingOut || isAddingBand || isStartingGame;
  const isStartingFlow = isSettingUpBurner || isStartingGame;
  const showVRFWaiting = isWaitingForVRF || isStartingGame || gameState.currentState === GameState.REQUESTING_VRF;

  // Compute display values - use optimistic state for instant feedback
  const displayBands = optimisticBands ?? gameState.currentBands;
  const displayDangerLevel = optimisticBands !== null
    ? getDangerLevel(optimisticBands)
    : dangerLevel;

  return (
    <div className="flex flex-col items-center">
      {/* Stats bar */}
      <div className="flex items-center gap-4 text-xs text-gray-400">
        <span>Season {seasonNumber}</span>
        {canTriggerPayouts ? (
          <button
            onClick={triggerPayouts}
            disabled={isFinalizePending || isFinalizeConfirming}
            className="px-2 py-0.5 bg-green-500 text-white rounded-full text-[10px] font-medium hover:bg-green-600 disabled:bg-gray-300"
          >
            {isFinalizePending || isFinalizeConfirming ? "..." : "Trigger Payouts"}
          </button>
        ) : isSeasonFinalized ? (
          <span className="text-green-600 font-medium">Finalized</span>
        ) : timeLeft ? (
          <span>{timeLeft}</span>
        ) : null}
        {/* Only show active stats when season is not finalized and not finalizing */}
        {!isSeasonFinalized && !isFinalizePending && !isFinalizeConfirming && !isFinalizeSuccess && (
          <>
            <span className="text-gray-300">|</span>
            {competitorCount > 0 && <span>{competitorCount} playing</span>}
            <span>Best: <span className="text-gray-600 font-medium">{bestScore.toString()}</span></span>
            {rank > 0 ? (
              <span className={`font-medium ${rank <= 3 ? 'text-yellow-600' : 'text-green-600'}`}>#{rank}</span>
            ) : bestScore > 0 && leaderboard && leaderboard.length >= 10 && leaderboard[9].score > 0n ? (
              <span className="text-orange-500 font-medium">
                {Number(leaderboard[9].score) - Number(bestScore) + 1} pts to Top 10
              </span>
            ) : null}
          </>
        )}
      </div>

      {finalizeStatus && (
        <div className={`text-center text-xs mb-4 py-1 px-3 rounded-full ${finalizeStatus.startsWith('Error') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
          {finalizeStatus}
        </div>
      )}

      {/* HERO: Watermelon */}
      <div className="relative w-72 h-72 md:w-80 md:h-80 mx-auto z-0 overflow-hidden">
        <div
          className={`w-full h-full flex items-center justify-center transition-all ${
            isWaitingForVRF ? 'animate-pulse' :
            displayBands >= 10 && !isExploded ? 'animate-[wiggle-intense_0.15s_ease-in-out_infinite]' :
            displayBands >= 5 && !isExploded ? 'animate-[wiggle_0.3s_ease-in-out_infinite]' : ''
          }`}
        >
          <img
            src={isExploded ? '/wm-explode.png' : '/wm.png'}
            alt={isExploded ? 'Exploded watermelon' : 'Watermelon'}
            className="w-full h-full object-contain"
          />
        </div>

        {/* Band count badge - hide when game is over */}
        {displayBands > 0 && !isExploded && !isGameOver && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-black text-white text-sm font-bold px-4 py-1.5 rounded-full shadow-lg">
            {displayBands} bands
          </div>
        )}
      </div>

      {/* Score display when game ends (only show for recent games, not stale results on refresh) */}
      {showGameResult && gameState.currentState !== null && (
        <div className="text-center mb-4 -mt-14 relative z-10">
          <div className={`text-6xl font-black ${isExploded ? 'text-red-500' : 'text-green-500'}`}>
            {isExploded ? '0' : gameState.finalScore.toString()}
          </div>
          <div className="text-gray-400 text-sm mt-1">points</div>
        </div>
      )}

      {/* Threshold reveal */}
      {showGameResult && gameState.threshold > 0 && !isCancelled && (
        <div className={`text-center text-sm mb-6 py-2 px-6 rounded-full ${isExploded ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
          {isExploded ? `Exploded at ${gameState.threshold} bands!` : `Threshold was ${gameState.threshold}`}
          {gameState.vrfSequence > 0n && (
            <a
              href={`https://entropy-explorer.pyth.network/?chain=monad&sequence=${gameState.vrfSequence.toString()}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-400 hover:text-gray-600 underline ml-2"
            >
              Verify #{gameState.vrfSequence.toString()}
            </a>
          )}
        </div>
      )}

      {/* Cancelled message */}
      {showGameResult && isCancelled && (
        <div className="text-center text-sm mb-6 py-2 px-4 rounded-full bg-gray-100 text-gray-600">
          Game cancelled - fee refunded
        </div>
      )}

      {/* Status */}
      {status && !isGameOver && !isSettingUpBurner && (
        <div className={`text-center text-sm mb-4 ${
          status.startsWith('Error:') ? 'text-red-600' : 'text-gray-400'
        }`}>
          {status}
        </div>
      )}

      {/* Burner mode indicator */}
      {burnerMode && isGameActive && (
        <div className="flex items-center gap-1.5 mb-4 text-xs">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <span className="text-green-600 font-medium">Instant Mode</span>
          <span className="text-gray-400">({burner.formattedBalance} MON)</span>
        </div>
      )}

      {/* Controls */}
      <div className="w-full max-w-xs">
        {isSettingUpBurner ? (
          <div className="text-center py-4">
            <div className="w-8 h-8 border-2 border-black border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-gray-400 text-sm">{status || "Setting up..."}</p>
          </div>
        ) : showVRFWaiting ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-3 animate-[bounce-dice_1s_ease-in-out_infinite]">🎲</div>
            <p className="text-gray-400 text-sm">Generating threshold...</p>
            {isStale && (
              <div className="mt-3">
                <p className="text-xs text-red-500 mb-2">VRF timed out</p>
                <button
                  onClick={cancelGame}
                  disabled={isProcessing}
                  className="px-4 py-2 bg-red-500 text-white rounded-full text-sm hover:bg-red-600 disabled:bg-gray-200"
                >
                  Cancel & Refund
                </button>
              </div>
            )}
          </div>
        ) : (gameId && !isGameActive && !isGameOver) || isValidatingGame || isStartingGame ? (
          <div className="text-center py-4">
            <div className="w-8 h-8 border-2 border-black border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-gray-400 text-sm">Loading...</p>
          </div>
        ) : !gameId || isGameOver ? (
          <div className="space-y-3">
            <div className="flex flex-col items-center gap-1 text-sm text-gray-400">
              <div className="flex items-center gap-4">
                <span>Entry: {formatEther(cost.entryFee)} MON</span>
                {burner.isReady && <span className="text-green-600">Session: {burner.formattedBalance}</span>}
              </div>
              {!burner.isReady && (
                <span className="text-xs text-gray-300">+1 MON gas buffer for session</span>
              )}
            </div>

            {burner.hasOtherTabs && (
              <div className="text-center text-xs text-yellow-600">Multiple tabs detected</div>
            )}

            <button
              onClick={() => { resetGame(); handleStartGame(); }}
              disabled={isProcessing}
              className="w-full py-3 bg-black text-white rounded-full font-medium hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
            >
              {isProcessing ? 'Processing...' : isGameOver ? 'Play Again' : 'Start Game'}
            </button>

            {burner.canWithdraw && (
              <button
                onClick={() => burner.withdrawToUser()}
                className="w-full py-2 text-sm text-gray-400 hover:text-gray-600"
              >
                Withdraw {burner.formattedBalance} MON
              </button>
            )}
          </div>
        ) : isGameActive ? (
          <div className="space-y-4">
            {/* Risk bar */}
            <div className="w-full">
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>Risk</span>
                <span>{displayDangerLevel}%</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    displayDangerLevel > 60 ? 'bg-red-500' :
                    displayDangerLevel > 30 ? 'bg-yellow-500' :
                    'bg-green-500'
                  }`}
                  style={{ width: `${displayDangerLevel}%` }}
                />
              </div>
            </div>

            {/* Action buttons */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={handleCashOut}
                disabled={isProcessing || displayBands === 0}
                className="py-3 bg-green-500 text-white rounded-full font-medium hover:bg-green-600 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
              >
                {isCashingOut ? '...' : 'Secure'}
              </button>
              <button
                onClick={handleAddBand}
                disabled={isProcessing}
                className="py-3 bg-black text-white rounded-full font-medium hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
              >
                {isAddingBand ? '...' : 'Add Band'}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
