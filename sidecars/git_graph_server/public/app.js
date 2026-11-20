// Git Graph Client Application
(() => {
  // 色彩配置：8 種高對比分支顏色
  const BRANCH_COLORS = [
    '#89b4fa', // 藍
    '#a6e3a1', // 綠
    '#f9e2af', // 黃
    '#f38ba8', // 紅/粉
    '#cba6f7', // 紫
    '#94e2d5', // 青
    '#fab387', // 橙
    '#b4befe'  // 淺藍灰
  ];

  const ROW_HEIGHT = 28;
  const LANE_WIDTH = 16;
  const PADDING_LEFT = 14;

  // 狀態變數
  let currentRepo = '';
  let allCommits = [];
  let allLinks = [];
  let maxLanes = 1;
  let selectedCommitHash = null;
  let currentBranchFilter = 'all';

  // DOM 元素快取
  const $ = (id) => document.getElementById(id);
  const projectSelect = $('project-select');
  const branchBadgeEl = $('current-branch-badge');
  const workingTreeStatusEl = $('working-tree-status');
  const commitsCountEl = $('commits-count');
  const branchSelect = $('branch-select');
  const searchInput = $('search-input');
  const btnClearSearch = $('btn-clear-search');
  const btnRefresh = $('btn-refresh');
  const btnToggleRepo = $('btn-toggle-repo');
  const repoSwitchBar = $('repo-switch-bar');
  const repoPathInput = $('repo-path-input');
  const btnSetRepo = $('btn-set-repo');
  const graphSvg = $('graph-svg');
  const commitList = $('commit-list');
  const loadingState = $('loading-state');
  const emptyState = $('empty-state');
  
  // Drawer DOM
  const detailDrawer = $('detail-drawer');
  const detailHash = $('detail-hash');
  const detailAuthor = $('detail-author');
  const detailSubject = $('detail-subject');
  const detailDate = $('detail-date');
  const detailBodyText = $('detail-body-text');
  const detailFilesCount = $('detail-files-count');
  const fileList = $('file-list');
  const btnCloseDrawer = $('btn-close-drawer');
  const diffSection = $('diff-section');
  const diffFilename = $('diff-filename');
  const diffContent = $('diff-content');
  const btnCloseDiff = $('btn-close-diff');

  // 時間格式化 (相對時間)
  function formatRelativeTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffSec = Math.floor((now - date) / 1000);

    if (diffSec < 60) return '剛剛';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分鐘前`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小時前`;
    if (diffSec < 2592000) return `${Math.floor(diffSec / 86400)} 天前`;

    return date.toISOString().slice(0, 10);
  }

  // 取得 API URL（自動攜帶 repo query）
  function apiUrl(endpoint, params = {}) {
    const url = new URL(endpoint, window.location.origin);
    if (currentRepo) url.searchParams.set('repo', currentRepo);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
    return url.toString();
  }

  // 載入 AGY 專案清單並填入下拉選單
  async function loadProjects() {
    try {
      const res = await fetch('/api/projects').then(r => r.json());
      if (res.ok && Array.isArray(res.projects)) {
        projectSelect.innerHTML = '';
        let hasSelected = false;

        res.projects.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.path;
          opt.textContent = `📁 ${p.name}${p.isGit ? '' : ' (非Git)'}`;
          if (currentRepo && currentRepo.toLowerCase().replace(/\\/g, '/') === p.path.toLowerCase().replace(/\\/g, '/')) {
            opt.selected = true;
            hasSelected = true;
          }
          projectSelect.appendChild(opt);
        });

        // 若當前工作區不在專案內，顯示提示
        if (!hasSelected) {
          const noneOpt = document.createElement('option');
          noneOpt.value = '';
          noneOpt.textContent = '📂 (無關聯專案)';
          noneOpt.selected = true;
          projectSelect.insertBefore(noneOpt, projectSelect.firstChild);
        }

        const customOpt = document.createElement('option');
        customOpt.value = '__custom__';
        customOpt.textContent = '➕ 自訂本機路徑...';
        projectSelect.appendChild(customOpt);
      }
    } catch (err) {
      console.warn('載入專案清單失敗:', err);
    }
  }

  // 載入倉庫狀態與分支清單
  async function loadRepoMeta() {
    try {
      const [statusRes, branchesRes] = await Promise.all([
        fetch(apiUrl('/api/status')).then(r => r.json()),
        fetch(apiUrl('/api/branches')).then(r => r.json())
      ]);

      if (!statusRes.ok || !statusRes.isGit) {
        branchBadgeEl.textContent = '無';
        workingTreeStatusEl.innerHTML = '<span style="color:#6c7086;">● 當前對話無 Git 倉庫</span>';
        commitsCountEl.textContent = '0 commits';
        commitList.innerHTML = '';
        graphSvg.innerHTML = '';
        loadingState.classList.add('hidden');
        emptyState.classList.remove('hidden');
        emptyState.innerHTML = '<p style="font-size:14px;color:#a6adc8;margin-bottom:6px;">📂 當前對話工作區無 Git 倉庫</p><p style="font-size:12px;color:#6c7086;">切換至已開啟 Git 倉庫的專案對話時將自動顯示</p>';
        return false;
      }

      currentRepo = statusRes.repoPath;
      repoPathInput.value = currentRepo;
      repoSwitchBar.classList.add('hidden');
      emptyState.classList.add('hidden');

      // 嘗試選中對應的專案
      if (projectSelect) {
        for (let i = 0; i < projectSelect.options.length; i++) {
          const optVal = projectSelect.options[i].value.toLowerCase().replace(/\\/g, '/');
          const curVal = currentRepo.toLowerCase().replace(/\\/g, '/');
          if (optVal === curVal || curVal.startsWith(optVal)) {
            projectSelect.selectedIndex = i;
            break;
          }
        }
      }
      branchBadgeEl.textContent = statusRes.currentBranch;

      // Working Tree 狀態提示
      if (statusRes.isClean) {
        workingTreeStatusEl.innerHTML = '<span style="color:#a6e3a1;">● 工作區乾淨 (Clean)</span>';
      } else {
        const parts = [];
        if (statusRes.stagedCount) parts.push(`${statusRes.stagedCount} 暫存`);
        if (statusRes.unstagedCount) parts.push(`${statusRes.unstagedCount} 修改`);
        if (statusRes.untrackedCount) parts.push(`${statusRes.untrackedCount} 未追蹤`);
        workingTreeStatusEl.innerHTML = `<span style="color:#f9e2af;">● ${parts.join(', ')}</span>`;
      }

      // 渲染分支下拉選單
      if (branchesRes.ok && branchesRes.branches) {
        branchSelect.innerHTML = '<option value="all">🌿 所有分支 (All)</option>';
        branchesRes.branches.forEach(b => {
          const opt = document.createElement('option');
          opt.value = b.name;
          opt.textContent = `${b.isHead ? '* ' : ''}${b.name}`;
          if (b.name === currentBranchFilter) opt.selected = true;
          branchSelect.appendChild(opt);
        });
      }

      return true;
    } catch (err) {
      console.error('Failed to load repo status:', err);
      workingTreeStatusEl.textContent = '無法連線到本機 Sidecar Server';
      return false;
    }
  }

  // 載入 Commit 分支圖資料
  async function loadCommits() {
    loadingState.classList.remove('hidden');
    emptyState.classList.add('hidden');

    try {
      const res = await fetch(apiUrl('/api/commits', {
        branch: currentBranchFilter,
        limit: 250
      })).then(r => r.json());

      if (!res.ok) {
        throw new Error(res.error || 'Failed to fetch commits');
      }

      allCommits = res.commits || [];
      allLinks = res.links || [];
      maxLanes = Math.max(1, res.maxLanes || 1);
      commitsCountEl.textContent = `${allCommits.length} commits`;

      renderGraph();
    } catch (err) {
      console.error('Failed to load commits:', err);
      emptyState.querySelector('p').textContent = `載入失敗: ${err.message}`;
      emptyState.classList.remove('hidden');
    } finally {
      loadingState.classList.add('hidden');
    }
  }

  // 繪製彩色分支圖 (SVG + DOM)
  function renderGraph() {
    const filterText = searchInput.value.trim().toLowerCase();
    
    // 依搜尋字串過濾顯示
    const visibleCommits = allCommits.filter(c => {
      if (!filterText) return true;
      return (
        c.subject.toLowerCase().includes(filterText) ||
        c.author.toLowerCase().includes(filterText) ||
        c.shortHash.toLowerCase().includes(filterText) ||
        c.hash.toLowerCase().includes(filterText) ||
        (c.refs && c.refs.some(r => r.name.toLowerCase().includes(filterText)))
      );
    });

    if (visibleCommits.length === 0) {
      emptyState.classList.remove('hidden');
      graphSvg.innerHTML = '';
      commitList.innerHTML = '';
      return;
    }
    emptyState.classList.add('hidden');

    const totalRows = visibleCommits.length;
    const svgWidth = Math.max(70, PADDING_LEFT + maxLanes * LANE_WIDTH + 16);
    const svgHeight = totalRows * ROW_HEIGHT;

    graphSvg.setAttribute('width', svgWidth);
    graphSvg.setAttribute('height', svgHeight);

    // 建立 Commit 快速索引表 (用於繪製連線)
    const rowMap = new Map();
    visibleCommits.forEach((c, idx) => {
      rowMap.set(c.hash, idx);
    });

    // 1. 繪製連線 (Curves / Lines)
    let pathsHtml = '';
    for (const link of allLinks) {
      const commit = allCommits[link.fromY];
      const parent = allCommits[link.toY];
      if (!commit || !parent) continue;

      const fromRow = rowMap.get(commit.hash);
      const toRow = rowMap.get(parent.hash);
      if (fromRow === undefined || toRow === undefined) continue;

      const x1 = PADDING_LEFT + link.fromX * LANE_WIDTH;
      const y1 = fromRow * ROW_HEIGHT + ROW_HEIGHT / 2;
      const x2 = PADDING_LEFT + link.toX * LANE_WIDTH;
      const y2 = toRow * ROW_HEIGHT + ROW_HEIGHT / 2;

      const color = BRANCH_COLORS[link.colorIndex % BRANCH_COLORS.length];

      if (x1 === x2) {
        // 直線
        pathsHtml += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`;
      } else {
        // 貝茲平滑曲線 (Bezier curve)
        const midY = (y1 + y2) / 2;
        pathsHtml += `<path d="M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`;
      }
    }

    // 2. 繪製節點圓圈 (Circles)
    let circlesHtml = '';
    visibleCommits.forEach((c, rowIdx) => {
      const cx = PADDING_LEFT + c.x * LANE_WIDTH;
      const cy = rowIdx * ROW_HEIGHT + ROW_HEIGHT / 2;
      const color = BRANCH_COLORS[c.x % BRANCH_COLORS.length];
      const isMerge = c.parents && c.parents.length > 1;

      if (isMerge) {
        // Merge 節點使用外圈加粗樣式
        circlesHtml += `
          <circle cx="${cx}" cy="${cy}" r="5.5" fill="${color}" stroke="#181825" stroke-width="1.5"/>
          <circle cx="${cx}" cy="${cy}" r="2" fill="#181825"/>
        `;
      } else {
        // 一般節點
        circlesHtml += `<circle cx="${cx}" cy="${cy}" r="4" fill="${color}" stroke="#181825" stroke-width="1.5"/>`;
      }
    });

    graphSvg.innerHTML = pathsHtml + circlesHtml;

    // 3. 渲染 Commit 列表 (文字與裝飾 Badge)
    commitList.innerHTML = '';
    const fragment = document.createDocumentFragment();

    visibleCommits.forEach((commit, rowIdx) => {
      const row = document.createElement('div');
      row.className = 'commit-row';
      row.dataset.hash = commit.hash;
      if (commit.hash === selectedCommitHash) row.classList.add('selected');

      // 左側預留圖形寬度 Spacer
      const spacer = document.createElement('div');
      spacer.className = 'commit-graph-spacer';
      spacer.style.width = `${svgWidth}px`;
      row.appendChild(spacer);

      // 右側內容
      const content = document.createElement('div');
      content.className = 'commit-content';

      // 裝飾標籤 (Badges: HEAD, branch, tag)
      if (commit.refs && commit.refs.length > 0) {
        commit.refs.forEach(ref => {
          const badge = document.createElement('span');
          badge.className = `commit-badge badge-${ref.type}`;
          const icon = ref.type === 'tag' ? '🏷️ ' : (ref.type === 'head' ? '★ ' : '🌿 ');
          badge.textContent = `${icon}${ref.name}`;
          content.appendChild(badge);
        });
      }

      // Commit 標題
      const subject = document.createElement('span');
      subject.className = 'commit-subject';
      subject.textContent = commit.subject;
      subject.title = commit.subject;
      content.appendChild(subject);

      // 中間與右側 Meta (作者、時間、Hash)
      const meta = document.createElement('div');
      meta.className = 'commit-meta';

      const author = document.createElement('span');
      author.className = 'commit-author';
      author.textContent = commit.author;
      author.title = `${commit.author} <${commit.email}>`;

      const date = document.createElement('span');
      date.className = 'commit-date';
      date.textContent = formatRelativeTime(commit.date);
      date.title = commit.date;

      const hashPill = document.createElement('span');
      hashPill.className = 'commit-hash';
      hashPill.textContent = commit.shortHash;
      hashPill.title = '點擊複製 Commit Hash';
      hashPill.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(commit.hash);
        hashPill.textContent = '已複製!';
        setTimeout(() => hashPill.textContent = commit.shortHash, 1200);
      });

      meta.appendChild(author);
      meta.appendChild(date);
      meta.appendChild(hashPill);
      content.appendChild(meta);

      row.appendChild(content);

      // 點擊事件：展開詳情 Drawer
      row.addEventListener('click', () => {
        openCommitDetail(commit.hash);
      });

      fragment.appendChild(row);
    });

    commitList.appendChild(fragment);
  }

  // 開啟 Commit 詳情 Drawer
  async function openCommitDetail(hash) {
    selectedCommitHash = hash;
    document.querySelectorAll('.commit-row').forEach(r => {
      r.classList.toggle('selected', r.dataset.hash === hash);
    });

    detailDrawer.classList.remove('hidden');
    diffSection.classList.add('hidden');
    detailHash.textContent = hash.substring(0, 8);
    detailAuthor.textContent = '載入中...';
    detailSubject.textContent = '載入詳情...';
    detailDate.textContent = '';
    detailBodyText.classList.add('hidden');
    fileList.innerHTML = '<li style="padding:6px; color:#9399b2;">載入檔案清單...</li>';

    try {
      const res = await fetch(apiUrl(`/api/commit/${hash}`)).then(r => r.json());
      if (!res.ok) throw new Error(res.error || 'Failed to load commit');

      detailHash.textContent = res.shortHash;
      detailAuthor.textContent = `${res.author} <${res.email}>`;
      detailSubject.textContent = res.subject;
      detailDate.textContent = new Date(res.date).toLocaleString('zh-TW');

      if (res.body) {
        detailBodyText.textContent = res.body;
        detailBodyText.classList.remove('hidden');
      }

      detailFilesCount.textContent = res.files ? res.files.length : 0;
      fileList.innerHTML = '';

      if (res.files && res.files.length > 0) {
        res.files.forEach(file => {
          const li = document.createElement('li');
          li.className = 'file-item';

          const statusBadge = document.createElement('span');
          statusBadge.className = `file-status status-${file.status.charAt(0)}`;
          statusBadge.textContent = file.status;

          const pathSpan = document.createElement('span');
          pathSpan.className = 'file-path';
          pathSpan.textContent = file.path;
          pathSpan.title = file.path;

          li.appendChild(statusBadge);
          li.appendChild(pathSpan);

          // 點擊檔案檢視 Diff
          li.addEventListener('click', () => {
            loadFileDiff(hash, file.path);
          });

          fileList.appendChild(li);
        });
      } else {
        fileList.innerHTML = '<li style="padding:4px; color:#9399b2;">無檔案變更（可能為空 commit 或 merge commit）</li>';
      }
    } catch (err) {
      console.error('Failed to load commit details:', err);
      detailSubject.textContent = `載入失敗: ${err.message}`;
    }
  }

  // 載入並渲染單一檔案的 Diff
  async function loadFileDiff(hash, filePath) {
    diffSection.classList.remove('hidden');
    diffFilename.textContent = filePath;
    diffContent.textContent = '載入 Diff 中...';

    try {
      const res = await fetch(apiUrl('/api/diff', { hash, file: filePath })).then(r => r.json());
      if (!res.ok) throw new Error(res.error || 'Failed to load diff');

      const lines = (res.diff || '').split('\n');
      diffContent.innerHTML = '';

      lines.forEach(line => {
        const div = document.createElement('div');
        div.textContent = line;
        if (line.startsWith('+') && !line.startsWith('+++')) {
          div.className = 'diff-line-add';
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          div.className = 'diff-line-del';
        } else if (line.startsWith('@@')) {
          div.className = 'diff-line-hunk';
        }
        diffContent.appendChild(div);
      });
      diffContent.scrollTop = 0;
    } catch (err) {
      diffContent.textContent = `無法載入 Diff: ${err.message}`;
    }
  }

  // 事件綁定
  btnRefresh.addEventListener('click', async () => {
    btnRefresh.style.transform = 'rotate(180deg)';
    const isGit = await loadRepoMeta();
    if (isGit) {
      await loadCommits();
    }
    setTimeout(() => btnRefresh.style.transform = '', 300);
  });

  branchSelect.addEventListener('change', () => {
    currentBranchFilter = branchSelect.value;
    loadCommits();
  });

  searchInput.addEventListener('input', () => {
    btnClearSearch.classList.toggle('hidden', !searchInput.value);
    renderGraph();
  });

  btnClearSearch.addEventListener('click', () => {
    searchInput.value = '';
    btnClearSearch.classList.add('hidden');
    renderGraph();
  });

  btnToggleRepo.addEventListener('click', () => {
    repoSwitchBar.classList.toggle('hidden');
  });

  if (projectSelect) {
    projectSelect.addEventListener('change', async (e) => {
      const val = e.target.value;
      if (val === '__custom__') {
        repoSwitchBar.classList.remove('hidden');
        repoPathInput.focus();
        return;
      }
      currentRepo = val;
      localStorage.setItem('agy_git_graph_repo', currentRepo);
      repoPathInput.value = currentRepo;
      repoSwitchBar.classList.add('hidden');
      await loadRepoMeta();
      await loadCommits();
    });
  }

  btnSetRepo.addEventListener('click', async () => {
    const newPath = repoPathInput.value.trim();
    if (!newPath) return;

    btnSetRepo.textContent = '切換中...';
    try {
      const res = await fetch('/api/set-repo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoPath: newPath })
      }).then(r => r.json());

      if (res.ok) {
        currentRepo = res.repoPath;
        localStorage.setItem('agy_git_graph_repo', currentRepo);
        repoSwitchBar.classList.add('hidden');
        await loadProjects();
        await loadRepoMeta();
        await loadCommits();
      } else {
        alert(`切換失敗: ${res.error}`);
      }
    } catch (err) {
      alert(`錯誤: ${err.message}`);
    } finally {
      btnSetRepo.textContent = '切換';
    }
  });

  btnCloseDrawer.addEventListener('click', () => {
    detailDrawer.classList.add('hidden');
    selectedCommitHash = null;
    document.querySelectorAll('.commit-row.selected').forEach(r => r.classList.remove('selected'));
  });

  btnCloseDiff.addEventListener('click', () => {
    diffSection.classList.add('hidden');
  });

  // 鍵盤快捷鍵：Escape 關閉 drawer 或 diff
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!diffSection.classList.contains('hidden')) {
        diffSection.classList.add('hidden');
      } else if (!detailDrawer.classList.contains('hidden')) {
        btnCloseDrawer.click();
      }
    }
  });

  // AGY 對話 (Session) 即時追蹤與自動切換
  let activeConvId = null;

  function getCurrentConvId() {
    return (
      (window.sidecar && window.sidecar.conversationId) ||
      new URLSearchParams(window.location.search).get('conversationId') ||
      ''
    );
  }

  async function syncActiveSessionRepo() {
    const convId = getCurrentConvId();
    if (!convId || convId === activeConvId) return;

    activeConvId = convId;
    try {
      const res = await fetch(`/api/resolve-session?conv=${encodeURIComponent(convId)}`).then(r => r.json());
      if (res.ok && res.found && res.repoPath && res.isGit) {
        const normalizedTarget = res.repoPath.toLowerCase().replace(/\\/g, '/');
        const normalizedCurrent = currentRepo ? currentRepo.toLowerCase().replace(/\\/g, '/') : '';
        if (normalizedTarget !== normalizedCurrent) {
          currentRepo = res.repoPath;
          localStorage.setItem('agy_git_graph_repo', currentRepo);
          await loadProjects();
          const isGit = await loadRepoMeta();
          if (isGit) {
            await loadCommits();
          }
        }
      }
    } catch (err) {
      console.warn('自動同步 Session 專案失敗:', err);
    }
  }

  // 定時輪詢檢查當前對話切換 (每 1.2 秒)
  setInterval(syncActiveSessionRepo, 1200);

  // 初始啟動
  (async () => {
    await loadProjects();
    await syncActiveSessionRepo();
    const isGit = await loadRepoMeta();
    if (isGit) {
      await loadCommits();
    }
  })();
})();
