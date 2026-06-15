/*
 * sudoku-engine.js
 * 数独の「完成盤生成」「一意解判定」「論理的な難易度判定」「問題生成」をまとめたファイル。
 * ブラウザでは window.Sudoku として、Node.jsでは module.exports として使えます。
 */
(function (global) {
  "use strict";

  // ===== 基本定数 =====
  const FULL = 0b111111111; // 1〜9すべての数字が候補という意味（9bit全部1）

  // ===== 行・列・ブロック（3x3）のセル番号一覧を作る =====
  const ROWS = [];
  const COLS = [];
  const BOXES = [];
  for (let r = 0; r < 9; r++) {
    ROWS.push(Array.from({ length: 9 }, (_, c) => r * 9 + c));
  }
  for (let c = 0; c < 9; c++) {
    COLS.push(Array.from({ length: 9 }, (_, r) => r * 9 + c));
  }
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const cells = [];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          cells.push((br * 3 + r) * 9 + (bc * 3 + c));
        }
      }
      BOXES.push(cells);
    }
  }
  const UNITS = [...ROWS, ...COLS, ...BOXES];

  // セル番号 -> ブロック番号
  const BOX_OF = new Array(81);
  for (let i = 0; i < 81; i++) {
    const r = Math.floor(i / 9);
    const c = i % 9;
    BOX_OF[i] = Math.floor(r / 3) * 3 + Math.floor(c / 3);
  }

  // セル番号 -> 「同じ行・列・ブロックにある他のセル」の集合
  const PEERS = new Array(81);
  for (let i = 0; i < 81; i++) {
    const set = new Set();
    for (const c of ROWS[Math.floor(i / 9)]) if (c !== i) set.add(c);
    for (const c of COLS[i % 9]) if (c !== i) set.add(c);
    for (const c of BOXES[BOX_OF[i]]) if (c !== i) set.add(c);
    PEERS[i] = set;
  }

  // ===== ちょっとした便利関数 =====

  // 配列をランダムにシャッフルする（Fisher-Yates法）
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ビット（候補マスク）の中に立っているビットの数を数える
  function popcount(mask) {
    let count = 0;
    while (mask) {
      count += mask & 1;
      mask >>= 1;
    }
    return count;
  }

  // 候補マスクから「可能な数字の配列」を作る（例: 0b000000101 -> [1,3]）
  function digitsInMask(mask) {
    const arr = [];
    for (let d = 1; d <= 9; d++) {
      if (mask & (1 << (d - 1))) arr.push(d);
    }
    return arr;
  }

  // a と b が同じ行・列・ブロックにあるか
  function arePeers(a, b) {
    return a !== b && PEERS[a].has(b);
  }

  // 盤面のセル pos に数字 d を置けるか（同じ行・列・ブロックに同じ数字がないか）
  function isValidPlacement(grid, pos, d) {
    for (const p of PEERS[pos]) {
      if (grid[p] === d) return false;
    }
    return true;
  }

  // ===== 1. 完成盤の生成 =====
  // ランダムな順番で数字を試すバックトラッキングで、ルール通りの完成盤を1つ作る
  function generateSolvedBoard() {
    const grid = new Array(81).fill(0);

    function fill(pos) {
      if (pos === 81) return true;
      const digits = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      for (const d of digits) {
        if (isValidPlacement(grid, pos, d)) {
          grid[pos] = d;
          if (fill(pos + 1)) return true;
          grid[pos] = 0;
        }
      }
      return false;
    }

    fill(0);
    return grid;
  }

  // ===== 2. 解の個数を数える（一意解判定に使う） =====
  // limit に達したら探索を打ち切る（通常 limit=2 で「解が2つ以上あるか」だけ見れば十分）
  function countSolutions(board, limit = 2) {
    const grid = board.slice();
    let count = 0;

    function solve() {
      // 候補数が最も少ないセル（MRV）を探す -> 探索を高速化するための工夫
      let best = -1;
      let bestCands = null;
      for (let i = 0; i < 81; i++) {
        if (grid[i] !== 0) continue;
        const cands = [];
        for (let d = 1; d <= 9; d++) {
          if (isValidPlacement(grid, i, d)) cands.push(d);
        }
        if (cands.length === 0) return; // 矛盾（置ける数字がない）
        if (best === -1 || cands.length < bestCands.length) {
          best = i;
          bestCands = cands;
          if (cands.length === 1) break; // これ以上良い選択はないので確定
        }
      }

      if (best === -1) {
        // 空きセルがない = 解が1つ見つかった
        count++;
        return;
      }

      for (const d of bestCands) {
        grid[best] = d;
        solve();
        grid[best] = 0;
        if (count >= limit) return; // 十分な数の解が見つかったので打ち切り
      }
    }

    solve();
    return count;
  }

  // ===== 3. 論理的な解法シミュレーター（難易度判定の核） =====

  // 現在の盤面から、各空きセルの「候補（鉛筆書き候補）」を計算する
  function computeCandidates(grid) {
    const cand = new Array(81).fill(0);
    for (let i = 0; i < 81; i++) {
      if (grid[i] !== 0) {
        cand[i] = 0;
        continue;
      }
      let mask = FULL;
      for (const p of PEERS[i]) {
        if (grid[p] !== 0) mask &= ~(1 << (grid[p] - 1));
      }
      cand[i] = mask & FULL;
    }
    return cand;
  }

  // セル i に数字 d を確定し、関連する候補を更新する
  function placeDigit(grid, cand, i, d) {
    grid[i] = d;
    cand[i] = 0;
    const bit = 1 << (d - 1);
    for (const p of PEERS[i]) {
      cand[p] &= ~bit;
    }
  }

  // --- レベル0: Naked Single（候補が1つしかないセルを確定） ---
  function applyNakedSingle(grid, cand) {
    for (let i = 0; i < 81; i++) {
      if (grid[i] === 0 && popcount(cand[i]) === 1) {
        const d = digitsInMask(cand[i])[0];
        placeDigit(grid, cand, i, d);
        return { level: 0, name: "Naked Single", cells: [i] };
      }
    }
    return null;
  }

  // --- レベル0: Hidden Single（ある数字を置けるセルがユニット内に1つだけ） ---
  function applyHiddenSingle(grid, cand) {
    for (const unit of UNITS) {
      for (let d = 1; d <= 9; d++) {
        const bit = 1 << (d - 1);
        let count = 0;
        let pos = -1;
        for (const c of unit) {
          if (grid[c] === 0 && cand[c] & bit) {
            count++;
            pos = c;
          }
        }
        if (count === 1) {
          placeDigit(grid, cand, pos, d);
          return { level: 0, name: "Hidden Single", cells: [pos] };
        }
      }
    }
    return null;
  }

  // --- レベル1: Locked Candidates - Pointing ---
  // ブロック内で、ある数字の候補が1行または1列に集まっていたら、
  // ブロック外の同じ行・列からその数字の候補を消せる
  function applyLockedCandidatesPointing(grid, cand) {
    for (const box of BOXES) {
      for (let d = 1; d <= 9; d++) {
        const bit = 1 << (d - 1);
        const cells = box.filter((c) => grid[c] === 0 && cand[c] & bit);
        if (cells.length < 2 || cells.length > 3) continue;

        const rows = new Set(cells.map((c) => Math.floor(c / 9)));
        const cols = new Set(cells.map((c) => c % 9));
        const elimCells = [];

        if (rows.size === 1) {
          const r = [...rows][0];
          for (const c of ROWS[r]) {
            if (!box.includes(c) && grid[c] === 0 && cand[c] & bit) {
              cand[c] &= ~bit;
              elimCells.push(c);
            }
          }
        }
        if (cols.size === 1) {
          const col = [...cols][0];
          for (const c of COLS[col]) {
            if (!box.includes(c) && grid[c] === 0 && cand[c] & bit) {
              cand[c] &= ~bit;
              elimCells.push(c);
            }
          }
        }
        if (elimCells.length > 0) {
          return { level: 1, name: "Pointing", cells: elimCells };
        }
      }
    }
    return null;
  }

  // --- レベル1: Locked Candidates - Claiming ---
  // 行・列内で、ある数字の候補が1つのブロックに集まっていたら、
  // そのブロック内の他の行・列からその数字の候補を消せる
  function applyLockedCandidatesClaiming(grid, cand) {
    for (const unit of [...ROWS, ...COLS]) {
      for (let d = 1; d <= 9; d++) {
        const bit = 1 << (d - 1);
        const cells = unit.filter((c) => grid[c] === 0 && cand[c] & bit);
        if (cells.length < 2 || cells.length > 3) continue;

        const boxes = new Set(cells.map((c) => BOX_OF[c]));
        if (boxes.size === 1) {
          const b = [...boxes][0];
          const elimCells = [];
          for (const c of BOXES[b]) {
            if (!unit.includes(c) && grid[c] === 0 && cand[c] & bit) {
              cand[c] &= ~bit;
              elimCells.push(c);
            }
          }
          if (elimCells.length > 0) {
            return { level: 1, name: "Claiming", cells: elimCells };
          }
        }
      }
    }
    return null;
  }

  // --- レベル2: Naked Pair ---
  // 同じユニット内に「候補が全く同じ2つの数字だけ」のセルが2つあれば、
  // ユニット内の他のセルからその2つの数字の候補を消せる
  function applyNakedPair(grid, cand) {
    for (const unit of UNITS) {
      const cells = unit.filter((c) => grid[c] === 0 && popcount(cand[c]) === 2);
      for (let i = 0; i < cells.length; i++) {
        for (let j = i + 1; j < cells.length; j++) {
          if (cand[cells[i]] !== cand[cells[j]]) continue;
          const mask = cand[cells[i]];
          const elimCells = [];
          for (const c of unit) {
            if (c !== cells[i] && c !== cells[j] && grid[c] === 0 && cand[c] & mask) {
              cand[c] &= ~mask;
              elimCells.push(c);
            }
          }
          if (elimCells.length > 0) {
            return { level: 2, name: "Naked Pair", cells: elimCells };
          }
        }
      }
    }
    return null;
  }

  // --- レベル2: Hidden Pair ---
  // 同じユニット内で、2つの数字が同じ2つのセルにしか入らないなら、
  // そのセルたちの候補を「その2つの数字だけ」に絞れる
  function applyHiddenPair(grid, cand) {
    for (const unit of UNITS) {
      const emptyCells = unit.filter((c) => grid[c] === 0);
      for (let d1 = 1; d1 <= 9; d1++) {
        const bit1 = 1 << (d1 - 1);
        const cellsD1 = emptyCells.filter((c) => cand[c] & bit1);
        if (cellsD1.length !== 2) continue;
        for (let d2 = d1 + 1; d2 <= 9; d2++) {
          const bit2 = 1 << (d2 - 1);
          const cellsD2 = emptyCells.filter((c) => cand[c] & bit2);
          if (cellsD2.length !== 2) continue;
          if (cellsD1[0] === cellsD2[0] && cellsD1[1] === cellsD2[1]) {
            const mask = bit1 | bit2;
            const elimCells = [];
            for (const c of cellsD1) {
              if (cand[c] & ~mask & FULL) {
                cand[c] &= mask;
                elimCells.push(c);
              }
            }
            if (elimCells.length > 0) {
              return { level: 2, name: "Hidden Pair", cells: elimCells };
            }
          }
        }
      }
    }
    return null;
  }

  // --- レベル2: Naked Triple ---
  // 3つのセルの候補をあわせても3種類の数字しかないなら、
  // ユニット内の他のセルからその3つの数字の候補を消せる
  function applyNakedTriple(grid, cand) {
    for (const unit of UNITS) {
      const cells = unit.filter(
        (c) => grid[c] === 0 && (popcount(cand[c]) === 2 || popcount(cand[c]) === 3)
      );
      for (let i = 0; i < cells.length; i++) {
        for (let j = i + 1; j < cells.length; j++) {
          for (let k = j + 1; k < cells.length; k++) {
            const mask = cand[cells[i]] | cand[cells[j]] | cand[cells[k]];
            if (popcount(mask) !== 3) continue;
            const elimCells = [];
            for (const c of unit) {
              if (c !== cells[i] && c !== cells[j] && c !== cells[k] && grid[c] === 0 && cand[c] & mask) {
                cand[c] &= ~mask;
                elimCells.push(c);
              }
            }
            if (elimCells.length > 0) {
              return { level: 2, name: "Naked Triple", cells: elimCells };
            }
          }
        }
      }
    }
    return null;
  }

  // --- レベル2: Hidden Triple ---
  function applyHiddenTriple(grid, cand) {
    for (const unit of UNITS) {
      const emptyCells = unit.filter((c) => grid[c] === 0);
      for (let d1 = 1; d1 <= 9; d1++) {
        for (let d2 = d1 + 1; d2 <= 9; d2++) {
          for (let d3 = d2 + 1; d3 <= 9; d3++) {
            const bit1 = 1 << (d1 - 1);
            const bit2 = 1 << (d2 - 1);
            const bit3 = 1 << (d3 - 1);
            const mask = bit1 | bit2 | bit3;
            const cells = emptyCells.filter((c) => cand[c] & mask);
            if (cells.length !== 3) continue;
            // d1,d2,d3のいずれかがこのユニット内のどの空きセルにも候補として
            // 存在しない（=すでに別のセルに確定済み）場合、本物の3数字の関係ではない
            // ので除外する（誤って正しい候補を消してしまうバグの防止）
            if (!cells.some((c) => cand[c] & bit1)) continue;
            if (!cells.some((c) => cand[c] & bit2)) continue;
            if (!cells.some((c) => cand[c] & bit3)) continue;
            const elimCells = [];
            for (const c of cells) {
              if (cand[c] & ~mask & FULL) {
                cand[c] &= mask;
                elimCells.push(c);
              }
            }
            if (elimCells.length > 0) {
              return { level: 2, name: "Hidden Triple", cells: elimCells };
            }
          }
        }
      }
    }
    return null;
  }

  // --- レベル3: X-Wing ---
  // ある数字の候補が、2つの行でそれぞれ同じ2つの列にしかない（四角形を作る）なら、
  // その2列の他の行からその数字の候補を消せる（列⇔行は対称に処理）
  function applyXWing(grid, cand) {
    for (let d = 1; d <= 9; d++) {
      const bit = 1 << (d - 1);

      // 行 -> 列
      for (let r1 = 0; r1 < 9; r1++) {
        const cols1 = ROWS[r1].filter((c) => grid[c] === 0 && cand[c] & bit).map((c) => c % 9);
        if (cols1.length !== 2) continue;
        for (let r2 = r1 + 1; r2 < 9; r2++) {
          const cols2 = ROWS[r2].filter((c) => grid[c] === 0 && cand[c] & bit).map((c) => c % 9);
          if (cols2.length !== 2) continue;
          if (cols1[0] === cols2[0] && cols1[1] === cols2[1]) {
            const elimCells = [];
            for (const col of cols1) {
              for (const c of COLS[col]) {
                const rr = Math.floor(c / 9);
                if (rr !== r1 && rr !== r2 && grid[c] === 0 && cand[c] & bit) {
                  cand[c] &= ~bit;
                  elimCells.push(c);
                }
              }
            }
            if (elimCells.length > 0) {
              return { level: 3, name: "X-Wing", cells: elimCells };
            }
          }
        }
      }

      // 列 -> 行
      for (let c1 = 0; c1 < 9; c1++) {
        const rows1 = COLS[c1].filter((c) => grid[c] === 0 && cand[c] & bit).map((c) => Math.floor(c / 9));
        if (rows1.length !== 2) continue;
        for (let c2 = c1 + 1; c2 < 9; c2++) {
          const rows2 = COLS[c2].filter((c) => grid[c] === 0 && cand[c] & bit).map((c) => Math.floor(c / 9));
          if (rows2.length !== 2) continue;
          if (rows1[0] === rows2[0] && rows1[1] === rows2[1]) {
            const elimCells = [];
            for (const row of rows1) {
              for (const c of ROWS[row]) {
                const cc = c % 9;
                if (cc !== c1 && cc !== c2 && grid[c] === 0 && cand[c] & bit) {
                  cand[c] &= ~bit;
                  elimCells.push(c);
                }
              }
            }
            if (elimCells.length > 0) {
              return { level: 3, name: "X-Wing", cells: elimCells };
            }
          }
        }
      }
    }
    return null;
  }

  // --- レベル3: Swordfish（X-Wingの3列・3行版） ---
  function applySwordfish(grid, cand) {
    for (let d = 1; d <= 9; d++) {
      const bit = 1 << (d - 1);

      // 行 -> 列
      const rowInfo = [];
      for (let r = 0; r < 9; r++) {
        const cols = ROWS[r].filter((c) => grid[c] === 0 && cand[c] & bit).map((c) => c % 9);
        if (cols.length === 2 || cols.length === 3) rowInfo.push({ r, cols });
      }
      for (let i = 0; i < rowInfo.length; i++) {
        for (let j = i + 1; j < rowInfo.length; j++) {
          for (let k = j + 1; k < rowInfo.length; k++) {
            const union = new Set([...rowInfo[i].cols, ...rowInfo[j].cols, ...rowInfo[k].cols]);
            if (union.size !== 3) continue;
            const rowsUsed = [rowInfo[i].r, rowInfo[j].r, rowInfo[k].r];
            const elimCells = [];
            for (const col of union) {
              for (const c of COLS[col]) {
                const rr = Math.floor(c / 9);
                if (!rowsUsed.includes(rr) && grid[c] === 0 && cand[c] & bit) {
                  cand[c] &= ~bit;
                  elimCells.push(c);
                }
              }
            }
            if (elimCells.length > 0) {
              return { level: 3, name: "Swordfish", cells: elimCells };
            }
          }
        }
      }

      // 列 -> 行
      const colInfo = [];
      for (let c = 0; c < 9; c++) {
        const rows = COLS[c].filter((cc) => grid[cc] === 0 && cand[cc] & bit).map((cc) => Math.floor(cc / 9));
        if (rows.length === 2 || rows.length === 3) colInfo.push({ c, rows });
      }
      for (let i = 0; i < colInfo.length; i++) {
        for (let j = i + 1; j < colInfo.length; j++) {
          for (let k = j + 1; k < colInfo.length; k++) {
            const union = new Set([...colInfo[i].rows, ...colInfo[j].rows, ...colInfo[k].rows]);
            if (union.size !== 3) continue;
            const colsUsed = [colInfo[i].c, colInfo[j].c, colInfo[k].c];
            const elimCells = [];
            for (const row of union) {
              for (const c of ROWS[row]) {
                const cc = c % 9;
                if (!colsUsed.includes(cc) && grid[c] === 0 && cand[c] & bit) {
                  cand[c] &= ~bit;
                  elimCells.push(c);
                }
              }
            }
            if (elimCells.length > 0) {
              return { level: 3, name: "Swordfish", cells: elimCells };
            }
          }
        }
      }
    }
    return null;
  }

  // --- レベル4: XY-Wing ---
  // 候補が2つだけのセル(pivot)と、それぞれ1つの数字を共有する2つの候補2セル(pincer)を見つけ、
  // 両方のpincerが共有するもう1つの数字を、両方から見えるセルから消せる
  function applyXYWing(grid, cand) {
    const bivalue = [];
    for (let i = 0; i < 81; i++) {
      if (grid[i] === 0 && popcount(cand[i]) === 2) bivalue.push(i);
    }

    for (const pivot of bivalue) {
      const pivotDigits = digitsInMask(cand[pivot]); // [X, Y]
      const neighbors = bivalue.filter((c) => arePeers(c, pivot));

      for (const p1 of neighbors) {
        const d1 = digitsInMask(cand[p1]);
        const shared1 = d1.filter((x) => pivotDigits.includes(x));
        if (shared1.length !== 1) continue;
        const z1 = d1.find((x) => !pivotDigits.includes(x));
        if (z1 === undefined) continue;

        for (const p2 of neighbors) {
          if (p2 === p1) continue;
          const d2 = digitsInMask(cand[p2]);
          const shared2 = d2.filter((x) => pivotDigits.includes(x));
          if (shared2.length !== 1) continue;
          if (shared1[0] === shared2[0]) continue; // p1とp2はpivotの異なる数字を共有する必要がある
          const z2 = d2.find((x) => !pivotDigits.includes(x));
          if (z2 === undefined || z2 !== z1) continue;

          const Z = z1;
          const bitZ = 1 << (Z - 1);
          const elimCells = [];
          for (let c = 0; c < 81; c++) {
            if (c === pivot || c === p1 || c === p2) continue;
            if (grid[c] === 0 && cand[c] & bitZ && arePeers(c, p1) && arePeers(c, p2)) {
              cand[c] &= ~bitZ;
              elimCells.push(c);
            }
          }
          if (elimCells.length > 0) {
            return { level: 4, name: "XY-Wing", cells: elimCells };
          }
        }
      }
    }
    return null;
  }

  // --- レベル3: Simple Coloring（チェーンによる消去） ---
  // ある数字について「このユニットではこの2セルにしか入らない」という関係（共役ペア）を
  // 鎖状につなぎ、2色に塗り分ける。
  //   ルール1: 同じ色のセルが同じユニットに2つ -> その色は全て候補から除外
  //   ルール2: 鎖の外のセルが、色違いの2セルの両方から見えている -> その数字を除外
  function applySimpleColoring(grid, cand) {
    for (let d = 1; d <= 9; d++) {
      const bit = 1 << (d - 1);
      const cellsWithD = [];
      for (let i = 0; i < 81; i++) {
        if (grid[i] === 0 && cand[i] & bit) cellsWithD.push(i);
      }
      if (cellsWithD.length < 4) continue;

      // 共役ペア（あるユニット内でその数字の候補が2セルだけ）から隣接関係を作る
      const adj = new Map();
      for (const c of cellsWithD) adj.set(c, new Set());
      for (const unit of UNITS) {
        const cells = unit.filter((c) => grid[c] === 0 && cand[c] & bit);
        if (cells.length === 2) {
          adj.get(cells[0]).add(cells[1]);
          adj.get(cells[1]).add(cells[0]);
        }
      }

      const visited = new Set();
      for (const start of cellsWithD) {
        if (visited.has(start)) continue;
        // BFSで連結成分を求めつつ2色に塗り分ける
        const color = new Map();
        color.set(start, 0);
        visited.add(start);
        const queue = [start];
        const comp = [start];
        while (queue.length) {
          const cur = queue.shift();
          for (const next of adj.get(cur)) {
            if (!visited.has(next)) {
              visited.add(next);
              color.set(next, 1 - color.get(cur));
              queue.push(next);
              comp.push(next);
            }
          }
        }
        if (comp.length < 4) continue;

        const color0 = comp.filter((c) => color.get(c) === 0);
        const color1 = comp.filter((c) => color.get(c) === 1);

        // ルール1: 同じ色が同じユニット内に2つ -> その色を全部除外
        for (const grp of [color0, color1]) {
          let conflict = false;
          for (let i = 0; i < grp.length && !conflict; i++) {
            for (let j = i + 1; j < grp.length; j++) {
              if (arePeers(grp[i], grp[j])) {
                conflict = true;
                break;
              }
            }
          }
          if (conflict) {
            const elimCells = [];
            for (const c of grp) {
              cand[c] &= ~bit;
              elimCells.push(c);
            }
            if (elimCells.length > 0) {
              return { level: 3, name: "Simple Coloring", cells: elimCells };
            }
          }
        }

        // ルール2: 鎖の外のセルが両方の色から見えている -> そのセルから候補を除外
        const elimCells = [];
        for (let c = 0; c < 81; c++) {
          if (grid[c] !== 0 || !(cand[c] & bit) || comp.includes(c)) continue;
          let sees0 = false;
          let sees1 = false;
          for (const cc of color0) if (arePeers(c, cc)) sees0 = true;
          for (const cc of color1) if (arePeers(c, cc)) sees1 = true;
          if (sees0 && sees1) {
            cand[c] &= ~bit;
            elimCells.push(c);
          }
        }
        if (elimCells.length > 0) {
          return { level: 3, name: "Simple Coloring", cells: elimCells };
        }
      }
    }
    return null;
  }

  // --- レベル3: Unique Rectangle (Type 1) ---
  // 2行x2列の4セルが2つのブロックにまたがり、3セルの候補が完全に同じ2数字{a,b}で、
  // 残り1セル(roof)がそれに加えて他の候補も持つ場合、roofから a,b を消せる
  // (そうしないと盤面の解が2つになってしまう「危険な形」のため)
  function applyUniqueRectangle(grid, cand) {
    for (let r1 = 0; r1 < 9; r1++) {
      for (let r2 = r1 + 1; r2 < 9; r2++) {
        for (let c1 = 0; c1 < 9; c1++) {
          for (let c2 = c1 + 1; c2 < 9; c2++) {
            const cells = [r1 * 9 + c1, r1 * 9 + c2, r2 * 9 + c1, r2 * 9 + c2];
            if (cells.some((c) => grid[c] !== 0)) continue;

            const boxes = new Set(cells.map((c) => BOX_OF[c]));
            if (boxes.size !== 2) continue; // 2ブロックにまたがる長方形のみ対象

            const masks = cells.map((c) => cand[c]);
            const pairIdx = [];
            for (let i = 0; i < 4; i++) if (popcount(masks[i]) === 2) pairIdx.push(i);
            if (pairIdx.length < 3) continue;

            const baseMask = masks[pairIdx[0]];
            const sameMaskIdx = pairIdx.filter((i) => masks[i] === baseMask);
            if (sameMaskIdx.length !== 3) continue;

            const roofIdx = [0, 1, 2, 3].find((i) => !sameMaskIdx.includes(i));
            const roofMask = masks[roofIdx];
            if ((roofMask & baseMask) === baseMask && roofMask !== baseMask) {
              const roof = cells[roofIdx];
              cand[roof] &= ~baseMask;
              return { level: 3, name: "Unique Rectangle", cells: [roof] };
            }
          }
        }
      }
    }
    return null;
  }

  // --- レベル4: XY-Chain ---
  // XY-Wingを鎖状に長く繋いだもの。候補が2つだけのセルを数字でリンクしてたどっていき、
  // 出発点と終着点が同じ数字Zを共有していれば、両方から見えるセルからZを消せる
  function applyXYChain(grid, cand) {
    const bivalue = [];
    for (let i = 0; i < 81; i++) {
      if (grid[i] === 0 && popcount(cand[i]) === 2) bivalue.push(i);
    }
    const MAX_DEPTH = 6;

    function dfsChain(start, current, neededDigit, Z, visited, depth) {
      const bitNeeded = 1 << (neededDigit - 1);
      for (const next of bivalue) {
        if (visited.has(next)) continue;
        if (!arePeers(current, next)) continue;
        if (!(cand[next] & bitNeeded)) continue;
        const otherDigit = digitsInMask(cand[next]).find((x) => x !== neededDigit);
        if (otherDigit === undefined) continue;

        if (depth >= 2 && otherDigit === Z) {
          const bitZ = 1 << (Z - 1);
          const elimCells = [];
          for (let c = 0; c < 81; c++) {
            if (grid[c] !== 0 || !(cand[c] & bitZ)) continue;
            if (visited.has(c) || c === next) continue;
            if (arePeers(c, start) && arePeers(c, next)) {
              cand[c] &= ~bitZ;
              elimCells.push(c);
            }
          }
          if (elimCells.length > 0) {
            return { level: 4, name: "XY-Chain", cells: elimCells };
          }
        }

        if (depth < MAX_DEPTH) {
          visited.add(next);
          const result = dfsChain(start, next, otherDigit, Z, visited, depth + 1);
          visited.delete(next);
          if (result) return result;
        }
      }
      return null;
    }

    for (const start of bivalue) {
      const startDigits = digitsInMask(cand[start]);
      for (const Z of startDigits) {
        const linkDigit = startDigits.find((x) => x !== Z);
        const visited = new Set([start]);
        const found = dfsChain(start, start, linkDigit, Z, visited, 1);
        if (found) return found;
      }
    }
    return null;
  }

  // レベル0〜4のテクニックを「易しい順」に1回だけ試す
  function applyBasicTechniques(grid, cand) {
    return (
      applyNakedSingle(grid, cand) ||
      applyHiddenSingle(grid, cand) ||
      applyLockedCandidatesPointing(grid, cand) ||
      applyLockedCandidatesClaiming(grid, cand) ||
      applyNakedPair(grid, cand) ||
      applyHiddenPair(grid, cand) ||
      applyNakedTriple(grid, cand) ||
      applyHiddenTriple(grid, cand) ||
      applyXWing(grid, cand) ||
      applySwordfish(grid, cand) ||
      applySimpleColoring(grid, cand) ||
      applyUniqueRectangle(grid, cand) ||
      applyXYWing(grid, cand) ||
      applyXYChain(grid, cand)
    );
  }

  // 盤面に矛盾（候補が0個の空きセル）があるか
  function hasContradiction(grid, cand) {
    for (let i = 0; i < 81; i++) {
      if (grid[i] === 0 && cand[i] === 0) return true;
    }
    return false;
  }

  // 与えられた状態から、レベル0〜4のテクニックだけで可能な限り進める（矛盾チェック付き）
  function propagateBasic(grid, cand, maxSteps) {
    for (let i = 0; i < maxSteps; i++) {
      if (hasContradiction(grid, cand)) return { contradiction: true };
      const result = applyBasicTechniques(grid, cand);
      if (!result) break;
    }
    return { contradiction: hasContradiction(grid, cand) };
  }

  // --- レベル5: Forcing Chain ---
  // あるセルについて、候補の数字を1つずつ仮に置いて先まで論理的に進めてみる。
  //   - 1つだけ矛盾しない数字が残るなら、それが確定する
  //   - 複数の数字が矛盾しない場合でも、それら全パターンに共通する確定/消去があれば、それを反映する
  // これは「当て推量」ではなく、考えられる全パターンを調べ尽くして結論を出す論理的な手法
  function applyForcingChain(grid, cand) {
    const emptyCells = [];
    for (let i = 0; i < 81; i++) {
      if (grid[i] === 0) emptyCells.push(i);
    }
    // 候補数が少ないセルから試す方が、矛盾が見つかりやすく効率的
    emptyCells.sort((a, b) => popcount(cand[a]) - popcount(cand[b]));

    for (const cell of emptyCells) {
      const digits = digitsInMask(cand[cell]);
      if (digits.length < 2) continue;
      const branches = [];

      for (const d of digits) {
        const g2 = grid.slice();
        const c2 = cand.slice();
        placeDigit(g2, c2, cell, d);
        const { contradiction } = propagateBasic(g2, c2, 15);
        if (!contradiction) {
          branches.push({ d, grid: g2, cand: c2 });
        }
      }

      if (branches.length === 0) continue; // ここに到達したら盤面自体が矛盾(通常は起きない)

      // 矛盾しない数字が1つだけ -> それが確定
      if (branches.length === 1) {
        placeDigit(grid, cand, cell, branches[0].d);
        return { level: 5, name: "Forcing Chain", cells: [cell] };
      }

      // 複数の数字が矛盾しない場合、全パターンに共通する確定/消去を探す
      // 共通の確定セル
      for (let c = 0; c < 81; c++) {
        if (grid[c] !== 0) continue;
        const firstVal = branches[0].grid[c];
        if (firstVal === 0) continue;
        if (branches.every((b) => b.grid[c] === firstVal)) {
          placeDigit(grid, cand, c, firstVal);
          return { level: 5, name: "Forcing Chain", cells: [c] };
        }
      }

      // 共通の候補消去
      const elimCells = [];
      for (let c = 0; c < 81; c++) {
        if (grid[c] !== 0) continue;
        let commonRemoved = FULL;
        for (const b of branches) {
          const removed = cand[c] & ~b.cand[c] & FULL;
          commonRemoved &= removed;
        }
        if (commonRemoved) {
          cand[c] &= ~commonRemoved;
          elimCells.push(c);
        }
      }
      if (elimCells.length > 0) {
        return { level: 5, name: "Forcing Chain", cells: elimCells };
      }
    }
    return null;
  }

  // 上記テクニックを「易しい順」に全部試し、解けるところまで解く
  // guess（当て推量）は一切行わない
  function logicalSolve(board) {
    const grid = board.slice();
    const cand = computeCandidates(grid);
    const steps = [];

    while (grid.includes(0)) {
      const result = applyBasicTechniques(grid, cand) || applyForcingChain(grid, cand);

      if (!result) {
        return { solved: false, grid, steps };
      }
      steps.push(result);
    }
    return { solved: true, grid, steps };
  }

  // ===== 4. 難易度判定 =====
  // 易: Naked/Hidden Single のみ
  // 中: + Pointing/Claiming, Naked/Hidden Pair(Triple含む)
  // 難: + X-Wing/Swordfish/XY-Wing を少しだけ使う
  // 鬼: 高度なテクニックを多用する
  const LEVELS = ["easy", "medium", "hard", "extreme"];
  const LEVEL_LABEL = { easy: "易", medium: "中", hard: "難", extreme: "鬼" };

  function rateDifficulty(board) {
    const { solved, steps } = logicalSolve(board);
    if (!solved) {
      return { solved: false, level: null, steps };
    }
    const maxLevel = steps.reduce((m, s) => Math.max(m, s.level), 0);
    const advancedCount = steps.filter((s) => s.level >= 3).length;

    // maxLevel: 0=Singles, 1=Locked Candidates, 2=Pair/Triple,
    //           3-4=X-Wing/Swordfish/Coloring/UR/XY-Wing/XY-Chain, 5=Forcing Chain
    let level;
    if (maxLevel === 0) {
      level = "easy";
    } else if (maxLevel <= 2) {
      level = "medium";
    } else if (maxLevel <= 4) {
      level = "hard";
    } else {
      level = "extreme";
    }

    return { solved: true, level, maxLevel, advancedCount, stepCount: steps.length, steps };
  }

  // ===== 5. 問題生成 =====
  // 難易度ごとの「目標の空きセル数」の範囲（81マス中いくつ空けるか）
  const EMPTY_RANGES = {
    easy: [30, 38],
    medium: [42, 50],
    hard: [50, 58],
    extreme: [54, 62],
  };

  function levelDistance(a, b) {
    return Math.abs(LEVELS.indexOf(a) - LEVELS.indexOf(b));
  }

  // 難易度ごとの試行回数の目安
  // (「中」はsingleだけで解ける「易」になりやすく、当たる確率が低いため試行回数を増やす)
  const DEFAULT_ATTEMPTS = {
    easy: 60,
    medium: 400,
    hard: 100,
    extreme: 150,
  };

  // 完成盤からセルを1つずつ減らしていき、一意解を保ったまま指定難易度に近づける
  function generatePuzzle(difficulty, maxAttempts = DEFAULT_ATTEMPTS[difficulty]) {
    let best = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const solved = generateSolvedBoard();
      const puzzle = solved.slice();
      const order = shuffle([...Array(81).keys()]);
      const [minE, maxE] = EMPTY_RANGES[difficulty];
      const targetEmpty = minE + Math.floor(Math.random() * (maxE - minE + 1));

      let emptyCount = 0;
      for (const idx of order) {
        if (emptyCount >= targetEmpty) break;
        const backup = puzzle[idx];
        puzzle[idx] = 0;
        if (countSolutions(puzzle, 2) === 1) {
          emptyCount++;
        } else {
          puzzle[idx] = backup;
        }
      }

      const rating = rateDifficulty(puzzle);
      if (!rating.solved) continue; // 当て推量が必要 -> 不採用

      if (rating.level === difficulty) {
        return { puzzle, solution: solved, rating, givens: 81 - emptyCount };
      }

      const candidate = { puzzle, solution: solved, rating, givens: 81 - emptyCount };
      if (!best || levelDistance(rating.level, difficulty) < levelDistance(best.rating.level, difficulty)) {
        best = candidate;
      }
    }

    return best;
  }

  // ===== 公開API =====
  const Sudoku = {
    FULL,
    UNITS,
    ROWS,
    COLS,
    BOXES,
    BOX_OF,
    PEERS,
    LEVELS,
    LEVEL_LABEL,
    shuffle,
    isValidPlacement,
    generateSolvedBoard,
    countSolutions,
    computeCandidates,
    logicalSolve,
    rateDifficulty,
    generatePuzzle,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Sudoku;
  } else {
    global.Sudoku = Sudoku;
  }
})(typeof window !== "undefined" ? window : globalThis);
