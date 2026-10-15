// ナンプレ画面の動作をまとめたファイル
// sudoku-engine.js が用意した Sudoku オブジェクトを使って、
// 盤面の表示・入力・保存などを行う。
(function () {
  "use strict";

  const STORAGE_KEY = "sudoku-save-v1";

  // ----- 画面の要素を取得 -----
  const boardEl = document.getElementById("board");
  const difficultySelect = document.getElementById("difficulty-select");
  const newGameBtn = document.getElementById("new-game-btn");
  const timerEl = document.getElementById("timer");
  const overlay = document.getElementById("overlay");
  const overlayMessage = document.getElementById("overlay-message");
  const overlayClose = document.getElementById("overlay-close");
  const undoBtn = document.getElementById("undo-btn");
  const redoBtn = document.getElementById("redo-btn");
  const pencilBtn = document.getElementById("pencil-btn");
  const eraseBtn = document.getElementById("erase-btn");
  const hintBtn = document.getElementById("hint-btn");
  const hintToast = document.getElementById("hint-toast");
  const numpad = document.getElementById("numpad");

  let state = null; // 現在のゲームの状態をまとめて持つオブジェクト
  let cellEls = []; // 81個のマスのDOM要素
  let timerInterval = null;

  // ----- 盤面のマスを81個作る（最初に1回だけ実行） -----
  function buildBoardDOM() {
    boardEl.innerHTML = "";
    cellEls = [];
    for (let i = 0; i < 81; i++) {
      const r = Math.floor(i / 9);
      const c = i % 9;
      const cell = document.createElement("div");
      cell.className = "cell";
      if (c === 2 || c === 5) cell.classList.add("block-right");
      if (r === 2 || r === 5) cell.classList.add("block-bottom");

      // 候補メモ（鉛筆書き）を表示する3x3の小さなマス
      const notes = document.createElement("div");
      notes.className = "notes";
      for (let d = 1; d <= 9; d++) {
        notes.appendChild(document.createElement("span"));
      }
      cell.appendChild(notes);

      // 確定した数字を表示する部分
      const value = document.createElement("span");
      value.className = "value";
      cell.appendChild(value);

      cell.addEventListener("click", () => onCellClick(i));
      boardEl.appendChild(cell);
      cellEls.push(cell);
    }
  }

  // ----- 新しいゲームの状態を作る -----
  function newGameState(difficulty, generated) {
    return {
      difficulty,
      puzzle: generated.puzzle.slice(),
      solution: generated.solution.slice(),
      board: generated.puzzle.slice(),
      notes: new Array(81).fill(0),
      given: generated.puzzle.map((v) => v !== 0),
      selected: null,
      pencilMode: false,
      elapsed: 0,
      solved: false,
      history: [],
      future: [],
    };
  }

  // ----- 保存・読み込み（localStorage） -----
  function save() {
    if (!state) return;
    const data = {
      difficulty: state.difficulty,
      puzzle: state.puzzle,
      solution: state.solution,
      board: state.board,
      notes: state.notes,
      given: state.given,
      pencilMode: state.pencilMode,
      elapsed: state.elapsed,
      solved: state.solved,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      data.selected = null;
      data.history = [];
      data.future = [];
      return data;
    } catch (e) {
      return null;
    }
  }

  // ----- 元に戻す／やり直す（undo/redo） -----
  function pushHistory() {
    state.history.push({ board: state.board.slice(), notes: state.notes.slice() });
    if (state.history.length > 200) state.history.shift();
    state.future = [];
  }

  function undo() {
    if (!state || state.history.length === 0) return;
    state.future.push({ board: state.board.slice(), notes: state.notes.slice() });
    const prev = state.history.pop();
    state.board = prev.board;
    state.notes = prev.notes;
    afterChange();
  }

  function redo() {
    if (!state || state.future.length === 0) return;
    state.history.push({ board: state.board.slice(), notes: state.notes.slice() });
    const next = state.future.pop();
    state.board = next.board;
    state.notes = next.notes;
    afterChange();
  }

  // ----- ルール違反（同じ数字の重複）を調べる -----
  function computeConflicts() {
    const conflicts = new Array(81).fill(false);
    for (const unit of Sudoku.UNITS) {
      const seenAt = new Map();
      for (const i of unit) {
        const v = state.board[i];
        if (v === 0) continue;
        if (!seenAt.has(v)) seenAt.set(v, []);
        seenAt.get(v).push(i);
      }
      for (const idxs of seenAt.values()) {
        if (idxs.length > 1) {
          for (const i of idxs) conflicts[i] = true;
        }
      }
    }
    return conflicts;
  }

  function formatTime(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  // ----- 画面を最新の状態に描き直す -----
  function render() {
    const conflicts = computeConflicts();
    const sel = state.selected;
    const selectedValue = sel !== null ? state.board[sel] : 0;

    for (let i = 0; i < 81; i++) {
      const cell = cellEls[i];
      const value = state.board[i];
      const valueEl = cell.querySelector(".value");
      const notesEl = cell.querySelector(".notes");

      cell.classList.toggle("given", state.given[i]);
      cell.classList.toggle("selected", i === sel);
      cell.classList.toggle("conflict", conflicts[i]);

      const isPeer = sel !== null && i !== sel && Sudoku.PEERS[sel].has(i);
      cell.classList.toggle("peer", isPeer);

      const isSameNumber = selectedValue !== 0 && value === selectedValue && i !== sel;
      cell.classList.toggle("same-number", isSameNumber);

      if (value !== 0) {
        valueEl.textContent = String(value);
        notesEl.style.display = "none";
      } else {
        valueEl.textContent = "";
        notesEl.style.display = "grid";
        const mask = state.notes[i];
        const spans = notesEl.children;
        for (let d = 1; d <= 9; d++) {
          spans[d - 1].textContent = mask & (1 << (d - 1)) ? String(d) : "";
        }
      }
    }

    undoBtn.disabled = state.history.length === 0;
    redoBtn.disabled = state.future.length === 0;
    pencilBtn.classList.toggle("active", state.pencilMode);

    // すでに9個全部埋まっている数字はパッドを薄く表示
    const counts = new Array(10).fill(0);
    for (const v of state.board) {
      if (v !== 0) counts[v]++;
    }
    numpad.querySelectorAll(".num-btn").forEach((btn) => {
      const d = Number(btn.dataset.num);
      btn.classList.toggle("used", counts[d] >= 9);
    });

    timerEl.textContent = formatTime(state.elapsed);
  }

  // ----- 値や状態が変わった後の共通処理 -----
  function afterChange() {
    checkWin();
    render();
    save();
  }

  function checkWin() {
    if (state.solved) return;
    if (state.board.includes(0)) return;
    const conflicts = computeConflicts();
    if (conflicts.some(Boolean)) return;
    state.solved = true;
    stopTimer();
    showOverlay(`クリア！\nタイム: ${formatTime(state.elapsed)}`, true);
  }

  // ----- オーバーレイ（画面中央のメッセージ） -----
  function showOverlay(message, showCloseButton) {
    overlayMessage.textContent = message;
    overlay.classList.remove("hidden");
    overlayClose.classList.toggle("hidden", !showCloseButton);
  }

  function hideOverlay() {
    overlay.classList.add("hidden");
  }

  // ----- タイマー -----
  function startTimer() {
    stopTimer();
    timerInterval = setInterval(() => {
      if (!state || state.solved) return;
      state.elapsed++;
      timerEl.textContent = formatTime(state.elapsed);
      save();
    }, 1000);
  }

  function stopTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
  }

  // ----- マスを選ぶ -----
  function onCellClick(i) {
    if (!state || state.solved) return;
    state.selected = i;
    render();
  }

  // ----- 数字パッドを押した -----
  function onNumber(d) {
    if (!state || state.solved) return;
    const sel = state.selected;
    if (sel === null || state.given[sel]) return;

    pushHistory();

    if (state.pencilMode) {
      // メモモード: その数字の候補メモを付け外しする
      state.notes[sel] ^= 1 << (d - 1);
    } else if (state.board[sel] === d) {
      // 同じ数字をもう一度押したら消す
      state.board[sel] = 0;
    } else {
      state.board[sel] = d;
      state.notes[sel] = 0;
      // 置いた数字と同じ候補メモを、同じ行・列・ブロックから消す
      for (const p of Sudoku.PEERS[sel]) {
        state.notes[p] &= ~(1 << (d - 1));
      }
    }

    afterChange();
  }

  // ----- 消去ボタン -----
  function onErase() {
    if (!state || state.solved) return;
    const sel = state.selected;
    if (sel === null || state.given[sel]) return;
    if (state.board[sel] === 0 && state.notes[sel] === 0) return;

    pushHistory();
    state.board[sel] = 0;
    state.notes[sel] = 0;
    afterChange();
  }

  // ----- ヒントの解説文づくり -----
  // マス番号だと初心者に場所が伝わらないので、「上から何行目・左から何列目」で言う
  function cellPositionText(i) {
    return `上から${Math.floor(i / 9) + 1}行目・左から${(i % 9) + 1}列目`;
  }

  // 解き方の名前とひとこと説明を1行にまとめる
  function techniqueLine(name) {
    const label = Sudoku.TECHNIQUE_LABEL[name] || name;
    const desc = Sudoku.TECHNIQUE_DESCRIPTION[name];
    return desc ? `【${label}】${desc}` : `【${label}】`;
  }

  // 今の盤面だけを見て、そのマスが「シングル」で決まる具体的な理由を探す
  // （見た目どおりの盤面で説明できるので、初心者でも自分で確かめられる）
  function findSingleReason(board, cell, d) {
    const cand = Sudoku.computeCandidates(board);
    const bit = 1 << (d - 1);
    if (cand[cell] === bit) {
      return { technique: 'Naked Single', detail: `このマスと同じ行・列・ブロックには ${d} 以外の数字がすべて出ているので、入れられるのは ${d} だけです。` };
    }
    const units = [
      ['行（横の並び）', Sudoku.ROWS[Math.floor(cell / 9)]],
      ['列（縦の並び）', Sudoku.COLS[cell % 9]],
      ['ブロック', Sudoku.BOXES[Sudoku.BOX_OF[cell]]],
    ];
    for (const [unitName, unit] of units) {
      const spots = unit.filter((c) => board[c] === 0 && cand[c] & bit);
      if (spots.length === 1) {
        return { technique: 'Hidden Single', detail: `この${unitName}の中で ${d} を入れられるマスはここだけです。ほかの空きマスは、同じ行・列・ブロックにすでに ${d} があるため入れられません。` };
      }
    }
    return null;
  }

  // 候補を減らす手順をはさんでから決まる場合の説明
  function explainLogicStep(step) {
    const lines = [];
    if (step.preSteps.length > 0) {
      lines.push('まず、次の解き方で候補を減らします。');
      for (const name of step.preSteps) lines.push(`・${techniqueLine(name)}`);
      lines.push('候補が減った結果、次の解き方でこのマスが決まります。');
    }
    lines.push(techniqueLine(step.technique));
    return lines;
  }

  // ヒントの見出しと解説の各行を作る
  function buildHintExplanation(board, target, d, step, fromSelection) {
    const title = `ヒント: ${cellPositionText(target)}に ${d} が入ります`;
    let lines;
    const single = !step || step.preSteps.length === 0 ? findSingleReason(board, target, d) : null;
    if (single) {
      lines = [techniqueLine(single.technique), single.detail];
    } else if (step) {
      lines = explainLogicStep(step);
    } else if (fromSelection) {
      lines = [
        '選んだマスは、今の盤面からはまだすぐには決まらないため、答えだけを入れました。',
        '理由つきのヒントを見たいときは、数字の入っているマスを選んでからヒントを押してください。',
      ];
    } else {
      lines = ['このアプリが知っている解き方では次の一手が見つからなかったため、答えを1つ入れました。'];
    }
    lines.push('※ブロック＝太線で囲まれた3×3の枠、候補＝そのマスに入る可能性のある数字');
    return { title, lines };
  }

  // ----- 解説の吹き出しを表示する -----
  // 解説は長めなので自動では消さず、タップで閉じるまで読めるようにする。
  // 答えのマスが隠れないよう、マスが上半分なら盤面の下側、下半分なら上側に出す
  function showHintToast({ title, lines }, target) {
    hintToast.replaceChildren();
    const titleEl = document.createElement('p');
    titleEl.className = 'hint-title';
    titleEl.textContent = title;
    hintToast.appendChild(titleEl);
    for (const line of lines) {
      const lineEl = document.createElement('p');
      lineEl.className = 'hint-line';
      lineEl.textContent = line;
      hintToast.appendChild(lineEl);
    }
    const closeBtn = document.createElement('button');
    closeBtn.className = 'hint-close';
    closeBtn.textContent = '閉じる';
    hintToast.appendChild(closeBtn);
    hintToast.classList.toggle('at-bottom', Math.floor(target / 9) < 5);
    hintToast.classList.remove('hidden');
    hintToast.scrollTop = 0;
  }

  function hideHintToast() {
    hintToast.classList.add('hidden');
  }

  // ----- ヒントボタン -----
  // 選択中のマスがあればそのマスを、なければ論理的に埋められる中で
  // 一番わかりやすい（易しいテクニックで解ける）マスを選んで、正解の数字を埋める
  function onHint() {
    if (!state || state.solved) return;

    let target = state.selected;
    if (target === null || state.given[target] || state.board[target] === state.solution[target]) {
      target = null;
    }
    const fromSelection = target !== null;

    // 間違って埋めているマスは無視して、論理的に次の一手を考える
    const hintBoard = state.board.map((v, i) => (v !== 0 && v === state.solution[i] ? v : 0));
    if (!hintBoard.includes(0)) return;

    let step = null;
    if (target === null) {
      step = Sudoku.nextFill(hintBoard);
      if (step) {
        target = step.cell;
      } else {
        target = hintBoard.findIndex((v) => v === 0);
      }
    }

    pushHistory();
    const d = state.solution[target];
    state.board[target] = d;
    state.notes[target] = 0;
    for (const p of Sudoku.PEERS[target]) {
      state.notes[p] &= ~(1 << (d - 1));
    }
    state.selected = target;

    afterChange();

    showHintToast(buildHintExplanation(hintBoard, target, d, step, fromSelection), target);
  }

  // ----- メモモードの切り替え -----
  function onTogglePencil() {
    if (!state) return;
    state.pencilMode = !state.pencilMode;
    render();
    save();
  }

  // ----- 新しいパズルを生成して開始する -----
  function startNewGame(difficulty) {
    // 生成には少し時間がかかることがあるので、
    // 先に「生成中…」を表示してから処理を始める
    showOverlay("生成中…", false);
    // 前のパズルの解説が残っていると混乱するので閉じておく
    hideHintToast();
    setTimeout(() => {
      const generated = Sudoku.generatePuzzle(difficulty);
      state = newGameState(difficulty, generated);
      render();
      hideOverlay();
      startTimer();
      save();
    }, 50);
  }

  // ----- キーボード操作（PCでの確認用） -----
  function onKeyDown(e) {
    if (!state || state.solved || state.selected === null) return;

    if (/^[1-9]$/.test(e.key)) {
      onNumber(Number(e.key));
    } else if (e.key === "Backspace" || e.key === "Delete") {
      onErase();
    } else if (e.key.startsWith("Arrow")) {
      moveSelection(e.key);
      e.preventDefault();
    }
  }

  function moveSelection(key) {
    let r = Math.floor(state.selected / 9);
    let c = state.selected % 9;
    if (key === "ArrowUp") r = (r + 8) % 9;
    if (key === "ArrowDown") r = (r + 1) % 9;
    if (key === "ArrowLeft") c = (c + 8) % 9;
    if (key === "ArrowRight") c = (c + 1) % 9;
    state.selected = r * 9 + c;
    render();
  }

  // ----- 初期化 -----
  function init() {
    buildBoardDOM();

    numpad.querySelectorAll(".num-btn").forEach((btn) => {
      btn.addEventListener("click", () => onNumber(Number(btn.dataset.num)));
    });
    undoBtn.addEventListener("click", undo);
    redoBtn.addEventListener("click", redo);
    pencilBtn.addEventListener("click", onTogglePencil);
    eraseBtn.addEventListener("click", onErase);
    hintBtn.addEventListener("click", onHint);
    // 吹き出しのどこをタップしても閉じられるようにする（閉じるボタンが小さく感じても困らないように）
    hintToast.addEventListener('click', hideHintToast);
    newGameBtn.addEventListener("click", () => startNewGame(difficultySelect.value));
    overlayClose.addEventListener("click", hideOverlay);
    document.addEventListener("keydown", onKeyDown);

    const saved = load();
    if (saved && Array.isArray(saved.board) && !saved.solved) {
      state = saved;
      difficultySelect.value = state.difficulty;
      render();
      startTimer();
    } else {
      startNewGame(difficultySelect.value);
    }
  }

  // ----- オフライン対応（Service Worker登録） -----
  // file:// で直接開いた場合はService Workerが使えないので、http(s)の場合だけ登録する
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol === "file:") return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    });
  }

  init();
  registerServiceWorker();
})();
