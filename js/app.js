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
  let hintToastTimer = null;

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

  // ----- 吹き出しでメッセージを一時的に表示する -----
  function showHintToast(message) {
    hintToast.textContent = message;
    hintToast.classList.remove("hidden");
    clearTimeout(hintToastTimer);
    hintToastTimer = setTimeout(() => {
      hintToast.classList.add("hidden");
    }, 3200);
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

    // 間違って埋めているマスは無視して、論理的に次の一手を考える
    const hintBoard = state.board.map((v, i) => (v !== 0 && v === state.solution[i] ? v : 0));
    if (!hintBoard.includes(0)) return;

    let technique = null;
    if (target === null) {
      const step = Sudoku.nextFill(hintBoard);
      if (step) {
        target = step.cell;
        technique = step.technique;
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

    const label = technique ? Sudoku.TECHNIQUE_LABEL[technique] || technique : null;
    showHintToast(label ? `ヒント: ${label} でこのマスが埋まります` : "ヒント: このマスに数字を入れました");
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
