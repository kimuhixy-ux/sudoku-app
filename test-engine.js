// エンジンの動作確認用スクリプト（Node.jsで実行する）
// 使い方: node test-engine.js
const Sudoku = require("./js/sudoku-engine.js");

function printBoard(board) {
  let s = "";
  for (let r = 0; r < 9; r++) {
    let row = "";
    for (let c = 0; c < 9; c++) {
      const v = board[r * 9 + c];
      row += (v === 0 ? "." : v) + " ";
      if (c % 3 === 2 && c !== 8) row += "| ";
    }
    s += row + "\n";
    if (r % 3 === 2 && r !== 8) s += "------+-------+------\n";
  }
  return s;
}

console.log("=== 1. 完成盤の生成テスト ===");
const solved = Sudoku.generateSolvedBoard();
console.log(printBoard(solved));
console.log("完成盤の解の数 (countSolutions):", Sudoku.countSolutions(solved, 2), "(1なら正常)");

console.log("\n=== 2. 一意解判定テスト ===");
// 完成盤から1マスだけ消した盤面 -> 解は通常1つのはず
const onceRemoved = solved.slice();
onceRemoved[0] = 0;
console.log("1マス空きの解の数:", Sudoku.countSolutions(onceRemoved, 2));

console.log("\n=== 3. 各難易度のパズル生成テスト ===");
for (const level of Sudoku.LEVELS) {
  const t0 = Date.now();
  const result = Sudoku.generatePuzzle(level, 40);
  const ms = Date.now() - t0;
  if (!result) {
    console.log(`[${level}] 生成失敗`);
    continue;
  }
  console.log(`\n--- 目標難易度: ${level} (${Sudoku.LEVEL_LABEL[level]}) / 生成時間: ${ms}ms ---`);
  console.log(printBoard(result.puzzle));
  console.log("ヒント数(givens):", result.givens);
  console.log("実際の難易度:", result.rating.level, `(${Sudoku.LEVEL_LABEL[result.rating.level]})`);
  console.log("使用テクニック最大レベル:", result.rating.maxLevel);
  console.log("高度テクニック使用回数:", result.rating.advancedCount);
  console.log("一意解チェック:", Sudoku.countSolutions(result.puzzle, 2));
  // 使われたテクニックの一覧（重複なし）
  const techs = [...new Set(result.rating.steps.map((s) => s.name))];
  console.log("使われたテクニック:", techs.join(", "));
}
