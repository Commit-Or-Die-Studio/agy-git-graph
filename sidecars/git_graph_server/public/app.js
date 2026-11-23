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
  const LANE_WIDTH = 14;
  const PADDING_LEFT = 12;

  // 狀態變數
  let currentRepo = localStorage.getItem('agy_git_graph_repo') || '';
  let allCommits = [];
  let allLinks = [];
  let maxLanes = 1;
  let selectedCommitHash = null;
  let currentBranchFilter = 'all';

  // DOM 元素快取
  const $ = (id) => document.getElementById(id);
  const projectDropdownBtn = $('project-dropdown-btn');
  const projectBtnIcon = $('project-btn-icon');
  const projectBtnName = $('project-btn-name');
  const projectMenuPopup = $('project-menu-popup');
  const branchBadgeEl = $('current-branch-badge');
  const statusBar = $('status-bar');
  const workingTreeStatusEl = $('working-tree-status');
  const commitsCountEl = $('commits-count');
  const branchSelect = $('branch-select');
  const searchInput = $('search-input');
  const btnClearSearch = $('btn-clear-search');
  const btnUpdatePlugin = $('btn-update-plugin');
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
  const drawerResizer = $('drawer-resizer');
  const btnMaximizeDrawer = $('btn-maximize-drawer');
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
  const btnPopoutDiff = $('btn-popout-diff');
  const btnMaximizeDiff = $('btn-maximize-diff');

  let currentDiffFile = '';

  // 時間格式化 (直接顯示絕對日期時間 YYYY-MM-DD HH:mm)
  function formatCommitDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const pad = (n) => String(n).padStart(2, '0');
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const min = pad(d.getMinutes());
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
  }

  // 路徑比對輔助函式 (跨平台相容)
  function isSamePath(a, b) {
    if (!a || !b) return false;
    const normA = a.replace(/\\/g, '/').replace(/\/+$/, '');
    const normB = b.replace(/\\/g, '/').replace(/\/+$/, '');
    if (normA === normB) return true;
    return normA.toLowerCase() === normB.toLowerCase();
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

  // HTML 字串轉義輔助函式
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // 關閉專案下拉選單
  function closeProjectMenu() {
    if (projectMenuPopup) projectMenuPopup.classList.add('hidden');
    if (projectDropdownBtn) projectDropdownBtn.classList.remove('active');
    document.querySelectorAll('.menu-parent.open').forEach(el => el.classList.remove('open'));
  }

  // 切換專案下拉選單展開/收合
  async function toggleProjectMenu() {
    if (!projectMenuPopup) return;
    const isHidden = projectMenuPopup.classList.contains('hidden');
    if (isHidden) {
      if (!cachedProjectsData || projectMenuPopup.children.length === 0) {
        await loadProjects();
      } else {
        renderProjectMenu();
      }
      projectMenuPopup.classList.remove('hidden');
      if (projectDropdownBtn) projectDropdownBtn.classList.add('active');
    } else {
      closeProjectMenu();
    }
  }

  // 切換當前 Repo
  async function switchRepo(path) {
    closeProjectMenu();
    currentRepo = path;
    lastStateHash = null;
    localStorage.setItem('agy_git_graph_repo', currentRepo);
    repoPathInput.value = currentRepo;
    repoSwitchBar.classList.add('hidden');
    updateProjectButtonText();
    loadingState.classList.remove('hidden');
    emptyState.classList.add('hidden');
    await loadRepoMeta();
    await loadCommits();
    updateProjectButtonText();
    renderProjectMenu();
  }

  let cachedProjectsData = null;

  // 更新頂部專案按鈕圖示與名稱
  function updateProjectButtonText() {
    if (!projectBtnName) return;
    if (!cachedProjectsData || !currentRepo) {
      projectBtnName.textContent = currentRepo ? currentRepo.split(/[\/\\]/).pop() : '選擇專案';
      if (projectBtnIcon) projectBtnIcon.textContent = '📁';
      return;
    }

    const { currentProject, sessionProjects } = cachedProjectsData;
    let foundName = '';
    let foundIcon = '📁';

    if (currentProject) {
      if (isSamePath(currentProject.path, currentRepo)) {
        foundName = currentProject.name;
        foundIcon = '📁';
      } else if (currentProject.submodules) {
        for (const sub of currentProject.submodules) {
          if (isSamePath(sub.path, currentRepo)) {
            foundName = sub.name;
            foundIcon = '📦';
            break;
          }
        }
      }
    }

    if (!foundName && Array.isArray(sessionProjects)) {
      for (const p of sessionProjects) {
        if (isSamePath(p.path, currentRepo)) {
          foundName = p.name;
          foundIcon = '📁';
          break;
        }
        if (p.submodules) {
          for (const sub of p.submodules) {
            if (isSamePath(sub.path, currentRepo)) {
              foundName = sub.name;
              foundIcon = '📦';
              break;
            }
          }
        }
        if (foundName) break;
      }
    }

    if (!foundName) {
      foundName = currentRepo.split(/[\/\\]/).pop() || '自訂專案';
      foundIcon = '📂';
    }

    if (projectBtnIcon) projectBtnIcon.textContent = foundIcon;
    projectBtnName.textContent = foundName;
    projectBtnName.title = currentRepo;
  }

  // 渲染專案選單 DOM (含向右展開之對話工作區二級子選單)
  function renderProjectMenu() {
    if (!projectMenuPopup || !cachedProjectsData) return;
    projectMenuPopup.innerHTML = '';

    let currentProj = cachedProjectsData.currentProject;
    const sessionProjs = Array.isArray(cachedProjectsData.sessionProjects) ? cachedProjectsData.sessionProjects : [];

    // 若後端未提供 currentProject 但前端已知 currentRepo，動態建立以保障選單渲染
    if (!currentProj && currentRepo) {
      currentProj = {
        name: currentRepo.split(/[\/\\]/).pop() || '當前專案',
        path: currentRepo,
        isGit: true,
        submodules: []
      };
    }

    // 輔助函式：將平面 submodules 轉為多層樹狀結構並渲染
    function renderSubmoduleTree(container, submodules, level = 0) {
      const root = { isDir: true, children: new Map(), items: [] };
      for (const sub of submodules) {
        const parts = (sub.relPath || sub.name).replace(/\\/g, '/').split('/').filter(Boolean);
        let cur = root;
        for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i];
          if (!cur.children.has(part)) {
            cur.children.set(part, { name: part, isDir: true, children: new Map(), items: [] });
          }
          cur = cur.children.get(part);
        }
        const leafName = parts[parts.length - 1] || sub.name;
        cur.items.push({ ...sub, leafName });
      }

      function containsCurrentRepo(node) {
        if (node.items.some(it => isSamePath(currentRepo, it.path))) return true;
        for (const child of node.children.values()) {
          if (containsCurrentRepo(child)) return true;
        }
        return false;
      }

      function countSubmodules(node) {
        let count = node.items.length;
        for (const child of node.children.values()) {
          count += countSubmodules(child);
        }
        return count;
      }

      function renderNode(targetEl, node, currentLevel) {
        const indent = 12 + currentLevel * 14;

        // 渲染目錄節點 (Folders)
        for (const [folderName, childNode] of node.children.entries()) {
          const totalCount = countSubmodules(childNode);
          const hasSelected = containsCurrentRepo(childNode);

          const folderEl = document.createElement('div');
          folderEl.className = 'tree-folder-header';
          folderEl.style.paddingLeft = `${indent}px`;
          folderEl.innerHTML = `
            <span class="tree-arrow ${hasSelected ? 'open' : ''}">▶</span>
            <span>📁</span>
            <span style="font-weight:600;">${escapeHtml(folderName)}</span>
            <span class="tree-badge">(${totalCount})</span>
          `;

          const childrenEl = document.createElement('div');
          childrenEl.className = `tree-folder-children ${hasSelected ? 'open' : ''}`;

          folderEl.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = childrenEl.classList.toggle('open');
            folderEl.querySelector('.tree-arrow').classList.toggle('open', isOpen);
          });

          targetEl.appendChild(folderEl);
          targetEl.appendChild(childrenEl);

          renderNode(childrenEl, childNode, currentLevel + 1);
        }

        // 渲染葉子項目 (Submodule Repos)
        for (const sub of node.items) {
          const subItem = document.createElement('div');
          subItem.className = `menu-item ${isSamePath(currentRepo, sub.path) ? 'selected' : ''}`;
          subItem.style.paddingLeft = `${indent}px`;
          subItem.innerHTML = `
            <span class="menu-item-text">
              <span>📦</span>
              <span>${escapeHtml(sub.leafName)}${sub.isGit ? '' : ' <span style="color:#fab387;font-size:10px;">(未初始化)</span>'}</span>
            </span>
          `;
          subItem.addEventListener('click', (e) => {
            e.stopPropagation();
            switchRepo(sub.path);
          });
          targetEl.appendChild(subItem);
        }
      }

      renderNode(container, root, level);
    }

    // 1. 第一分組：當前工作區 (本資料夾 Repo + Submodules)
    if (currentProj) {
      const header = document.createElement('div');
      header.className = 'menu-section-header';
      header.textContent = '📍 當前工作區 (本資料夾)';
      projectMenuPopup.appendChild(header);

      // 主 Repo
      const mainItem = document.createElement('div');
      mainItem.className = `menu-item ${isSamePath(currentRepo, currentProj.path) ? 'selected' : ''}`;
      mainItem.innerHTML = `<span class="menu-item-text"><span>📁</span><span>${escapeHtml(currentProj.name)}${currentProj.isGit ? '' : ' (非Git)'}</span></span>`;
      mainItem.addEventListener('click', (e) => {
        e.stopPropagation();
        switchRepo(currentProj.path);
      });
      projectMenuPopup.appendChild(mainItem);

      // Submodules (向右展開之二級樹狀選單，收納整齊不洗版)
      if (Array.isArray(currentProj.submodules) && currentProj.submodules.length > 0) {
        const subParent = document.createElement('div');
        subParent.className = 'menu-item menu-parent';
        subParent.innerHTML = `
          <span class="menu-item-text"><span>📦</span><span>子模組 (${currentProj.submodules.length})</span></span>
          <span class="menu-arrow">▶</span>
        `;

        const subSubmenu = document.createElement('div');
        subSubmenu.className = 'submenu-popup';

        // 以階層樹狀結構渲染子模組
        renderSubmoduleTree(subSubmenu, currentProj.submodules, 0);

        subParent.addEventListener('mouseenter', () => {
          const rect = subParent.getBoundingClientRect();
          if (rect.right + 260 <= window.innerWidth) {
            subSubmenu.style.left = '100%';
            subSubmenu.style.right = 'auto';
            subSubmenu.style.top = '-4px';
          } else {
            subSubmenu.style.left = 'auto';
            subSubmenu.style.right = '0';
            subSubmenu.style.top = '100%';
          }
        });

        subParent.appendChild(subSubmenu);
        projectMenuPopup.appendChild(subParent);
      }
    }

    // 分隔線
    const div1 = document.createElement('div');
    div1.className = 'menu-divider';
    projectMenuPopup.appendChild(div1);

    // 2. 第二分組：對話工作區 (Session Repos) -> 向右展開子選單
    const sessionParent = document.createElement('div');
    sessionParent.className = 'menu-item menu-parent';
    sessionParent.innerHTML = `
      <span class="menu-item-text"><span>💬</span><span>對話工作區 (Session Repos)</span></span>
      <span class="menu-arrow">▶</span>
    `;

    const submenu = document.createElement('div');
    submenu.className = 'submenu-popup';

    if (sessionProjs.length > 0) {
      sessionProjs.forEach(p => {
        const pItem = document.createElement('div');
        pItem.className = `menu-item ${isSamePath(currentRepo, p.path) ? 'selected' : ''}`;
        pItem.innerHTML = `<span class="menu-item-text"><span>📁</span><span>${escapeHtml(p.name)}${p.isGit ? '' : ' (非Git)'}</span></span>`;
        pItem.addEventListener('click', (e) => {
          e.stopPropagation();
          switchRepo(p.path);
        });
        submenu.appendChild(pItem);

        if (Array.isArray(p.submodules) && p.submodules.length > 0) {
          renderSubmoduleTree(submenu, p.submodules, 1);
        }
      });
    } else {
      const emptyItem = document.createElement('div');
      emptyItem.className = 'menu-item';
      emptyItem.style.color = '#6c7086';
      emptyItem.style.cursor = 'default';
      emptyItem.textContent = '(無其他對話專案)';
      submenu.appendChild(emptyItem);
    }

    // 智慧定位子選單，防止超出視窗邊界或跑至螢幕外
    sessionParent.addEventListener('mouseenter', () => {
      const rect = sessionParent.getBoundingClientRect();
      // 若右側空間充裕（>= 230px），向右展開；否則貼齊視窗可視範圍，絕不跑到負座標
      if (rect.right + 230 <= window.innerWidth) {
        submenu.style.left = '100%';
        submenu.style.right = 'auto';
      } else {
        submenu.style.left = 'auto';
        submenu.style.right = '0';
        submenu.style.top = '100%';
      }
    });

    sessionParent.addEventListener('click', (e) => {
      e.stopPropagation();
      sessionParent.classList.toggle('open');
    });

    sessionParent.appendChild(submenu);
    projectMenuPopup.appendChild(sessionParent);

    // 分隔線
    const div2 = document.createElement('div');
    div2.className = 'menu-divider';
    projectMenuPopup.appendChild(div2);

    // 3. 第三分組：自訂本機路徑
    const customItem = document.createElement('div');
    customItem.className = 'menu-item';
    customItem.innerHTML = '<span class="menu-item-text"><span>➕</span><span>自訂本機路徑...</span></span>';
    customItem.addEventListener('click', (e) => {
      e.stopPropagation();
      closeProjectMenu();
      repoSwitchBar.classList.remove('hidden');
      repoPathInput.focus();
    });
    projectMenuPopup.appendChild(customItem);
  }

  // 載入 AGY 專案清單資料
  async function loadProjects() {
    try {
      const res = await fetch(apiUrl('/api/projects')).then(r => r.json());
      if (res.ok) {
        cachedProjectsData = res;
        if (!currentRepo && res.currentRepo) {
          currentRepo = res.currentRepo;
          localStorage.setItem('agy_git_graph_repo', currentRepo);
        }
        updateProjectButtonText();
        renderProjectMenu();
      }
    } catch (err) {
      console.warn('載入專案選單失敗:', err);
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
        // 如果當前 repo 不是 Git，但專案清單中有可用的 Git 專案，自動切換至該專案
        if (cachedProjectsData && cachedProjectsData.currentProject && cachedProjectsData.currentProject.isGit && !isSamePath(cachedProjectsData.currentProject.path, currentRepo)) {
          await switchRepo(cachedProjectsData.currentProject.path);
          return true;
        }

        // 若當前尚未解析出任何 repo 路徑，維持載入/偵測狀態，避免閃爍出現「無 Git 倉庫」
        if (!currentRepo) {
          branchBadgeEl.textContent = '...';
          workingTreeStatusEl.innerHTML = '<span style="color:#89b4fa;">● 正在偵測對話工作區...</span>';
          loadingState.classList.remove('hidden');
          emptyState.classList.add('hidden');
          return false;
        }

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

      // 更新頂部專案選單狀態
      if (!cachedProjectsData || !cachedProjectsData.currentProject || !isSamePath(cachedProjectsData.currentProject.path, currentRepo)) {
        await loadProjects();
      } else {
        updateProjectButtonText();
        renderProjectMenu();
      }
      branchBadgeEl.textContent = `⎇ ${statusRes.currentBranch || 'HEAD'}`;
      branchBadgeEl.title = `目前檢出分支 (HEAD): ${statusRes.currentBranch || 'HEAD'}`;

      // Working Tree 狀態提示 (支援點擊查看變更)
      if (statusRes.isClean) {
        workingTreeStatusEl.innerHTML = '<span class="working-tree-btn" style="color:#a6e3a1;" title="點擊檢視工作區狀態">● 工作區乾淨 (Clean)</span>';
      } else {
        const parts = [];
        if (statusRes.stagedCount) parts.push(`${statusRes.stagedCount} 暫存`);
        if (statusRes.unstagedCount) parts.push(`${statusRes.unstagedCount} 修改`);
        if (statusRes.untrackedCount) parts.push(`${statusRes.untrackedCount} 未追蹤`);
        workingTreeStatusEl.innerHTML = `<span class="working-tree-btn" style="color:#f9e2af;" title="點擊檢視未提交的變更清單與 Diff">● ${parts.join(', ')} (點擊查看)</span>`;
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
  async function loadCommits({ silent = false } = {}) {
    if (!silent) {
      loadingState.classList.remove('hidden');
    }
    emptyState.classList.add('hidden');

    try {
      const res = await fetch(apiUrl('/api/commits', {
        branch: currentBranchFilter,
        limit: 150
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
      const isHeadCommit = c.refs && c.refs.some(r => r.type === 'head' || r.isHead);

      if (isHeadCommit) {
        // 當前 Checkout 節點 (高亮 Bullseye 同心圓，一眼看出當前位置)
        circlesHtml += `
          <circle cx="${cx}" cy="${cy}" r="7" fill="none" stroke="#cba6f7" stroke-width="2.2"/>
          <circle cx="${cx}" cy="${cy}" r="3.5" fill="#cba6f7" stroke="#181825" stroke-width="1"/>
        `;
      } else if (isMerge) {
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

    // 預先計算每一列實際佔用的最大軌道 (動態緊湊 Spacer，消除無用空白)
    const rowMaxLanes = new Array(visibleCommits.length).fill(0);
    visibleCommits.forEach((c, idx) => {
      rowMaxLanes[idx] = Math.max(rowMaxLanes[idx], c.x);
    });

    for (const link of allLinks) {
      const commit = allCommits[link.fromY];
      const parent = allCommits[link.toY];
      if (!commit || !parent) continue;

      const fromRow = rowMap.get(commit.hash);
      const toRow = rowMap.get(parent.hash);
      if (fromRow === undefined || toRow === undefined) continue;

      const minRow = Math.min(fromRow, toRow);
      const maxRow = Math.max(fromRow, toRow);
      const maxLinkX = Math.max(link.fromX, link.toX);

      for (let r = minRow; r <= maxRow; r++) {
        rowMaxLanes[r] = Math.max(rowMaxLanes[r], maxLinkX);
      }
    }

    // 3. 渲染 Commit 列表 (文字與裝飾 Badge)
    commitList.innerHTML = '';
    const fragment = document.createDocumentFragment();

    visibleCommits.forEach((commit, rowIdx) => {
      const isHeadCommit = commit.refs && commit.refs.some(r => r.type === 'head' || r.isHead);
      const row = document.createElement('div');
      row.className = `commit-row ${isHeadCommit ? 'is-head-commit' : ''}`;
      row.dataset.hash = commit.hash;
      if (commit.hash === selectedCommitHash) row.classList.add('selected');

      // 左側預留圖形寬度 Spacer (依當前行實際軌道動態計算，緊湊消除空白)
      const maxLaneInRow = rowMaxLanes[rowIdx] !== undefined ? rowMaxLanes[rowIdx] : commit.x;
      const rowSpacerWidth = PADDING_LEFT + maxLaneInRow * LANE_WIDTH + 10;

      const spacer = document.createElement('div');
      spacer.className = 'commit-graph-spacer';
      spacer.style.width = `${rowSpacerWidth}px`;
      row.appendChild(spacer);

      // 右側內容
      const content = document.createElement('div');
      content.className = 'commit-content';

      // 裝飾標籤 (Badges: HEAD, branch, tag, remote)
      if (commit.refs && commit.refs.length > 0) {
        // 整理 Refs：若本地分支與遠端分支重疊於同一 Commit，自動合併為單一標籤
        const processedRefs = [];
        const usedRemoteIndices = new Set();

        // 1. 處理本地分支 (head 或 branch)
        for (let i = 0; i < commit.refs.length; i++) {
          const ref = commit.refs[i];
          if ((ref.type === 'head' || ref.type === 'branch') && ref.name !== 'HEAD') {
            const branchName = ref.name;
            const matchedRemotes = [];

            for (let j = 0; j < commit.refs.length; j++) {
              if (usedRemoteIndices.has(j)) continue;
              const r = commit.refs[j];
              if (r.type === 'remote') {
                const rBranch = r.name.includes('/') ? r.name.split('/').slice(1).join('/') : r.name;
                if (rBranch === branchName) {
                  usedRemoteIndices.add(j);
                  matchedRemotes.push(r.name);
                }
              }
            }

            if (matchedRemotes.length > 0) {
              processedRefs.push({
                type: ref.type === 'head' ? 'head-synced' : 'branch-synced',
                name: branchName,
                isHead: ref.isHead,
                matchedRemotes,
                isSynced: true
              });
            } else {
              processedRefs.push(ref);
            }
          } else if (ref.type === 'head' && ref.name === 'HEAD') {
            processedRefs.push(ref);
          }
        }

        // 2. 依原序加入非本地分支 (tag、未配對的 remote 等)
        for (let i = 0; i < commit.refs.length; i++) {
          if (usedRemoteIndices.has(i)) continue;
          const ref = commit.refs[i];
          if (ref.type !== 'head' && ref.type !== 'branch') {
            processedRefs.push(ref);
          }
        }

        processedRefs.forEach(ref => {
          const badge = document.createElement('span');
          badge.className = `commit-badge badge-${ref.type}`;

          if (ref.isSynced) {
            badge.innerHTML = `⎇ ${escapeHtml(ref.name)} <span class="badge-icon-cloud" title="已同步至遠端: ${escapeHtml(ref.matchedRemotes.join(', '))}">☁</span>`;
            const headDesc = ref.isHead ? '目前檢出分支 (HEAD)' : '本地分支';
            badge.title = `${headDesc}: ${ref.name} ⬌ 遠端: ${ref.matchedRemotes.join(', ')} (已同步)`;
          } else {
            let icon = '⎇ ';
            let displayName = ref.name;
            if (ref.type === 'tag') {
              icon = '🏷️ ';
            } else if (ref.type === 'head') {
              icon = ref.name === 'HEAD' ? '⌖ ' : '⎇ ';
            } else if (ref.type === 'remote') {
              icon = '☁ ';
              // 若為 origin/xxx，精簡顯示以釋放空間，hover 顯示完整名稱
              if (displayName.startsWith('origin/')) {
                displayName = displayName.substring('origin/'.length);
              }
            }

            badge.textContent = `${icon}${displayName}`;
            badge.title = `${ref.type === 'head' ? (ref.name === 'HEAD' ? '目前檢出 (HEAD 分離狀態)' : `目前檢出分支 (HEAD): ${ref.name}`) : (ref.type === 'remote' ? `遠端分支: ${ref.name}` : (ref.type === 'tag' ? `標籤: ${ref.name}` : `分支: ${ref.name}`))}`;
          }

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
      date.textContent = formatCommitDate(commit.date);
      date.title = new Date(commit.date).toLocaleString('zh-TW', { hour12: false });

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

      // 點擊事件：展開/收合詳情 Drawer (再次點擊相同 Commit 則關閉)
      row.addEventListener('click', () => {
        if (selectedCommitHash === commit.hash && !detailDrawer.classList.contains('hidden')) {
          closeDrawer();
        } else {
          openCommitDetail(commit.hash);
        }
      });

      fragment.appendChild(row);
    });

    commitList.appendChild(fragment);
  }

  // 開啟 Commit 詳情 Drawer
  async function openCommitDetail(hash) {
    selectedCommitHash = hash;
    statusBar.classList.remove('selected');
    detailHash.classList.remove('badge-working');
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

          // 檔案快捷操作 (在主畫面獨立開啟 Diff)
          const actionsDiv = document.createElement('div');
          actionsDiv.className = 'file-actions';
          const quickPopBtn = document.createElement('button');
          quickPopBtn.className = 'file-quick-btn';
          quickPopBtn.textContent = '↗';
          quickPopBtn.title = '在主畫面新視窗查看 Diff';
          quickPopBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openPopoutDiff(hash, file.path);
          });
          actionsDiv.appendChild(quickPopBtn);
          li.appendChild(actionsDiv);

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

  // 顯示輕量通知 Toast
  function showToast(msg) {
    let toast = $('app-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'app-toast';
      toast.className = 'app-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 2500);
  }

  // 開啟獨立大視窗查看 Diff
  async function openPopoutDiff(hash, filePath) {
    showToast('正在開啟外部瀏覽器...');

    // 透過後端構建本機 HTTP 網址並呼叫系統預設瀏覽器（突破 Webview 協定限制）
    try {
      const res = await fetch(apiUrl('/api/open-external', { hash, file: filePath })).then(r => r.json());
      if (res.ok) {
        showToast('已在系統瀏覽器開啟獨立 Diff！');
        if (res.url && navigator.clipboard && navigator.clipboard.writeText) {
          try {
            await navigator.clipboard.writeText(res.url);
          } catch {}
        }
      } else {
        showToast(`開啟失敗: ${res.error || '無法開啟'}`);
      }
    } catch (err) {
      showToast(`開啟失敗: ${err.message}`);
    }
  }

  // 載入並渲染單一檔案的 Diff
  async function loadFileDiff(hash, filePath) {
    currentDiffFile = filePath;
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

  // 開啟工作區未提交變更詳情
  async function openWorkingTreeDetail() {
    selectedCommitHash = 'WORKING';
    if (statusBar) statusBar.classList.add('selected');
    detailHash.classList.add('badge-working');
    document.querySelectorAll('.commit-row.selected').forEach(r => r.classList.remove('selected'));

    detailDrawer.classList.remove('hidden');
    diffSection.classList.add('hidden');
    detailHash.textContent = 'WORKING';
    detailAuthor.textContent = '本機工作區 (Uncommitted)';
    detailSubject.textContent = '載入工作區檔案變更...';
    detailDate.textContent = '即時狀態';
    detailBodyText.classList.add('hidden');
    fileList.innerHTML = '<li style="padding:6px; color:#9399b2;">載入工作區檔案中...</li>';

    try {
      const res = await fetch(apiUrl('/api/working-tree')).then(r => r.json());
      if (!res.ok) throw new Error(res.error || 'Failed to load working tree');

      detailHash.textContent = 'WORKING';
      detailAuthor.textContent = '未提交的工作區變更 (Working Tree)';
      detailSubject.textContent = res.isClean ? '工作區乾淨，沒有未提交的變更' : `共 ${res.files.length} 個檔案已變更`;
      detailDate.textContent = new Date().toLocaleTimeString('zh-TW');

      detailFilesCount.textContent = res.files ? res.files.length : 0;
      fileList.innerHTML = '';

      if (res.files && res.files.length > 0) {
        res.files.forEach(file => {
          const li = document.createElement('li');
          li.className = 'file-item';

          const statusBadge = document.createElement('span');
          statusBadge.className = `file-status status-${file.status}`;
          statusBadge.textContent = file.status;
          statusBadge.title = file.label;

          const pathSpan = document.createElement('span');
          pathSpan.className = 'file-path';
          pathSpan.textContent = file.path;
          pathSpan.title = `${file.path} (${file.label})`;

          li.appendChild(statusBadge);
          li.appendChild(pathSpan);

          // 檔案快捷操作 (在主畫面獨立開啟 Diff)
          const actionsDiv = document.createElement('div');
          actionsDiv.className = 'file-actions';
          const quickPopBtn = document.createElement('button');
          quickPopBtn.className = 'file-quick-btn';
          quickPopBtn.textContent = '↗';
          quickPopBtn.title = '在主畫面新視窗查看 Diff';
          quickPopBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openPopoutDiff('WORKING', file.path);
          });
          actionsDiv.appendChild(quickPopBtn);
          li.appendChild(actionsDiv);

          // 點擊檔案檢視 Diff
          li.addEventListener('click', () => {
            loadWorkingDiff(file.path);
          });

          fileList.appendChild(li);
        });
      } else {
        fileList.innerHTML = '<li style="padding:8px; color:#a6e3a1;">工作區完全乾淨 (Working tree clean)</li>';
      }
    } catch (err) {
      console.error('Failed to load working tree details:', err);
      detailSubject.textContent = `載入失敗: ${err.message}`;
    }
  }

  // 載入工作區特定檔案的 Diff
  async function loadWorkingDiff(filePath) {
    currentDiffFile = filePath;
    diffSection.classList.remove('hidden');
    diffFilename.textContent = `[WORKING] ${filePath}`;
    diffContent.textContent = '載入 Diff 中...';

    try {
      const res = await fetch(apiUrl('/api/working-diff', { file: filePath })).then(r => r.json());
      if (!res.ok) throw new Error(res.error || 'Failed to load working diff');

      const lines = (res.diff || '').split('\n');
      diffContent.innerHTML = '';
      if (!res.diff || !res.diff.trim()) {
        diffContent.innerHTML = '<div style="padding:10px;color:#9399b2;">無差異 (可能檔案內容無變動或僅權限變更)</div>';
        return;
      }

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
  let currentInstalledVersion = '';
  let latestAvailableVersion = '';
  let hasAvailableUpdate = false;

  async function checkPluginUpdate(force = false, notifyIfLatest = false) {
    if (!btnUpdatePlugin) return;
    try {
      const res = await fetch(`/api/update-check${force ? '?force=1' : ''}`).then(r => r.json());
      if (res && res.ok) {
        currentInstalledVersion = res.currentVersion || currentInstalledVersion;
        if (res.hasUpdate && res.latestVersion) {
          hasAvailableUpdate = true;
          latestAvailableVersion = res.latestVersion;
          btnUpdatePlugin.classList.add('has-update');
          btnUpdatePlugin.textContent = `⬆ v${res.latestVersion}`;
          btnUpdatePlugin.title = `發現新版本 v${res.latestVersion}（目前版本 v${res.currentVersion}）\n點擊一鍵自動下載並更新`;
          if (notifyIfLatest) {
            showToast(`🚀 發現新版本 v${res.latestVersion}，再次點擊即可自動更新！`);
          }
        } else {
          hasAvailableUpdate = false;
          latestAvailableVersion = '';
          btnUpdatePlugin.classList.remove('has-update');
          btnUpdatePlugin.textContent = `v${res.currentVersion || '1.0.0'}`;
          btnUpdatePlugin.title = `目前版本: v${res.currentVersion || '1.0.0'}（點擊檢查 GitHub 最新版本）`;
          if (notifyIfLatest) {
            if (res.offline) {
              showToast(`⚠️ 無法連線至 GitHub（目前版本 v${res.currentVersion}）`);
            } else {
              showToast(`✔ 目前已是最新版本 (v${res.currentVersion})`);
            }
          }
        }
      }
    } catch {}
  }

  if (btnUpdatePlugin) {
    btnUpdatePlugin.addEventListener('click', async () => {
      if (btnUpdatePlugin.disabled) return;

      // 若目前無新版本，點擊時主動檢查是否有新版本
      if (!hasAvailableUpdate) {
        btnUpdatePlugin.disabled = true;
        btnUpdatePlugin.textContent = '檢查中...';
        await checkPluginUpdate(true, true);
        btnUpdatePlugin.disabled = false;
        return;
      }

      const targetVer = latestAvailableVersion ? `v${latestAvailableVersion}` : '最新版本';
      btnUpdatePlugin.disabled = true;
      btnUpdatePlugin.textContent = '⏳ 更新中...';
      try {
        const res = await fetch('/api/update-apply', { method: 'POST' }).then(r => r.json());
        if (res && res.ok) {
          btnUpdatePlugin.textContent = `✔ v${res.updatedTo}`;
          showToast(`🎉 已更新至 v${res.updatedTo}，正在重新載入...`);
          setTimeout(() => {
            window.location.reload();
          }, 1200);
        } else {
          throw new Error((res && res.error) || '更新失敗');
        }
      } catch (err) {
        showToast(`❌ 自動更新失敗: ${err.message}`);
        btnUpdatePlugin.disabled = false;
        btnUpdatePlugin.textContent = `⬆ ${targetVer}`;
      }
    });
  }

  btnRefresh.addEventListener('click', async () => {
    btnRefresh.style.transition = 'transform 0.6s ease';
    btnRefresh.style.transform = 'rotate(360deg)';
    try {
      // 嘗試拉取遠端最新變更 (非同步 quiet fetch) 與檢查外掛新版本
      fetch(apiUrl('/api/fetch'), { method: 'POST' }).catch(() => {});
      checkPluginUpdate(true);
    } catch {}
    const isGit = await loadRepoMeta();
    if (isGit) {
      await loadCommits();
    }
    setTimeout(() => {
      btnRefresh.style.transition = '';
      btnRefresh.style.transform = '';
    }, 600);
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

  if (projectDropdownBtn) {
    projectDropdownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleProjectMenu();
    });
  }

  // 點擊選單外部自動關閉下拉選單
  document.addEventListener('click', (e) => {
    if (projectDropdownBtn && !projectDropdownBtn.contains(e.target) &&
        projectMenuPopup && !projectMenuPopup.contains(e.target)) {
      closeProjectMenu();
    }
  });

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
        lastGraphHash = null;
      lastStateHash = null;
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

  function closeDrawer() {
    detailDrawer.classList.add('hidden');
    selectedCommitHash = null;
    if (statusBar) statusBar.classList.remove('selected');
    detailHash.classList.remove('badge-working');
    document.querySelectorAll('.commit-row.selected').forEach(r => r.classList.remove('selected'));
  }

  btnCloseDrawer.addEventListener('click', closeDrawer);

  // 點擊狀態列檢視未提交的工作區變更 (Working Tree，再次點擊則關閉)
  if (statusBar) {
    statusBar.addEventListener('click', () => {
      if (selectedCommitHash === 'WORKING' && !detailDrawer.classList.contains('hidden')) {
        closeDrawer();
      } else {
        openWorkingTreeDetail();
      }
    });
  }

  btnCloseDiff.addEventListener('click', () => {
    diffSection.classList.add('hidden');
    if (diffSection.classList.contains('diff-fullscreen')) {
      diffSection.classList.remove('diff-fullscreen');
      btnMaximizeDiff.textContent = '⛶';
      const drawerBody = document.querySelector('.drawer-body');
      if (drawerBody && diffSection.parentElement !== drawerBody) {
        drawerBody.appendChild(diffSection);
      }
    }
  });

  // 在獨立大視窗中開啟 Diff
  btnPopoutDiff.addEventListener('click', () => {
    if (selectedCommitHash && currentDiffFile) {
      openPopoutDiff(selectedCommitHash, currentDiffFile);
    }
  });

  // 在側邊欄內全螢幕展開 Diff
  btnMaximizeDiff.addEventListener('click', () => {
    const isFull = diffSection.classList.toggle('diff-fullscreen');
    btnMaximizeDiff.textContent = isFull ? '🗗' : '⛶';
    btnMaximizeDiff.title = isFull ? '還原視窗' : '在側邊欄內全螢幕展開';
    if (isFull) {
      document.body.appendChild(diffSection);
    } else {
      const drawerBody = document.querySelector('.drawer-body');
      if (drawerBody && diffSection.parentElement !== drawerBody) {
        drawerBody.appendChild(diffSection);
      }
    }
  });

  // 抽屜可拖曳拉桿 (Draggable Resizer)
  let isResizing = false;
  let isDrawerMaximized = false;
  let savedDrawerHeight = parseFloat(localStorage.getItem('agy_git_graph_drawer_h'));
  if (!savedDrawerHeight || savedDrawerHeight === 50) {
    savedDrawerHeight = 62;
    localStorage.setItem('agy_git_graph_drawer_h', 62);
  }

  detailDrawer.style.height = `${savedDrawerHeight}%`;

  drawerResizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    drawerResizer.classList.add('resizing');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const container = document.querySelector('.app-container');
    const containerHeight = container.clientHeight;
    const mouseY = e.clientY;
    const fromBottom = containerHeight - mouseY;
    let percent = (fromBottom / containerHeight) * 100;
    percent = Math.max(18, Math.min(92, percent)); // 限制在 18% ~ 92%
    detailDrawer.style.height = `${percent}%`;
    savedDrawerHeight = percent;
    localStorage.setItem('agy_git_graph_drawer_h', percent);
  });

  window.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      drawerResizer.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });

  // 雙擊手把快速切換半屏 (50%) 與大視窗 (88%)
  drawerResizer.addEventListener('dblclick', () => {
    toggleMaximizeDrawer();
  });

  btnMaximizeDrawer.addEventListener('click', () => {
    toggleMaximizeDrawer();
  });

  function toggleMaximizeDrawer() {
    isDrawerMaximized = !isDrawerMaximized;
    if (isDrawerMaximized) {
      detailDrawer.style.height = '88%';
      btnMaximizeDrawer.textContent = '🗗';
      btnMaximizeDrawer.title = '還原面板高度';
    } else {
      detailDrawer.style.height = `${savedDrawerHeight || 50}%`;
      btnMaximizeDrawer.textContent = '⛶';
      btnMaximizeDrawer.title = '最大化面板';
    }
  }

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
      new URLSearchParams(window.location.search).get('conv') ||
      ''
    );
  }

  // 自動切換對話專案：
  // 僅在 AGY 明確提供 conversationId 且切換到不同對話時自動切換；
  // 若拿不到 conversationId，僅在初次啟動尚未選定專案時偵測一次，避免多視窗/背景對話互相搶奪畫面。
  let hasInitialFallbackResolve = false;

  async function syncActiveSessionRepo() {
    const convId = getCurrentConvId();
    if (convId) {
      if (convId === activeConvId) return;
      activeConvId = convId;
    } else {
      if (currentRepo || hasInitialFallbackResolve) return;
      hasInitialFallbackResolve = true;
    }

    try {
      const q = convId ? `?conv=${encodeURIComponent(convId)}` : '';
      const res = await fetch(`/api/resolve-session${q}`).then(r => r.json());
      if (res.ok && res.found && res.repoPath && res.isGit) {
        const normalizedTarget = res.repoPath.toLowerCase().replace(/\\/g, '/');
        const normalizedCurrent = currentRepo ? currentRepo.toLowerCase().replace(/\\/g, '/') : '';
        if (normalizedTarget !== normalizedCurrent) {
          currentRepo = res.repoPath;
          lastGraphHash = null;
          lastStateHash = null;
          localStorage.setItem('agy_git_graph_repo', currentRepo);
          updateProjectButtonText();
          loadingState.classList.remove('hidden');
          emptyState.classList.add('hidden');
          loadingState.querySelector('p').textContent = '正在載入 Git 歷史記錄...';
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

  // 自動偵測本地 Git 狀態變更 (Watch State)
  let lastGraphHash = null;
  let lastStateHash = null;
  let isCheckingState = false;

  async function checkGitStateChange() {
    if (!currentRepo || isCheckingState) return;
    isCheckingState = true;
    try {
      const res = await fetch(apiUrl('/api/watch-state')).then(r => r.json());
      if (res.ok && typeof res.stateHash === 'string') {
        const graphHash = typeof res.graphHash === 'string' ? res.graphHash : res.stateHash;
        if (lastStateHash === null) {
          lastGraphHash = graphHash;
          lastStateHash = res.stateHash;
        } else if (graphHash !== lastGraphHash) {
          // Commit 歷史 / 分支 / 遠端指標變動：靜默重繪分支圖與狀態列
          lastGraphHash = graphHash;
          lastStateHash = res.stateHash;
          const isGit = await loadRepoMeta();
          if (isGit) {
            await loadCommits({ silent: true });
            if (selectedCommitHash === 'WORKING') {
              await openWorkingTreeDetail();
            }
          }
        } else if (res.stateHash !== lastStateHash) {
          // 僅工作區未提交檔案變動：只更新狀態列與抽屜，不重繪 Commit 分支圖
          lastStateHash = res.stateHash;
          await loadRepoMeta();
          if (selectedCommitHash === 'WORKING') {
            await openWorkingTreeDetail();
          }
        }
      }
    } catch (err) {
      // 靜默處理
    } finally {
      isCheckingState = false;
    }
  }

  // 每 1.2 秒輪詢檢查對話切換，每 1.5 秒輪詢檢查本地 Git state，每 30 分鐘檢查一次 GitHub 外掛新版本
  setInterval(syncActiveSessionRepo, 1200);
  setInterval(checkGitStateChange, 1500);
  setInterval(() => checkPluginUpdate(false), 30 * 60 * 1000);

  // 初始啟動
  (async () => {
    updateProjectButtonText();
    loadingState.classList.remove('hidden');
    emptyState.classList.add('hidden');

    checkPluginUpdate(false);
    await loadProjects();
    await syncActiveSessionRepo();
    const isGit = await loadRepoMeta();
    if (isGit) {
      await loadCommits();
    }
  })();
})();
