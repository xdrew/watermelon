// Economics analysis for threshold 1-15 (max 14 bands)

const minT = 1;
const maxT = 15;
const range = maxT - minT + 1;

console.log("=== Threshold 1-15 Analysis ===\n");

function analyze(name: string, ratePercent: number) {
  const rate = 1 + ratePercent / 100;

  console.log(`\n--- ${name} (${ratePercent}% per band) ---\n`);
  console.log("Bands | Multiplier | Score  | Survive");
  console.log("------|------------|--------|--------");

  for (const b of [0, 1, 2, 3, 5, 7, 10, 14]) {
    const mult = Math.pow(rate, b);
    const multBP = Math.round(mult * 10000);
    const score = Math.round(b * multBP / 100);
    const survive = ((maxT - b) / range * 100).toFixed(1);
    console.log(
      `${String(b).padStart(5)} | ${mult.toFixed(3).padStart(10)}x | ${String(score).padStart(6)} | ${survive.padStart(6)}%`
    );
  }

  const maxMult = Math.pow(rate, 14);
  const maxScore = Math.round(14 * maxMult * 100);
  console.log(`\nMax score (14 bands): ${maxScore}`);
}

analyze("Current 2.5%", 2.5);
analyze("Low 5%", 5);
analyze("Medium 10%", 10);
analyze("High 15%", 15);
analyze("Very High 20%", 20);

console.log("\n\n=== Survival Comparison ===\n");
console.log("Bands | Old (1-50) | New (1-15)");
console.log("------|------------|----------");
for (const b of [1, 2, 3, 5, 7, 10, 14]) {
  const oldSurv = ((50 - b) / 50 * 100).toFixed(1);
  const newSurv = ((15 - b) / 15 * 100).toFixed(1);
  console.log(`${String(b).padStart(5)} | ${oldSurv.padStart(9)}% | ${newSurv.padStart(9)}%`);
}

console.log("\n=== Key Insight ===");
console.log("With 1-15 threshold, survival drops FAST:");
console.log("- 5 bands: 66.7% survive (was 90%)");
console.log("- 10 bands: 33.3% survive (was 80%)");
console.log("- Instant death (threshold=1): 6.7% (was 2%)");
