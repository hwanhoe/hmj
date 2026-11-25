(() => {
  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 10;
  const LADDER_ROWS = 14;

  const PATH_COLORS = [
    '#03C75A', // Naver Green
    '#3182F6', // Blue
    '#F04452', // Red
    '#FF8A00', // Orange
    '#8B5CF6', // Purple
    '#00B8D9', // Cyan
    '#EC4899', // Pink
    '#14B8A6', // Teal
    '#EAB308', // Amber
    '#6366F1', // Indigo
  ];

  const DEFAULT_RESULTS = [
    '당첨',
    '꽝',
    '커피 쏘기',
    '면제',
    '벌칙',
    '간식',
    '통과',
    '재도전',
    '1등',
    '보너스',
  ];

  const state = {
    count: 4,
    mode: 'setup', // 'setup' | 'play'
    players: [],
    results: [],
    rungs: [], // array of rows: each row is array of booleans of length (count - 1)
    paths: [], // precomputed path steps per start col: { waypoints: [{col, rowRatio}], endCol }
    revealed: new Set(),
    highlightedCol: null,
    activeAnim: null, // { col, progress, rafId }
    blind: false,
  };

  // DOM Elements
  const btnDecrease = document.getElementById('btn-decrease');
  const btnIncrease = document.getElementById('btn-increase');
  const countDisplay = document.getElementById('player-count-display');
  const blindToggleWrap = document.getElementById('blind-toggle-wrap');
  const chkBlind = document.getElementById('chk-blind');
  const blindCurtain = document.getElementById('blind-curtain');

  const btnResetInputs = document.getElementById('btn-reset-inputs');
  const btnStart = document.getElementById('btn-start');
  const btnShowAll = document.getElementById('btn-show-all');
  const btnNewLadder = document.getElementById('btn-new-ladder');
  const btnEditSetup = document.getElementById('btn-edit-setup');

  const statusBanner = document.getElementById('status-banner');
  const playersRow = document.getElementById('players-row');
  const resultsRow = document.getElementById('results-row');
  const canvasWrap = document.getElementById('canvas-wrap');
  const canvas = document.getElementById('ladder-canvas');
  const ctx = canvas.getContext('2d');

  const summarySection = document.getElementById('summary-section');
  const summaryList = document.getElementById('summary-list');
  const btnCopyResult = document.getElementById('btn-copy-result');

  function initDefaults(count) {
    const nextPlayers = [];
    const nextResults = [];
    for (let i = 0; i < count; i++) {
      nextPlayers.push(state.players[i] ?? `참여자 ${i + 1}`);
      nextResults.push(state.results[i] ?? (i === 0 ? '당첨' : i === 1 ? '꽝' : DEFAULT_RESULTS[i] || `결과 ${i + 1}`));
    }
    state.players = nextPlayers;
    state.results = nextResults;
  }

  function resetAllInputs() {
    state.players = Array.from({ length: state.count }, (_, i) => `참여자 ${i + 1}`);
    state.results = Array.from({ length: state.count }, (_, i) => (i === 0 ? '당첨' : '꽝'));
    renderBoard();
    drawLadder();
  }

  function generateLadder() {
    const cols = state.count;
    const rungs = Array.from({ length: LADDER_ROWS }, () => Array(cols - 1).fill(false));

    // Fill random rungs ensuring no two adjacent gaps share the same row
    for (let r = 0; r < LADDER_ROWS; r++) {
      let c = 0;
      while (c < cols - 1) {
        if (Math.random() < 0.44) {
          rungs[r][c] = true;
          c += 2;
        } else {
          c += 1;
        }
      }
    }

    // Ensure every adjacent column pair has at least 1 rung so all columns stay connected
    for (let c = 0; c < cols - 1; c++) {
      const hasRung = rungs.some((row) => row[c]);
      if (!hasRung) {
        const candidates = [];
        for (let r = 0; r < LADDER_ROWS; r++) {
          const leftBusy = c > 0 && rungs[r][c - 1];
          const rightBusy = c < cols - 2 && rungs[r][c + 1];
          if (!leftBusy && !rightBusy) {
            candidates.push(r);
          }
        }
        if (candidates.length > 0) {
          const pick = candidates[Math.floor(Math.random() * candidates.length)];
          rungs[pick][c] = true;
        }
      }
    }

    state.rungs = rungs;
    computeAllPaths();
  }

  function getRowRatio(r) {
    // Map row index [0 .. LADDER_ROWS - 1] into vertical range [0.10 .. 0.90]
    return 0.1 + ((r + 0.5) / LADDER_ROWS) * 0.8;
  }

  function computeAllPaths() {
    const cols = state.count;
    state.paths = Array.from({ length: cols }, (_, startCol) => {
      let col = startCol;
      const waypoints = [{ col, rowRatio: 0 }];

      for (let r = 0; r < LADDER_ROWS; r++) {
        const yRatio = getRowRatio(r);
        if (col < cols - 1 && state.rungs[r][col]) {
          waypoints.push({ col, rowRatio: yRatio });
          col += 1;
          waypoints.push({ col, rowRatio: yRatio });
        } else if (col > 0 && state.rungs[r][col - 1]) {
          waypoints.push({ col, rowRatio: yRatio });
          col -= 1;
          waypoints.push({ col, rowRatio: yRatio });
        }
      }

      waypoints.push({ col, rowRatio: 1 });
      return { waypoints, endCol: col };
    });
  }

  function getColumnXs() {
    const wrapRect = canvasWrap.getBoundingClientRect();
    const cells = playersRow.children;
    const xs = [];
    for (let i = 0; i < cells.length; i++) {
      const rect = cells[i].getBoundingClientRect();
      xs.push(rect.left - wrapRect.left + rect.width / 2);
    }
    return xs;
  }

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const width = canvasWrap.clientWidth;
    const height = canvasWrap.clientHeight;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width, height };
  }

  function toPixelPoints(waypoints, xs, height) {
    return waypoints.map((pt) => ({
      x: xs[pt.col],
      y: pt.rowRatio * height,
    }));
  }

  function measurePolyline(points) {
    const segLengths = [];
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const dx = points[i + 1].x - points[i].x;
      const dy = points[i + 1].y - points[i].y;
      const len = Math.hypot(dx, dy);
      segLengths.push(len);
      total += len;
    }
    return { segLengths, total };
  }

  function drawPartialPolyline(points, progress, color, lineWidth, drawMarker) {
    if (points.length < 2) return;
    const { segLengths, total } = measurePolyline(points);
    const targetDist = total * Math.max(0, Math.min(1, progress));

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    let covered = 0;
    let tip = points[0];

    for (let i = 0; i < segLengths.length; i++) {
      const segLen = segLengths[i];
      if (covered + segLen <= targetDist) {
        ctx.lineTo(points[i + 1].x, points[i + 1].y);
        covered += segLen;
        tip = points[i + 1];
      } else {
        const remain = targetDist - covered;
        const ratio = segLen > 0 ? remain / segLen : 0;
        tip = {
          x: points[i].x + (points[i + 1].x - points[i].x) * ratio,
          y: points[i].y + (points[i + 1].y - points[i].y) * ratio,
        };
        ctx.lineTo(tip.x, tip.y);
        break;
      }
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    if (drawMarker) {
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawLadder() {
    const { width, height } = resizeCanvas();
    ctx.clearRect(0, 0, width, height);

    const xs = getColumnXs();
    if (xs.length !== state.count) return;

    // Draw base vertical lines
    ctx.save();
    ctx.strokeStyle = state.mode === 'setup' ? '#d5dbe2' : '#cfd5dc';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';

    for (let c = 0; c < state.count; c++) {
      ctx.beginPath();
      ctx.moveTo(xs[c], 0);
      ctx.lineTo(xs[c], height);
      ctx.stroke();
    }

    // Draw base horizontal rungs (only in play mode; setup shows clean vertical preview)
    if (state.mode === 'play') {
      for (let r = 0; r < LADDER_ROWS; r++) {
        const y = getRowRatio(r) * height;
        for (let c = 0; c < state.count - 1; c++) {
          if (state.rungs[r][c]) {
            ctx.beginPath();
            ctx.moveTo(xs[c], y);
            ctx.lineTo(xs[c + 1], y);
            ctx.stroke();
          }
        }
      }
    }
    ctx.restore();

    if (state.mode !== 'play') return;

    // Draw revealed paths (non-highlighted first, then highlighted on top)
    const revealedCols = Array.from(state.revealed).filter((c) => c !== state.highlightedCol);
    for (const c of revealedCols) {
      const pts = toPixelPoints(state.paths[c].waypoints, xs, height);
      const isDimmed = state.highlightedCol !== null || state.activeAnim !== null;
      drawPartialPolyline(pts, 1, PATH_COLORS[c % PATH_COLORS.length], isDimmed ? 3.5 : 4.5, false);
    }

    if (state.highlightedCol !== null && state.revealed.has(state.highlightedCol)) {
      const c = state.highlightedCol;
      const pts = toPixelPoints(state.paths[c].waypoints, xs, height);
      drawPartialPolyline(pts, 1, PATH_COLORS[c % PATH_COLORS.length], 6, false);
    }

    if (state.activeAnim) {
      const { col, progress } = state.activeAnim;
      const pts = toPixelPoints(state.paths[col].waypoints, xs, height);
      drawPartialPolyline(pts, progress, PATH_COLORS[col % PATH_COLORS.length], 6, true);
    }
  }

  function finishActiveAnimation() {
    if (!state.activeAnim) return;
    cancelAnimationFrame(state.activeAnim.rafId);
    const finishedCol = state.activeAnim.col;
    state.activeAnim = null;
    state.revealed.add(finishedCol);
    state.highlightedCol = finishedCol;
  }

  function animatePlayerPath(col) {
    if (state.mode !== 'play') return;

    // Clicking an already-revealed player re-highlights their path
    if (state.revealed.has(col) && (!state.activeAnim || state.activeAnim.col !== col)) {
      finishActiveAnimation();
      state.highlightedCol = col;
      renderNodesPlay();
      drawLadder();
      return;
    }

    finishActiveAnimation();
    state.highlightedCol = col;
    renderNodesPlay();

    const duration = 900;
    const startTime = performance.now();

    const tick = (now) => {
      const elapsed = now - startTime;
      const raw = Math.min(1, elapsed / duration);
      // Slight ease-in-out
      const progress = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;

      if (!state.activeAnim) return;
      state.activeAnim.progress = progress;
      drawLadder();

      if (raw < 1) {
        state.activeAnim.rafId = requestAnimationFrame(tick);
      } else {
        state.activeAnim = null;
        state.revealed.add(col);
        renderNodesPlay();
        drawLadder();
        updateSummaryIfComplete();
      }
    };

    state.activeAnim = {
      col,
      progress: 0,
      rafId: requestAnimationFrame(tick),
    };
  }

  function updateSummaryIfComplete() {
    if (state.revealed.size === state.count) {
      renderSummary();
      summarySection.classList.remove('hidden');
      statusBanner.innerHTML = '모든 결과가 공개되었습니다! 위 참여자를 누르면 이동 경로를 다시 확인할 수 있어요.';
    } else {
      const remain = state.count - state.revealed.size;
      statusBanner.innerHTML = `상단 참여자를 눌러 사다리를 타보세요. (남은 인원: <strong>${remain}명</strong>)`;
    }
  }

  function showAllResults() {
    if (state.mode !== 'play') return;
    finishActiveAnimation();
    state.highlightedCol = null;
    state.blind = false;
    chkBlind.checked = false;
    blindCurtain.classList.add('hidden');

    for (let c = 0; c < state.count; c++) {
      state.revealed.add(c);
    }

    renderNodesPlay();
    drawLadder();
    updateSummaryIfComplete();
  }

  function syncInputsFromDOM() {
    const playerInputs = playersRow.querySelectorAll('.node-input');
    const resultInputs = resultsRow.querySelectorAll('.node-input');

    playerInputs.forEach((input, idx) => {
      const val = input.value.trim();
      state.players[idx] = val || `참여자 ${idx + 1}`;
    });

    resultInputs.forEach((input, idx) => {
      const val = input.value.trim();
      state.results[idx] = val || `결과 ${idx + 1}`;
    });
  }

  function startGame() {
    syncInputsFromDOM();
    state.mode = 'play';
    state.revealed.clear();
    state.highlightedCol = null;
    finishActiveAnimation();
    generateLadder();
    renderBoard();
    drawLadder();
  }

  function regenerateLadder() {
    finishActiveAnimation();
    state.revealed.clear();
    state.highlightedCol = null;
    summarySection.classList.add('hidden');
    generateLadder();
    renderBoard();
    drawLadder();
  }

  function backToSetup() {
    finishActiveAnimation();
    state.mode = 'setup';
    state.revealed.clear();
    state.highlightedCol = null;
    state.blind = false;
    chkBlind.checked = false;
    blindCurtain.classList.add('hidden');
    summarySection.classList.add('hidden');
    renderBoard();
    drawLadder();
  }

  function renderNodesSetup() {
    playersRow.style.gridTemplateColumns = `repeat(${state.count}, 1fr)`;
    resultsRow.style.gridTemplateColumns = `repeat(${state.count}, 1fr)`;
    playersRow.innerHTML = '';
    resultsRow.innerHTML = '';

    for (let i = 0; i < state.count; i++) {
      const pCell = document.createElement('div');
      pCell.className = 'node-cell';
      const pInput = document.createElement('input');
      pInput.type = 'text';
      pInput.className = 'node-input';
      pInput.maxLength = 12;
      pInput.value = state.players[i];
      pInput.placeholder = `참여자 ${i + 1}`;
      pInput.setAttribute('aria-label', `참여자 ${i + 1} 이름`);
      pInput.addEventListener('input', () => {
        state.players[i] = pInput.value;
      });
      pCell.appendChild(pInput);
      playersRow.appendChild(pCell);

      const rCell = document.createElement('div');
      rCell.className = 'node-cell';
      const rInput = document.createElement('input');
      rInput.type = 'text';
      rInput.className = 'node-input';
      rInput.maxLength = 14;
      rInput.value = state.results[i];
      rInput.placeholder = `결과 ${i + 1}`;
      rInput.setAttribute('aria-label', `결과 ${i + 1}`);
      rInput.addEventListener('input', () => {
        state.results[i] = rInput.value;
      });
      rCell.appendChild(rInput);
      resultsRow.appendChild(rCell);
    }
  }

  function renderNodesPlay() {
    playersRow.style.gridTemplateColumns = `repeat(${state.count}, 1fr)`;
    resultsRow.style.gridTemplateColumns = `repeat(${state.count}, 1fr)`;
    playersRow.innerHTML = '';
    resultsRow.innerHTML = '';

    // Map endCol -> startCol for revealed paths
    const endToStart = new Map();
    for (const startCol of state.revealed) {
      endToStart.set(state.paths[startCol].endCol, startCol);
    }

    for (let i = 0; i < state.count; i++) {
      const color = PATH_COLORS[i % PATH_COLORS.length];
      const isDone = state.revealed.has(i);
      const isActive = state.highlightedCol === i;

      const pCell = document.createElement('div');
      pCell.className = 'node-cell';
      const pBtn = document.createElement('button');
      pBtn.type = 'button';
      pBtn.className = 'node-btn';
      pBtn.textContent = state.players[i];
      pBtn.title = `${state.players[i]} 사다리 타기`;

      if (isDone) {
        pBtn.classList.add('done');
        pBtn.style.background = color;
        pBtn.style.borderColor = color;
      } else {
        pBtn.style.borderColor = isActive ? color : '';
      }

      if (isActive) {
        pBtn.classList.add('active');
        pBtn.style.boxShadow = `0 0 0 3px ${color}33`;
      }

      pBtn.addEventListener('click', () => animatePlayerPath(i));
      pCell.appendChild(pBtn);
      playersRow.appendChild(pCell);

      // Bottom result cell
      const rCell = document.createElement('div');
      rCell.className = 'node-cell';

      const rBox = document.createElement('div');
      rBox.className = 'result-box';
      rBox.textContent = state.results[i];

      const ownerBadge = document.createElement('span');
      ownerBadge.className = 'result-owner';

      if (endToStart.has(i)) {
        const ownerCol = endToStart.get(i);
        const ownerColor = PATH_COLORS[ownerCol % PATH_COLORS.length];
        rBox.classList.add('matched');
        rBox.style.borderColor = ownerColor;
        rBox.style.background = `${ownerColor}14`;
        ownerBadge.textContent = state.players[ownerCol];
        ownerBadge.style.background = ownerColor;
      } else {
        ownerBadge.classList.add('empty');
        ownerBadge.textContent = '-';
      }

      rCell.appendChild(rBox);
      rCell.appendChild(ownerBadge);
      resultsRow.appendChild(rCell);
    }
  }

  function renderSummary() {
    summaryList.innerHTML = '';
    for (let i = 0; i < state.count; i++) {
      const endCol = state.paths[i].endCol;
      const color = PATH_COLORS[i % PATH_COLORS.length];
      const li = document.createElement('li');
      li.className = 'summary-item';
      li.style.borderLeftColor = color;

      const playerSpan = document.createElement('span');
      playerSpan.className = 'summary-player';
      playerSpan.textContent = state.players[i];

      const arrowSpan = document.createElement('span');
      arrowSpan.className = 'summary-arrow';
      arrowSpan.textContent = '→';

      const resultSpan = document.createElement('span');
      resultSpan.className = 'summary-result';
      resultSpan.textContent = state.results[endCol];

      li.appendChild(playerSpan);
      li.appendChild(arrowSpan);
      li.appendChild(resultSpan);
      summaryList.appendChild(li);
    }
  }

  function renderBoard() {
    countDisplay.textContent = `${state.count}명`;
    btnDecrease.disabled = state.mode === 'play' || state.count <= MIN_PLAYERS;
    btnIncrease.disabled = state.mode === 'play' || state.count >= MAX_PLAYERS;

    const isSetup = state.mode === 'setup';
    btnResetInputs.classList.toggle('hidden', !isSetup);
    btnStart.classList.toggle('hidden', !isSetup);

    blindToggleWrap.classList.toggle('hidden', isSetup);
    btnShowAll.classList.toggle('hidden', isSetup);
    btnNewLadder.classList.toggle('hidden', isSetup);
    btnEditSetup.classList.toggle('hidden', isSetup);

    if (isSetup) {
      statusBanner.innerHTML = '이름과 결과를 입력하고 <strong>사다리 타기 시작</strong>을 눌러주세요.';
      summarySection.classList.add('hidden');
      renderNodesSetup();
    } else {
      updateSummaryIfComplete();
      renderNodesPlay();
    }
  }

  // Event Listeners
  btnDecrease.addEventListener('click', () => {
    if (state.mode !== 'setup' || state.count <= MIN_PLAYERS) return;
    syncInputsFromDOM();
    state.count -= 1;
    initDefaults(state.count);
    renderBoard();
    drawLadder();
  });

  btnIncrease.addEventListener('click', () => {
    if (state.mode !== 'setup' || state.count >= MAX_PLAYERS) return;
    syncInputsFromDOM();
    state.count += 1;
    initDefaults(state.count);
    renderBoard();
    drawLadder();
  });

  btnResetInputs.addEventListener('click', resetAllInputs);
  btnStart.addEventListener('click', startGame);
  btnShowAll.addEventListener('click', showAllResults);
  btnNewLadder.addEventListener('click', regenerateLadder);
  btnEditSetup.addEventListener('click', backToSetup);

  chkBlind.addEventListener('change', () => {
    state.blind = chkBlind.checked;
    blindCurtain.classList.toggle('hidden', !state.blind);
  });

  btnCopyResult.addEventListener('click', async () => {
    const lines = Array.from({ length: state.count }, (_, i) => {
      const endCol = state.paths[i].endCol;
      return `${state.players[i]} → ${state.results[endCol]}`;
    });
    const text = `[사다리타기 결과]\n${lines.join('\n')}`;

    try {
      await navigator.clipboard.writeText(text);
      btnCopyResult.textContent = '복사 완료!';
      setTimeout(() => {
        btnCopyResult.textContent = '결과 복사';
      }, 1500);
    } catch {
      btnCopyResult.textContent = '복사 실패';
      setTimeout(() => {
        btnCopyResult.textContent = '결과 복사';
      }, 1500);
    }
  });

  window.addEventListener('resize', () => {
    drawLadder();
  });

  // Initialize
  initDefaults(state.count);
  renderBoard();
  requestAnimationFrame(drawLadder);
})();
