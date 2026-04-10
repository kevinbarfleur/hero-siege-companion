/* ═══════════════════════════════════════════
   Preset Editor — editor.js
   Full preset CRUD, two-panel layout,
   SortableJS drag & drop, TipTap inline editing
   ═══════════════════════════════════════════ */

let presetsData = { active_preset_id: null, presets: [] };
let webQuestData = null;
let webFarmData = null;
let searchTerm = '';
let activeEditors = [];
let sortableInstances = [];
let focusCatIndex = 0; // which category receives new items
let activeBrowser = 'quests'; // 'quests' | 'farm'

// ─── Utility functions (duplicated from app.js for independence) ───

function genId() { return crypto.randomUUID(); }

function getActivePreset() {
  if (!presetsData.active_preset_id) return null;
  return presetsData.presets.find(p => p.id === presetsData.active_preset_id) || null;
}

function isQuestInPreset(preset, questline, questName) {
  if (!preset) return false;
  for (const cat of preset.categories) {
    for (const item of cat.items) {
      if (item.type === 'quest' && item.questline === questline && item.quest_name === questName) return true;
    }
  }
  return false;
}

function findWebQuest(questline, questName) {
  if (!webQuestData || !webQuestData.questlines) return null;
  for (const ql of webQuestData.questlines) {
    if (ql.questline === questline) {
      return ql.quests.find(q => q.name === questName) || null;
    }
  }
  return null;
}

function cleanDescription(desc) {
  if (!desc) return '';
  return desc.replace(/\[nl\]/g, ' ').replace(/\[.*?\]/g, '').trim();
}

function getObjectiveIcon(label) {
  const l = label.toLowerCase();
  if (l.includes('slain') || l.includes('killed') || l.includes('defeat') || l.includes('slay') || l.includes('kill')) return '\u2694\uFE0F';
  if (l.includes('collected') || l.includes('gather') || l.includes('collect') || l.includes('ore') || l.includes('ingredient')) return '\uD83D\uDCE6';
  if (l.includes('found') || l.includes('reached') || l.includes('entered') || l.includes('cleared')) return '\uD83D\uDCCD';
  if (l.includes('open') || l.includes('craft') || l.includes('prospect')) return '\uD83D\uDD27';
  if (l.includes('saved') || l.includes('escort') || l.includes('help') || l.includes('report')) return '\uD83D\uDCDC';
  return '\u25C6';
}

function countDone(cat) {
  return cat.items.filter(i => i.done).length;
}

function applyFontTheme(theme) {
  const root = document.documentElement;
  if (theme === 'system') {
    root.style.setProperty('--font-display', '"Segoe UI", Tahoma, sans-serif');
    root.style.setProperty('--font-body', '"Segoe UI", Tahoma, sans-serif');
  } else {
    root.style.setProperty('--font-display', 'Georgia, "Times New Roman", serif');
    root.style.setProperty('--font-body', 'Georgia, "Times New Roman", serif');
  }
}

// ─── TipTap editor ───

function createNoteEditor(container, content, placeholder) {
  if (window.TipTap) {
    const wrap = document.createElement('div');
    wrap.className = 'tiptap-wrap';
    const toolbar = document.createElement('div');
    toolbar.className = 'tiptap-toolbar';
    toolbar.innerHTML = `
      <button class="tiptap-toolbar__btn" data-cmd="bold" title="Bold"><b>B</b></button>
      <button class="tiptap-toolbar__btn" data-cmd="italic" title="Italic"><i>I</i></button>
      <button class="tiptap-toolbar__btn" data-cmd="underline" title="Underline"><u>U</u></button>
      <button class="tiptap-toolbar__btn" data-cmd="strike" title="Strikethrough"><s>S</s></button>
    `;
    const editorDiv = document.createElement('div');
    editorDiv.className = 'tiptap-editor';
    wrap.appendChild(toolbar);
    wrap.appendChild(editorDiv);
    container.appendChild(wrap);

    const editor = new window.TipTap.Editor({
      element: editorDiv,
      extensions: [
        window.TipTap.StarterKit,
        window.TipTap.Placeholder.configure({ placeholder: placeholder || 'Write a note...' }),
        window.TipTap.Underline,
      ],
      content: content || '',
    });

    toolbar.querySelectorAll('[data-cmd]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const cmd = btn.dataset.cmd;
        if (cmd === 'bold') editor.chain().focus().toggleBold().run();
        else if (cmd === 'italic') editor.chain().focus().toggleItalic().run();
        else if (cmd === 'underline') editor.chain().focus().toggleUnderline().run();
        else if (cmd === 'strike') editor.chain().focus().toggleStrike().run();
      });
    });

    editor.on('selectionUpdate', () => {
      toolbar.querySelectorAll('[data-cmd]').forEach(btn => {
        const active = editor.isActive(btn.dataset.cmd);
        btn.classList.toggle('tiptap-toolbar__btn--active', active);
      });
    });

    activeEditors.push(editor);
    return { getHTML: () => editor.getHTML(), destroy: () => editor.destroy(), editor };
  }

  // Fallback: textarea
  const textarea = document.createElement('textarea');
  textarea.className = 'note-textarea';
  textarea.value = content ? content.replace(/<[^>]+>/g, '') : '';
  textarea.placeholder = placeholder || 'Write a note...';
  container.appendChild(textarea);
  return { getHTML: () => textarea.value, destroy: () => {} };
}

function cleanupEditors() {
  activeEditors.forEach(e => { try { e.destroy(); } catch (x) {} });
  activeEditors = [];
}

// ─── Confirm dialog ───

function showConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('editor-overlay');
    overlay.style.display = 'flex';
    overlay.onclick = (e) => { if (e.target === overlay) { resolve(false); overlay.style.display = 'none'; overlay.innerHTML = ''; } };

    const popup = document.createElement('div');
    popup.className = 'add-popup add-popup--small';
    popup.onclick = (e) => e.stopPropagation();
    popup.innerHTML = `
      <div class="add-popup__title">Confirm</div>
      <p class="add-popup__text">${message}</p>
      <div class="add-popup__actions">
        <button class="runic-btn" id="confirm-cancel">Cancel</button>
        <button class="runic-btn runic-btn--danger" id="confirm-ok">Delete</button>
      </div>
    `;
    overlay.innerHTML = '';
    overlay.appendChild(popup);

    popup.querySelector('#confirm-cancel').addEventListener('click', () => {
      resolve(false); overlay.style.display = 'none'; overlay.innerHTML = '';
    });
    popup.querySelector('#confirm-ok').addEventListener('click', () => {
      resolve(true); overlay.style.display = 'none'; overlay.innerHTML = '';
    });
  });
}

function showPrompt(title, defaultValue) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('editor-overlay');
    overlay.style.display = 'flex';
    overlay.onclick = (e) => { if (e.target === overlay) { resolve(null); overlay.style.display = 'none'; overlay.innerHTML = ''; } };

    const popup = document.createElement('div');
    popup.className = 'add-popup add-popup--small';
    popup.onclick = (e) => e.stopPropagation();
    popup.innerHTML = `
      <div class="add-popup__title">${title}</div>
      <div class="add-popup__field">
        <input class="add-popup__input" type="text" id="prompt-input" value="${defaultValue || ''}">
      </div>
      <div class="add-popup__actions">
        <button class="runic-btn" id="prompt-cancel">Cancel</button>
        <button class="runic-btn runic-btn--primary" id="prompt-ok">OK</button>
      </div>
    `;
    overlay.innerHTML = '';
    overlay.appendChild(popup);

    const input = popup.querySelector('#prompt-input');
    setTimeout(() => { input.focus(); input.select(); }, 50);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { resolve(input.value.trim()); overlay.style.display = 'none'; overlay.innerHTML = ''; }
      if (e.key === 'Escape') { resolve(null); overlay.style.display = 'none'; overlay.innerHTML = ''; }
    });
    popup.querySelector('#prompt-cancel').addEventListener('click', () => {
      resolve(null); overlay.style.display = 'none'; overlay.innerHTML = '';
    });
    popup.querySelector('#prompt-ok').addEventListener('click', () => {
      resolve(input.value.trim()); overlay.style.display = 'none'; overlay.innerHTML = '';
    });
  });
}

// ─── Save & notify ───

async function saveAndRender() {
  try { await window.pywebview.api.save_presets_data(presetsData); } catch (e) {}
  renderAll();
}

// ─── Render everything ───

function renderAll() {
  renderTopbar();
  if (activeBrowser === 'farm') {
    renderFarmBrowser();
  } else {
    renderQuestBrowser();
  }
  renderPresetTree();
}

// ═══════════════════════════════════════════
// TOP BAR — Preset selector + actions
// ═══════════════════════════════════════════

function renderTopbar() {
  const container = document.getElementById('editor-topbar');
  const preset = getActivePreset();

  let html = `<div class="editor-topbar__select" id="ed-topbar-select">`;
  html += `<div class="editor-topbar__trigger" id="ed-topbar-trigger">`;
  html += `<span class="editor-topbar__name">${preset ? preset.name : 'No preset selected'}</span>`;
  html += `<svg class="editor-topbar__chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6l4 4 4-4"/></svg>`;
  html += `</div>`;
  html += `<div class="editor-topbar__dropdown" id="ed-topbar-dropdown" style="display:none;">`;
  for (const p of presetsData.presets) {
    html += `<button class="editor-topbar__option${p.id === presetsData.active_preset_id ? ' editor-topbar__option--active' : ''}" data-preset-id="${p.id}">${p.name}</button>`;
  }
  html += `</div></div>`;

  html += `<button class="runic-btn runic-btn--sm runic-btn--primary" id="ed-new-preset">+ New</button>`;
  if (preset) {
    html += `<button class="runic-btn runic-btn--sm" id="ed-rename-preset">Rename</button>`;
  }

  container.innerHTML = html;
  initTopbarListeners();
}

function initTopbarListeners() {
  const trigger = document.getElementById('ed-topbar-trigger');
  const dropdown = document.getElementById('ed-topbar-dropdown');
  const selectWrap = document.getElementById('ed-topbar-select');

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.style.display !== 'none';
    dropdown.style.display = isOpen ? 'none' : 'block';
    selectWrap.classList.toggle('editor-topbar__select--open', !isOpen);
  });

  dropdown.querySelectorAll('[data-preset-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      presetsData.active_preset_id = btn.dataset.presetId;
      focusCatIndex = 0;
      dropdown.style.display = 'none';
      selectWrap.classList.remove('editor-topbar__select--open');
      saveAndRender();
    });
  });

  document.getElementById('ed-new-preset').addEventListener('click', async () => {
    const name = await showPrompt('New Preset', 'My Preset');
    if (!name) return;
    const newPreset = {
      id: genId(),
      name,
      created_at: new Date().toISOString().slice(0, 10),
      categories: [{ id: genId(), name: 'General', collapsed: false, items: [] }],
    };
    presetsData.presets.push(newPreset);
    presetsData.active_preset_id = newPreset.id;
    focusCatIndex = 0;
    saveAndRender();
  });

  const renameBtn = document.getElementById('ed-rename-preset');
  if (renameBtn) {
    renameBtn.addEventListener('click', async () => {
      const preset = getActivePreset();
      if (!preset) return;
      const name = await showPrompt('Rename Preset', preset.name);
      if (name && name !== preset.name) {
        preset.name = name;
        saveAndRender();
      }
    });
  }

  // Close dropdown on outside click
  document.addEventListener('click', () => {
    dropdown.style.display = 'none';
    selectWrap.classList.remove('editor-topbar__select--open');
  });
}

// ═══════════════════════════════════════════
// LEFT PANEL — Quest Database Browser
// ═══════════════════════════════════════════

function renderQuestBrowser() {
  const list = document.getElementById('ed-quest-list');
  if (!webQuestData || !webQuestData.questlines) {
    list.innerHTML = `<div class="editor-preset-tree__empty"><span>\u25C6</span><span>Loading quest database...</span></div>`;
    return;
  }

  const preset = getActivePreset();
  const term = searchTerm.toLowerCase();
  let html = '';

  for (const ql of webQuestData.questlines) {
    const filteredQuests = ql.quests.filter(q => {
      if (!term) return true;
      return q.name.toLowerCase().includes(term)
        || ql.questline.toLowerCase().includes(term)
        || (q.description || '').toLowerCase().includes(term)
        || (q.objectives || []).some(o => o.label.toLowerCase().includes(term));
    });
    if (filteredQuests.length === 0) continue;

    const addedCount = preset ? filteredQuests.filter(q => isQuestInPreset(preset, ql.questline, q.name)).length : 0;
    const allAdded = preset && addedCount === filteredQuests.length;

    html += `<div class="editor-ql${term ? ' editor-ql--expanded' : ''}" data-ql="${ql.questline}">`;
    html += `<div class="editor-ql__header" data-ql-toggle>`;
    html += `<span class="editor-ql__arrow">\u25B6</span>`;
    html += `<span class="editor-ql__name">${ql.questline}</span>`;
    html += `<span class="editor-ql__count">${filteredQuests.length}</span>`;
    if (preset && !allAdded) {
      html += `<button class="editor-ql__add-all" data-ql-add="${ql.questline}" title="Add all">`;
      html += `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 3v10M3 8h10"/></svg>`;
      html += `</button>`;
    }
    html += `</div>`;
    html += `<div class="editor-ql__body">`;

    for (const q of filteredQuests) {
      const added = preset && isQuestInPreset(preset, ql.questline, q.name);
      html += `<div class="editor-ql__quest${added ? ' editor-ql__quest--added' : ''}">`;
      html += `<span class="editor-ql__quest-name">${q.name}</span>`;
      if (added) {
        html += `<span class="editor-ql__quest-tag">added</span>`;
      } else {
        html += `<button class="editor-ql__quest-add" data-quest-add data-ql-name="${ql.questline}" data-q-name="${q.name}">`;
        html += `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 3v10M3 8h10"/></svg>`;
        html += `</button>`;
      }
      html += `</div>`;
    }

    html += `</div></div>`;
  }

  if (!html) {
    html = `<div class="editor-preset-tree__empty"><span>\u25C6</span><span>No quests found</span></div>`;
  }

  list.innerHTML = html;
  initQuestBrowserListeners();
}

function initQuestBrowserListeners() {
  // Toggle questline expand/collapse
  document.querySelectorAll('#ed-quest-list [data-ql-toggle]').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.closest('[data-ql-add]')) return;
      const ql = header.closest('.editor-ql');
      ql.classList.toggle('editor-ql--expanded');
    });
  });

  // Add single quest
  document.querySelectorAll('#ed-quest-list [data-quest-add]').forEach(btn => {
    btn.addEventListener('click', () => {
      const qlName = btn.dataset.qlName;
      const qName = btn.dataset.qName;
      addQuestToPreset(qlName, qName);
    });
  });

  // Add all quests from questline
  document.querySelectorAll('#ed-quest-list [data-ql-add]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      addQuestlineToPreset(btn.dataset.qlAdd);
    });
  });
}

function addQuestToPreset(questlineName, questName) {
  let preset = getActivePreset();
  if (!preset) return;
  if (isQuestInPreset(preset, questlineName, questName)) return;

  const cat = preset.categories[focusCatIndex] || preset.categories[preset.categories.length - 1];
  if (!cat) return;

  cat.items.push({
    id: genId(),
    type: 'quest',
    questline: questlineName,
    quest_name: questName,
    note: '',
    done: false,
  });
  saveAndRender();
}

function addQuestlineToPreset(questlineName) {
  const preset = getActivePreset();
  if (!preset) return;
  const ql = webQuestData.questlines.find(q => q.questline === questlineName);
  if (!ql) return;

  const cat = preset.categories[focusCatIndex] || preset.categories[preset.categories.length - 1];
  if (!cat) return;

  let added = 0;
  for (const q of ql.quests) {
    if (!isQuestInPreset(preset, questlineName, q.name)) {
      cat.items.push({
        id: genId(),
        type: 'quest',
        questline: questlineName,
        quest_name: q.name,
        note: '',
        done: false,
      });
      added++;
    }
  }
  if (added > 0) saveAndRender();
}

// ─── Farm browser (left panel) ───

function isFarmItemInPreset(preset, itemName) {
  if (!preset) return false;
  for (const cat of preset.categories) {
    for (const item of cat.items) {
      if (item.type === 'farm' && item.item_name === itemName) return true;
    }
  }
  return false;
}

function renderFarmBrowser() {
  const list = document.getElementById('ed-quest-list');
  if (!webFarmData || !webFarmData.items || webFarmData.items.length === 0) {
    list.innerHTML = `<div class="editor-preset-tree__empty"><span>\u25C6</span><span>Loading farm database...</span></div>`;
    return;
  }

  const preset = getActivePreset();
  const term = searchTerm.toLowerCase();
  const zoneNames = webFarmData.zone_names || {};

  // Group items by first zone or source
  const zoneMap = {};
  const sourceItems = [];
  for (const item of webFarmData.items) {
    if (term && !item.name.toLowerCase().includes(term)) continue;
    if (item.zones && item.zones.length > 0) {
      // Put in first zone's group
      const firstZone = item.zones[0];
      if (!zoneMap[firstZone]) zoneMap[firstZone] = [];
      zoneMap[firstZone].push(item);
    } else if (item.sources && item.sources.length > 0) {
      sourceItems.push(item);
    }
  }

  let html = '';

  // Zone groups
  const sortedZones = Object.keys(zoneMap).sort((a, b) => {
    const pa = a.split('-'), pb = b.split('-');
    const actA = parseInt(pa[0]) || 99, actB = parseInt(pb[0]) || 99;
    if (actA !== actB) return actA - actB;
    return (parseInt(pa[1]) || 99) - (parseInt(pb[1]) || 99);
  });

  for (const zc of sortedZones) {
    const zoneName = zoneNames[zc] || zc;
    const items = zoneMap[zc];
    const isCode = /^\d/.test(zc);
    const label = isCode ? `${zc} - ${zoneName}` : zc;

    html += `<div class="editor-ql${term ? ' editor-ql--expanded' : ''}" data-farm-zone="${zc}">`;
    html += `<div class="editor-ql__header" data-ql-toggle>`;
    html += `<span class="editor-ql__arrow">\u25B6</span>`;
    html += `<span class="editor-ql__name">${label}</span>`;
    html += `<span class="editor-ql__count">${items.length}</span>`;
    html += `</div>`;
    html += `<div class="editor-ql__body">`;

    for (const item of items) {
      const added = preset && isFarmItemInPreset(preset, item.name);
      html += `<div class="editor-ql__quest${added ? ' editor-ql__quest--added' : ''}">`;
      html += `<span class="editor-ql__quest-name">${item.name}</span>`;
      if (item.rarity) {
        html += `<span class="editor-ql__quest-tag" style="color:${item.rarity === 'Satanic' ? '#e93636' : item.rarity === 'Heroic' ? '#029999' : '#888'}">${item.rarity}</span>`;
      }
      if (added) {
        html += `<span class="editor-ql__quest-tag">added</span>`;
      } else {
        html += `<button class="editor-ql__quest-add" data-farm-add data-farm-name="${item.name}">`;
        html += `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 3v10M3 8h10"/></svg>`;
        html += `</button>`;
      }
      html += `</div>`;
    }

    html += `</div></div>`;
  }

  // Source-only items
  if (sourceItems.length > 0) {
    html += `<div class="editor-ql${term ? ' editor-ql--expanded' : ''}" data-farm-zone="sources">`;
    html += `<div class="editor-ql__header" data-ql-toggle>`;
    html += `<span class="editor-ql__arrow">\u25B6</span>`;
    html += `<span class="editor-ql__name">Bosses & Special</span>`;
    html += `<span class="editor-ql__count">${sourceItems.length}</span>`;
    html += `</div>`;
    html += `<div class="editor-ql__body">`;
    for (const item of sourceItems) {
      const added = preset && isFarmItemInPreset(preset, item.name);
      const srcName = item.sources[0]?.name || '';
      html += `<div class="editor-ql__quest${added ? ' editor-ql__quest--added' : ''}">`;
      html += `<span class="editor-ql__quest-name">${item.name}</span>`;
      if (srcName) html += `<span class="editor-ql__quest-tag">${srcName}</span>`;
      if (added) {
        html += `<span class="editor-ql__quest-tag">added</span>`;
      } else {
        html += `<button class="editor-ql__quest-add" data-farm-add data-farm-name="${item.name}">`;
        html += `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 3v10M3 8h10"/></svg>`;
        html += `</button>`;
      }
      html += `</div>`;
    }
    html += `</div></div>`;
  }

  if (!html) {
    html = `<div class="editor-preset-tree__empty"><span>\u25C6</span><span>No farm items found</span></div>`;
  }

  list.innerHTML = html;
  initFarmBrowserListeners();
}

function initFarmBrowserListeners() {
  // Toggle zone expand/collapse (reuse same data-ql-toggle pattern)
  document.querySelectorAll('#ed-quest-list [data-ql-toggle]').forEach(header => {
    header.addEventListener('click', () => {
      header.closest('.editor-ql').classList.toggle('editor-ql--expanded');
    });
  });

  // Add farm item
  document.querySelectorAll('#ed-quest-list [data-farm-add]').forEach(btn => {
    btn.addEventListener('click', () => {
      addFarmItemToPreset(btn.dataset.farmName);
    });
  });
}

function addFarmItemToPreset(itemName) {
  const preset = getActivePreset();
  if (!preset) return;
  if (isFarmItemInPreset(preset, itemName)) return;

  // Find the farm item data
  const farmItem = (webFarmData?.items || []).find(i => i.name === itemName);
  if (!farmItem) return;

  const cat = preset.categories[focusCatIndex] || preset.categories[preset.categories.length - 1];
  if (!cat) return;

  cat.items.push({
    id: genId(),
    type: 'farm',
    item_name: itemName,
    zones: farmItem.zones || [],
    source_type: farmItem.sources?.[0]?.type || 'zone',
    source_name: farmItem.sources?.[0]?.name || null,
    note: '',
    done: false,
  });
  saveAndRender();
}

// ═══════════════════════════════════════════
// RIGHT PANEL — Preset Structure Tree
// ═══════════════════════════════════════════

function renderPresetTree() {
  const tree = document.getElementById('ed-preset-tree');
  const preset = getActivePreset();

  if (!preset) {
    tree.innerHTML = `
      <div class="editor-preset-tree__empty">
        <span class="runic-header__rune">\u25C6</span>
        <span>No preset selected</span>
        <span style="font-size:0.82rem;color:var(--color-text-muted)">Create or select a preset above</span>
      </div>`;
    return;
  }

  if (preset.categories.length === 0) {
    tree.innerHTML = `
      <div class="editor-preset-tree__empty">
        <span class="runic-header__rune">\u25C6</span>
        <span>Empty preset</span>
        <span style="font-size:0.82rem;color:var(--color-text-muted)">Add a category to start</span>
      </div>`;
    return;
  }

  // Clamp focusCatIndex
  if (focusCatIndex >= preset.categories.length) focusCatIndex = preset.categories.length - 1;
  if (focusCatIndex < 0) focusCatIndex = 0;

  let html = '';
  preset.categories.forEach((cat, catIdx) => {
    const isFocus = catIdx === focusCatIndex;
    html += `<div class="editor-cat${isFocus ? ' editor-cat--target' : ''}" data-cat-idx="${catIdx}">`;
    html += `<div class="editor-cat__header">`;
    html += `<span class="editor-cat__handle" title="Drag to reorder">\u2807</span>`;
    html += `<span class="editor-cat__name" data-cat-rename="${catIdx}">${cat.name}</span>`;
    html += `<span class="editor-cat__count">${cat.items.length}</span>`;
    html += `<button class="editor-cat__delete" data-cat-delete="${catIdx}" title="Delete category">`;
    html += `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4l8 8M12 4l-8 8"/></svg>`;
    html += `</button>`;
    html += `</div>`;
    html += `<div class="editor-cat__items${cat.items.length === 0 ? ' editor-cat__items--empty' : ''}" data-cat-index="${catIdx}">`;

    if (cat.items.length === 0) {
      html += `<span>Drop quests here or add from the left panel</span>`;
    } else {
      cat.items.forEach((item, itemIdx) => {
        html += renderEditorItem(item, catIdx, itemIdx);
      });
    }

    html += `</div></div>`;
  });

  tree.innerHTML = html;
  initPresetTreeListeners();
  initSortable();
}

function renderEditorItem(item, catIdx, itemIdx) {
  let html = `<div class="editor-item" data-cat-idx="${catIdx}" data-item-idx="${itemIdx}">`;
  html += `<span class="editor-item__handle">\u2807</span>`;

  if (item.type === 'quest') {
    const webQuest = findWebQuest(item.questline, item.quest_name);
    html += `<div class="editor-item__body">`;
    html += `<div class="editor-item__header-row">`;
    html += `<span class="editor-item__icon editor-item__icon--quest">\u2694</span>`;
    html += `<div class="editor-item__title">${item.quest_name}</div>`;
    html += `<div class="editor-item__actions">`;
    html += `<button class="editor-item__btn" data-item-edit="${catIdx}-${itemIdx}" title="Edit note">`;
    html += `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z"/></svg>`;
    html += `</button>`;
    html += `<button class="editor-item__btn editor-item__btn--danger" data-item-delete="${catIdx}-${itemIdx}" title="Remove">`;
    html += `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4l8 8M12 4l-8 8"/></svg>`;
    html += `</button>`;
    html += `</div>`;
    html += `</div>`;
    html += `<div class="editor-item__subtitle">${item.questline}</div>`;

    if (webQuest) {
      if (webQuest.description) {
        let desc = cleanDescription(webQuest.description);
        if (desc.length > 150) desc = desc.substring(0, 150) + '...';
        html += `<div class="editor-item__desc">${desc}</div>`;
      }
      if (webQuest.locations && webQuest.locations.length > 0) {
        html += `<div class="editor-item__locs">`;
        for (const loc of webQuest.locations) {
          html += `<span class="editor-item__loc">\uD83D\uDCCD ${loc}</span>`;
        }
        html += `</div>`;
      }
      if (webQuest.objectives && webQuest.objectives.length > 0) {
        for (const obj of webQuest.objectives) {
          const icon = getObjectiveIcon(obj.label);
          html += `<div class="editor-item__obj">${icon} ${obj.label}</div>`;
        }
      }
    }

    if (item.note && item.note !== '<p></p>') {
      html += `<div class="editor-item__note">${item.note}</div>`;
    }

    html += `</div>`;
  } else if (item.type === 'farm') {
    html += `<div class="editor-item__body">`;
    html += `<div class="editor-item__header-row">`;
    html += `<span class="editor-item__icon editor-item__icon--farm">\uD83D\uDDFA\uFE0F</span>`;
    html += `<div class="editor-item__title">${item.item_name || 'Farm Item'}</div>`;
    html += `<div class="editor-item__actions">`;
    html += `<button class="editor-item__btn" data-item-edit="${catIdx}-${itemIdx}" title="Edit note">`;
    html += `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z"/></svg>`;
    html += `</button>`;
    html += `<button class="editor-item__btn editor-item__btn--danger" data-item-delete="${catIdx}-${itemIdx}" title="Remove">`;
    html += `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4l8 8M12 4l-8 8"/></svg>`;
    html += `</button>`;
    html += `</div>`;
    html += `</div>`;
    // Show zones
    if (item.zones && item.zones.length > 0) {
      html += `<div class="editor-item__locs">`;
      for (const zc of item.zones.slice(0, 8)) {
        html += `<span class="editor-item__loc farm-zone-badge">${zc}</span>`;
      }
      if (item.zones.length > 8) html += `<span class="editor-item__loc">+${item.zones.length - 8}</span>`;
      html += `</div>`;
    }
    if (item.source_name) {
      html += `<div class="editor-item__subtitle">${item.source_name}</div>`;
    }
    if (item.note && item.note !== '<p></p>') {
      html += `<div class="editor-item__note">${item.note}</div>`;
    }
    html += `</div>`;
  } else {
    html += `<div class="editor-item__body">`;
    html += `<div class="editor-item__header-row">`;
    html += `<span class="editor-item__icon editor-item__icon--note">\uD83D\uDCDD</span>`;
    html += `<div class="editor-item__title">${item.title || 'Note'}</div>`;
    html += `<div class="editor-item__actions">`;
    html += `<button class="editor-item__btn" data-item-edit="${catIdx}-${itemIdx}" title="Edit note">`;
    html += `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z"/></svg>`;
    html += `</button>`;
    html += `<button class="editor-item__btn editor-item__btn--danger" data-item-delete="${catIdx}-${itemIdx}" title="Remove">`;
    html += `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4l8 8M12 4l-8 8"/></svg>`;
    html += `</button>`;
    html += `</div>`;
    html += `</div>`;
    if (item.text && item.text !== '<p></p>') {
      html += `<div class="editor-item__note">${item.text}</div>`;
    } else {
      html += `<div class="editor-item__subtitle">Empty note</div>`;
    }
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

function initPresetTreeListeners() {
  // Focus category on click
  document.querySelectorAll('.editor-cat').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-cat-delete]') || e.target.closest('[data-cat-rename]')
        || e.target.closest('[data-item-edit]') || e.target.closest('[data-item-delete]')) return;
      const idx = parseInt(el.dataset.catIdx);
      if (idx !== focusCatIndex) {
        focusCatIndex = idx;
        document.querySelectorAll('.editor-cat').forEach(c => c.classList.remove('editor-cat--target'));
        el.classList.add('editor-cat--target');
      }
    });
  });

  // Rename category (inline)
  document.querySelectorAll('[data-cat-rename]').forEach(nameEl => {
    nameEl.addEventListener('click', () => {
      const catIdx = parseInt(nameEl.dataset.catRename);
      startInlineRename(nameEl, catIdx);
    });
  });

  // Delete category
  document.querySelectorAll('[data-cat-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const catIdx = parseInt(btn.dataset.catDelete);
      const preset = getActivePreset();
      if (!preset) return;
      const cat = preset.categories[catIdx];
      if (cat.items.length > 0) {
        const ok = await showConfirm(`Delete "${cat.name}" and its ${cat.items.length} item(s)?`);
        if (!ok) return;
      }
      preset.categories.splice(catIdx, 1);
      if (focusCatIndex >= preset.categories.length) focusCatIndex = Math.max(0, preset.categories.length - 1);
      saveAndRender();
    });
  });

  // Edit item (note)
  document.querySelectorAll('[data-item-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [catIdx, itemIdx] = btn.dataset.itemEdit.split('-').map(Number);
      openInlineEditor(catIdx, itemIdx);
    });
  });

  // Delete item
  document.querySelectorAll('[data-item-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const [catIdx, itemIdx] = btn.dataset.itemDelete.split('-').map(Number);
      const preset = getActivePreset();
      if (!preset) return;
      preset.categories[catIdx].items.splice(itemIdx, 1);
      saveAndRender();
    });
  });
}

// ─── Inline rename ───

function startInlineRename(nameEl, catIdx) {
  const preset = getActivePreset();
  if (!preset) return;
  const cat = preset.categories[catIdx];

  const input = document.createElement('input');
  input.className = 'editor-cat__name-input';
  input.value = cat.name;
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  const commit = () => {
    const val = input.value.trim();
    if (val && val !== cat.name) {
      cat.name = val;
      saveAndRender();
    } else {
      renderPresetTree();
    }
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { input.blur(); }
    if (e.key === 'Escape') { cat.name = cat.name; input.removeEventListener('blur', commit); renderPresetTree(); }
  });
}

// ─── Inline note editor ───

function openInlineEditor(catIdx, itemIdx) {
  cleanupEditors();
  const preset = getActivePreset();
  if (!preset) return;
  const item = preset.categories[catIdx].items[itemIdx];
  const itemEl = document.querySelector(`.editor-item[data-cat-idx="${catIdx}"][data-item-idx="${itemIdx}"]`);
  if (!itemEl) return;

  itemEl.classList.add('editor-item--editing');
  // Hide actions
  const actionsEl = itemEl.querySelector('.editor-item__actions');
  if (actionsEl) actionsEl.style.display = 'none';

  const expandDiv = document.createElement('div');
  expandDiv.className = 'editor-note-expand';

  // Title input for notes
  if (item.type === 'note') {
    const titleInput = document.createElement('input');
    titleInput.className = 'add-popup__input';
    titleInput.style.marginBottom = '6px';
    titleInput.value = item.title || '';
    titleInput.placeholder = 'Note title (optional)';
    expandDiv.appendChild(titleInput);
    expandDiv._titleInput = titleInput;
  }

  const editorContainer = document.createElement('div');
  expandDiv.appendChild(editorContainer);
  const noteContent = item.type === 'note' ? (item.text || '') : (item.note || '');
  const ed = createNoteEditor(editorContainer, noteContent, 'Write a note...');

  const actions = document.createElement('div');
  actions.className = 'editor-note-actions';
  actions.innerHTML = `
    <button class="runic-btn runic-btn--sm" id="ed-note-cancel">Cancel</button>
    <button class="runic-btn runic-btn--sm runic-btn--primary" id="ed-note-save">Save</button>
  `;
  expandDiv.appendChild(actions);

  itemEl.querySelector('.editor-item__body').appendChild(expandDiv);

  actions.querySelector('#ed-note-cancel').addEventListener('click', () => {
    cleanupEditors();
    renderPresetTree();
  });

  actions.querySelector('#ed-note-save').addEventListener('click', () => {
    if (item.type === 'note') {
      item.title = expandDiv._titleInput ? expandDiv._titleInput.value.trim() : item.title;
      item.text = ed.getHTML();
    } else {
      item.note = ed.getHTML();
    }
    cleanupEditors();
    saveAndRender();
  });
}

// ═══════════════════════════════════════════
// SORTABLEJS — Drag & Drop
// ═══════════════════════════════════════════

function destroySortables() {
  sortableInstances.forEach(s => { try { s.destroy(); } catch (e) {} });
  sortableInstances = [];
}

function initSortable() {
  destroySortables();
  if (!window.Sortable) {
    console.warn('initSortable: Sortable not available');
    document.getElementById('editor-app').classList.add('editor-no-sortable');
    return;
  }
  console.log('initSortable: initializing drag & drop');

  const tree = document.getElementById('ed-preset-tree');

  // Category reordering
  const catSortable = new Sortable(tree, {
    handle: '.editor-cat__handle',
    draggable: '.editor-cat',
    animation: 150,
    ghostClass: 'editor-cat--ghost',
    onEnd: (evt) => {
      const preset = getActivePreset();
      if (!preset) return;
      const [moved] = preset.categories.splice(evt.oldIndex, 1);
      preset.categories.splice(evt.newIndex, 0, moved);
      focusCatIndex = evt.newIndex;
      saveAndRender();
    }
  });
  sortableInstances.push(catSortable);

  // Item reordering (within + between categories, including empty containers as drop targets)
  document.querySelectorAll('.editor-cat__items').forEach(el => {
    const itemSortable = new Sortable(el, {
      group: 'preset-items',
      handle: '.editor-item__handle',
      draggable: '.editor-item',
      animation: 150,
      ghostClass: 'editor-item--ghost',
      onEnd: (evt) => {
        const preset = getActivePreset();
        if (!preset) return;
        const fromCat = parseInt(evt.from.dataset.catIndex);
        const toCat = parseInt(evt.to.dataset.catIndex);
        const [moved] = preset.categories[fromCat].items.splice(evt.oldIndex, 1);
        preset.categories[toCat].items.splice(evt.newIndex, 0, moved);
        saveAndRender();
      }
    });
    sortableInstances.push(itemSortable);
  });
}

// ═══════════════════════════════════════════
// BOTTOM BAR — Preset actions
// ═══════════════════════════════════════════

function initBottomBar() {
  document.getElementById('ed-duplicate').addEventListener('click', () => {
    const preset = getActivePreset();
    if (!preset) return;
    const dup = JSON.parse(JSON.stringify(preset));
    dup.id = genId();
    dup.name = preset.name + ' (copy)';
    dup.created_at = new Date().toISOString().slice(0, 10);
    // Remap all IDs
    for (const cat of dup.categories) {
      cat.id = genId();
      for (const item of cat.items) { item.id = genId(); }
    }
    presetsData.presets.push(dup);
    presetsData.active_preset_id = dup.id;
    saveAndRender();
  });

  document.getElementById('ed-export').addEventListener('click', async () => {
    const preset = getActivePreset();
    if (!preset) return;
    try { await window.pywebview.api.export_preset(preset.id); } catch (e) {}
  });

  document.getElementById('ed-import').addEventListener('click', async () => {
    try {
      const data = await window.pywebview.api.import_preset();
      if (!data) return;
      const newPreset = {
        id: genId(),
        name: data.name || 'Imported',
        created_at: new Date().toISOString().slice(0, 10),
        categories: (data.categories || []).map(cat => ({
          id: genId(),
          name: cat.name || 'Category',
          collapsed: false,
          items: (cat.items || []).map(item => ({ ...item, id: genId(), done: item.done || false })),
        })),
      };
      presetsData.presets.push(newPreset);
      presetsData.active_preset_id = newPreset.id;
      saveAndRender();
    } catch (e) {}
  });

  document.getElementById('ed-delete').addEventListener('click', async () => {
    const preset = getActivePreset();
    if (!preset) return;
    const ok = await showConfirm(`Delete preset "${preset.name}"? This cannot be undone.`);
    if (!ok) return;
    presetsData.presets = presetsData.presets.filter(p => p.id !== preset.id);
    if (presetsData.presets.length > 0) {
      presetsData.active_preset_id = presetsData.presets[0].id;
    } else {
      presetsData.active_preset_id = null;
    }
    focusCatIndex = 0;
    saveAndRender();
  });
}

// ═══════════════════════════════════════════
// OTHER ACTIONS
// ═══════════════════════════════════════════

function initAddCategory() {
  document.getElementById('ed-add-category').addEventListener('click', async () => {
    const preset = getActivePreset();
    if (!preset) return;
    const name = await showPrompt('New Category', '');
    if (!name) return;
    preset.categories.push({ id: genId(), name, collapsed: false, items: [] });
    focusCatIndex = preset.categories.length - 1;
    saveAndRender();
  });
}

function initAddFreeNote() {
  document.getElementById('ed-add-free-note').addEventListener('click', () => {
    const preset = getActivePreset();
    if (!preset) return;
    if (preset.categories.length === 0) {
      preset.categories.push({ id: genId(), name: 'General', collapsed: false, items: [] });
      focusCatIndex = 0;
    }
    const cat = preset.categories[focusCatIndex] || preset.categories[preset.categories.length - 1];
    cat.items.push({ id: genId(), type: 'note', title: '', text: '', done: false });
    saveAndRender();
    // Open the note editor for the newly added item
    const itemIdx = cat.items.length - 1;
    const catIdx = preset.categories.indexOf(cat);
    setTimeout(() => openInlineEditor(catIdx, itemIdx), 50);
  });
}

// ═══════════════════════════════════════════
// TITLEBAR — Drag, minimize, close
// ═══════════════════════════════════════════

function initTitlebar() {
  const dragArea = document.getElementById('editor-titlebar');
  let isDragging = false;
  let startX, startY;

  dragArea.addEventListener('mousedown', (e) => {
    if (e.target.closest('.titlebar__controls')) return;
    isDragging = true;
    startX = e.screenX;
    startY = e.screenY;
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.screenX - startX;
    const dy = e.screenY - startY;
    startX = e.screenX;
    startY = e.screenY;
    window.pywebview.api.move_editor(dx, dy);
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      // Save position after drag ends
      try { window.pywebview.api.save_editor_pos(); } catch (e) {}
    }
  });

  document.getElementById('ed-btn-minimize').addEventListener('click', () => {
    window.pywebview.api.minimize_editor();
  });

  document.getElementById('ed-btn-close').addEventListener('click', () => {
    window.pywebview.api.close_editor();
  });
}

// ═══════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════

function initSearch() {
  const input = document.getElementById('ed-search');
  let debounce;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      searchTerm = input.value.trim();
      if (activeBrowser === 'farm') {
        renderFarmBrowser();
      } else {
        renderQuestBrowser();
      }
    }, 200);
  });
}

// ═══════════════════════════════════════════
// RESIZE HANDLE (left panel)
// ═══════════════════════════════════════════

function initResizeHandle() {
  const handle = document.getElementById('ed-resize-handle');
  const left = document.querySelector('.editor-panel--left');
  let isResizing = false;
  let startX, startW;

  handle.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startW = left.offsetWidth;
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const dx = e.clientX - startX;
    const newW = Math.max(200, Math.min(600, startW + dx));
    left.style.width = newW + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = '';
    }
  });
}

// ═══════════════════════════════════════════
// KEYBOARD SHORTCUTS (copy-paste for pywebview)
// ═══════════════════════════════════════════

function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'c') { document.execCommand('copy'); }
      else if (e.key === 'v') { document.execCommand('paste'); }
      else if (e.key === 'x') { document.execCommand('cut'); }
      else if (e.key === 'a') { document.execCommand('selectAll'); }
      else if (e.key === 'z') { document.execCommand('undo'); }
      else if (e.key === 'y') { document.execCommand('redo'); }
    }
  });
}

// ─── Browser tab switching ───

function initBrowserTabs() {
  const tabs = document.querySelectorAll('.editor-panel__tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', async () => {
      tabs.forEach(t => t.classList.remove('editor-panel__tab--active'));
      tab.classList.add('editor-panel__tab--active');
      activeBrowser = tab.dataset.browser;

      const searchInput = document.getElementById('ed-search');
      if (activeBrowser === 'farm') {
        searchInput.placeholder = 'Search farm items...';
        // Lazy-load farm data
        if (!webFarmData) {
          try {
            webFarmData = await window.pywebview.api.get_farm_data('');
          } catch (e) {}
        }
        renderFarmBrowser();
      } else {
        searchInput.placeholder = 'Search quests...';
        renderQuestBrowser();
      }
    });
  });
}

// ═══════════════════════════════════════════
// INIT — pywebviewready
// ═══════════════════════════════════════════

window.addEventListener('pywebviewready', async () => {
  try {
    presetsData = await window.pywebview.api.get_presets_data();
    webQuestData = await window.pywebview.api.get_all_web_quests();
    const settings = await window.pywebview.api.get_settings();
    if (settings && settings.font_theme) applyFontTheme(settings.font_theme);
  } catch (e) {
    console.warn('Init error:', e);
  }

  initTitlebar();
  initSearch();
  initResizeHandle();
  initBottomBar();
  initAddCategory();
  initAddFreeNote();
  initKeyboard();
  initBrowserTabs();

  renderAll();

  // Re-init SortableJS if it loads after initial render
  window.addEventListener('sortable-loaded', () => {
    initSortable();
  });
});

// Called by Python via evaluate_js when companion changes something
async function reloadPresets() {
  try {
    presetsData = await window.pywebview.api.get_presets_data();
    renderAll();
  } catch (e) {}
}
window.reloadPresets = reloadPresets;
