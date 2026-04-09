const RUNE = '\u25C6';
let currentCategory = 'quests';
let currentTab = 'pinned';
let lastDataStr = '';
let searchTerm = '';
let isPillMode = false;
let isCollapsed = false;

// Item filter state
let itemFilterOptions = null;
let itemFilters = { types: [], rarities: [], elements: [], stats: [], maxLevel: 0, sort: 'level', sortDir: 'desc' };

// Preset state
let presetsData = { active_preset_id: null, presets: [] };
let webQuestData = null; // cached from API

const ELEMENT_COLORS = {
  'fire': '#ff4444', 'cold': '#44ddff', 'lightning': '#ffdd00',
  'poison': '#00bc00', 'arcane': '#e556ff', 'physical': '#ffa500',
  'magic': '#88aaff', 'elemental': '#c9a227',
};

const RARITY_COLORS = {
  'Common': '#c2c4bc', 'Heroic': '#029999', 'Satanic': '#e93636',
  'Satanic Set': '#25a111', 'Angelic': '#e0d780', 'Unholy': '#ff4482',
  'Runeword': '#ffffff', 'Legendary': '#edb828', 'Mythic': '#b310a8',
  'Relic': '#c9a227', 'Rare': '#edea28', 'None': '#7f7f7f',
};

const ELEMENT_KEYWORDS = {
  fire: ['fire', 'burning', 'ruby'],
  cold: ['cold', 'freeze', 'frozen', 'sapphire'],
  lightning: ['lightning', 'topaz'],
  poison: ['poison', 'toxic', 'acid'],
  arcane: ['arcane', 'amethyst', 'magic_skill'],
  physical: ['physical', 'bleed', 'skull', 'attack_rating', 'weapon_damage', 'defense', 'armor'],
};

// ─── Category select ───

function initCategorySelect() {
  const select = document.getElementById('category-select');
  const trigger = document.getElementById('category-trigger');
  const dropdown = document.getElementById('category-dropdown');
  const valueEl = document.getElementById('category-value');
  const options = dropdown.querySelectorAll('.runic-select__option:not(:disabled)');

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.style.display !== 'none';
    dropdown.style.display = isOpen ? 'none' : 'block';
    select.classList.toggle('runic-select--open', !isOpen);
  });

  document.addEventListener('click', () => {
    dropdown.style.display = 'none';
    select.classList.remove('runic-select--open');
  });

  options.forEach(opt => {
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      const cat = opt.dataset.category;
      if (cat === currentCategory) {
        dropdown.style.display = 'none';
        select.classList.remove('runic-select--open');
        return;
      }
      currentCategory = cat;
      valueEl.textContent = opt.textContent.trim();

      dropdown.querySelectorAll('.runic-select__option').forEach(o =>
        o.classList.remove('runic-select__option--active'));
      opt.classList.add('runic-select__option--active');

      dropdown.style.display = 'none';
      select.classList.remove('runic-select--open');

      updateHeaderTitle();
      lastDataStr = '';
      refreshQuests();
    });
  });
}

function updateHeaderTitle() {
  const titles = { quests: 'QUESTS', items: 'ITEMS', runewords: 'RUNEWORDS', runes: 'RUNES', stats: 'STATS' };
  document.getElementById('header-title').textContent = titles[currentCategory] || 'QUESTS';

  const tabSwitcher = document.getElementById('tab-switcher');
  tabSwitcher.style.display = currentCategory === 'quests' ? '' : 'none';

  if (currentCategory !== 'items') {
    const overlay = document.getElementById('filter-overlay');
    const panel = document.getElementById('filter-panel');
    if (overlay) overlay.classList.remove('filter-overlay--open');
    if (panel) panel.classList.remove('filter-panel--open');
  }
}

// ─── Tab switching ───

function initTabs() {
  const buttons = document.querySelectorAll('.runic-radio__option');
  const slider = document.getElementById('tab-slider');

  buttons.forEach((btn, index) => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => {
        b.classList.remove('runic-radio__option--active');
        b.setAttribute('aria-checked', 'false');
      });
      btn.classList.add('runic-radio__option--active');
      btn.setAttribute('aria-checked', 'true');

      slider.style.transform = `translateX(${index * 100}%)`;
      currentTab = btn.dataset.tab;
      lastDataStr = '';
      refreshQuests();
    });
  });
}

// ─── Search ───

function initSearch() {
  const input = document.getElementById('search-input');
  input.addEventListener('input', (e) => {
    searchTerm = e.target.value.toLowerCase();
    lastDataStr = '';
    refreshQuests();
  });
}

// ─── Rendering helpers ───

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

function createLocationBadges(locations) {
  if (!locations || locations.length === 0) return '';
  let html = '<div class="quest-locations">';
  for (const loc of locations) {
    html += `<span class="quest-location"><span class="quest-location__icon">\uD83D\uDCCD</span>${loc}</span>`;
  }
  html += '</div>';
  return html;
}

// ─── Preset helpers ───

function genId() { return crypto.randomUUID(); }

function getActivePreset() {
  if (!presetsData.active_preset_id) return null;
  return presetsData.presets.find(p => p.id === presetsData.active_preset_id) || null;
}

async function savePresets() {
  try { await window.pywebview.api.save_presets_data(presetsData); } catch (e) {}
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

function countDone(cat) {
  return cat.items.filter(i => i.done).length;
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

function showConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('add-popup-overlay');
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

// ─── All tab — quest cards with "+" button ───

function createAllQuestCard(quest, questlineName) {
  const card = document.createElement('div');
  card.className = 'quest-step quest-step--current';

  let html = `<div class="quest-step__header">`;
  html += `<div class="quest-step__name">${quest.name}</div>`;
  html += `</div>`;

  if (quest.description) {
    let desc = cleanDescription(quest.description);
    if (desc.length > 200) desc = desc.substring(0, 200) + '...';
    html += `<div class="quest-step__desc">${desc}</div>`;
  }

  html += createLocationBadges(quest.locations);

  for (const obj of quest.objectives) {
    const icon = getObjectiveIcon(obj.label);
    html += `<div class="quest-objective"><span class="quest-objective__icon">${icon}</span><span class="quest-objective__text">${obj.label}</span></div>`;
  }

  card.innerHTML = html;
  return card;
}


// ─── Guide tab rendering ───

// closeAddPopup stub — used by closeAllPanels
function closeAddPopup() {
  const overlay = document.getElementById('add-popup-overlay');
  if (overlay) { overlay.style.display = 'none'; overlay.innerHTML = ''; }
}

// (editing functions removed — all editing is now in the Editor window)

// ─── Guide tab rendering ───

function renderGuide(list, status) {
  const preset = getActivePreset();

  if (!preset) {
    list.innerHTML = `
      <div class="guide-empty">
        <div class="guide-empty__icon">${RUNE}</div>
        <div class="guide-empty__title">No preset yet</div>
        <div class="guide-empty__text">Open the editor to create a preset and organize your quests.</div>
        <button class="runic-btn runic-btn--primary" id="guide-open-editor-btn">${RUNE} Open Editor</button>
      </div>`;
    status.textContent = 'no preset';

    list.querySelector('#guide-open-editor-btn').addEventListener('click', () => {
      try { window.pywebview.api.open_editor(); } catch (e) {}
    });
    return;
  }

  // Preset selector (runic-select) + edit button (runic-btn)
  let html = `<div class="guide-preset-bar">`;
  html += `<div class="runic-select runic-select--guide" id="guide-preset-select">`;
  html += `<div class="runic-select__trigger" id="guide-selector-trigger">`;
  html += `<span class="runic-select__rune runic-select__rune--tl">\u25C6</span>`;
  html += `<span class="runic-select__rune runic-select__rune--tr">\u25C6</span>`;
  html += `<span class="runic-select__rune runic-select__rune--bl">\u25C6</span>`;
  html += `<span class="runic-select__rune runic-select__rune--br">\u25C6</span>`;
  html += `<span class="runic-select__value">${preset.name}</span>`;
  html += `<svg class="runic-select__chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6l4 4 4-4"/></svg>`;
  html += `<div class="runic-select__glow"></div>`;
  html += `</div>`;
  html += `<div class="runic-select__dropdown" id="guide-selector-dropdown" style="display:none;">`;
  for (const p of presetsData.presets) {
    html += `<button class="runic-select__option${p.id === preset.id ? ' runic-select__option--active' : ''}" data-preset-id="${p.id}">${p.name}</button>`;
  }
  html += `</div></div>`;
  html += `<button class="runic-btn runic-btn--sm" id="guide-edit-btn" data-tip="Edit preset" data-tip-pos="left">`;
  html += `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" style="width:12px;height:12px;margin-right:4px"><path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z"/></svg>Edit`;
  html += `</button>`;
  html += `</div>`;

  // Categories (read-only — no editing buttons)
  let totalItems = 0;
  let totalDone = 0;

  for (let ci = 0; ci < preset.categories.length; ci++) {
    const cat = preset.categories[ci];
    const done = countDone(cat);
    const total = cat.items.length;
    totalItems += total;
    totalDone += done;

    const filtered = cat.items.filter(item => {
      if (!searchTerm) return true;
      if (item.type === 'quest') return item.quest_name.toLowerCase().includes(searchTerm) || (item.note && item.note.toLowerCase().includes(searchTerm));
      return item.text && item.text.toLowerCase().includes(searchTerm);
    });

    if (searchTerm && filtered.length === 0) continue;

    const collapsed = cat.collapsed && !searchTerm;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    html += `<div class="guide-cat${collapsed ? '' : ' guide-cat--expanded'}" data-cat-index="${ci}">`;
    html += `<div class="guide-cat__header" data-cat-toggle="${ci}">`;
    html += `<span class="guide-cat__rune guide-cat__rune--tl">\u25C6</span>`;
    html += `<span class="guide-cat__rune guide-cat__rune--tr">\u25C6</span>`;
    html += `<span class="guide-cat__arrow">${collapsed ? '\u25B6' : '\u25BC'}</span>`;
    html += `<span class="guide-cat__name">${cat.name}</span>`;
    html += `<span class="guide-cat__count">${done}/${total}</span>`;
    html += `<div class="guide-cat__glow"></div>`;
    html += `</div>`;
    html += `<div class="guide-cat__progress"><div class="guide-cat__progress-bar" style="width:${pct}%"></div></div>`;

    if (!collapsed) {
      html += `<div class="guide-cat__items">`;
      const itemsToRender = searchTerm ? filtered : cat.items;
      for (let ii = 0; ii < itemsToRender.length; ii++) {
        const item = itemsToRender[ii];
        const realIndex = searchTerm ? cat.items.indexOf(item) : ii;
        html += renderGuideItem(item, ci, realIndex);
      }
      html += `</div>`;
    }
    html += `</div>`;
  }

  status.textContent = `${totalDone}/${totalItems} completed`;
  list.innerHTML = html;

  initGuideListeners(list);
}

function renderGuideItem(item, catIndex, itemIndex) {
  const isQuest = item.type === 'quest';
  const isCollapsed = item.done || item.hidden;

  let html = `<div class="guide-item${item.done ? ' guide-item--done' : ''}${isCollapsed ? ' guide-item--collapsed' : ''}" data-cat="${catIndex}" data-item="${itemIndex}">`;

  if (isQuest) {
    const webQuest = findWebQuest(item.questline, item.quest_name);

    // Header row: questline + name + checkbox
    html += `<div class="guide-item__header">`;
    html += `<div class="guide-item__header-text">`;
    html += `<div class="quest-step__questline">${item.questline}</div>`;
    html += `<div class="quest-step__name">${item.quest_name}</div>`;
    html += `</div>`;
    html += `<label class="guide-item__check"><input type="checkbox" ${item.done ? 'checked' : ''} data-toggle-done="${catIndex},${itemIndex}"><span class="guide-item__checkbox"></span></label>`;
    html += `</div>`;

    // Body (hidden when done)
    if (!item.done) {
      html += `<div class="guide-item__body">`;
      if (webQuest) {
        if (webQuest.description) {
          let desc = cleanDescription(webQuest.description);
          if (desc.length > 200) desc = desc.substring(0, 200) + '...';
          html += `<div class="quest-step__desc">${desc}</div>`;
        }
        html += createLocationBadges(webQuest.locations);
        for (const obj of webQuest.objectives) {
          const icon = getObjectiveIcon(obj.label);
          html += `<div class="quest-objective"><span class="quest-objective__icon">${icon}</span><span class="quest-objective__text">${obj.label}</span></div>`;
        }
      }
      if (item.note && item.note !== '<p></p>') {
        html += `<div class="guide-item__note-rich">${item.note}</div>`;
      }
      html += `</div>`;
    }
  } else {
    // Note card — header with title + eye toggle
    const hasContent = item.text && item.text !== '<p></p>';
    const eyeOpen = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>`;
    const eyeClosed = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><line x1="2" y1="2" x2="14" y2="14"/></svg>`;

    html += `<div class="guide-item__header">`;
    html += `<div class="guide-item__header-text">`;
    html += `<div class="quest-step__name">${item.title || 'Note'}</div>`;
    html += `</div>`;
    if (hasContent) {
      html += `<button class="guide-item__eye" data-toggle-hidden="${catIndex},${itemIndex}">${item.hidden ? eyeClosed : eyeOpen}</button>`;
    }
    html += `</div>`;

    if (!item.hidden && hasContent) {
      html += `<div class="guide-item__body">`;
      html += `<div class="guide-item__note-rich">${item.text}</div>`;
      html += `</div>`;
    }
  }

  html += `</div>`;
  return html;
}

function initGuideListeners(list) {
  const preset = getActivePreset();
  if (!preset) return;

  // Preset selector (runic-select)
  const selectWrap = list.querySelector('#guide-preset-select');
  const trigger = list.querySelector('#guide-selector-trigger');
  const dropdown = list.querySelector('#guide-selector-dropdown');
  if (trigger && dropdown) {
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = dropdown.style.display !== 'none';
      dropdown.style.display = isOpen ? 'none' : '';
      if (selectWrap) selectWrap.classList.toggle('runic-select--open', !isOpen);
    });
    dropdown.querySelectorAll('[data-preset-id]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        presetsData.active_preset_id = btn.dataset.presetId;
        await savePresets();
        dropdown.style.display = 'none';
        if (selectWrap) selectWrap.classList.remove('runic-select--open');
        lastDataStr = '';
        refreshQuests();
      });
    });
    document.addEventListener('click', () => {
      if (dropdown) dropdown.style.display = 'none';
      if (selectWrap) selectWrap.classList.remove('runic-select--open');
    }, { once: true });
  }

  // Edit button — opens editor window
  const editBtn = list.querySelector('#guide-edit-btn');
  if (editBtn) {
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      try { window.pywebview.api.open_editor(); } catch (e) {}
    });
  }

  // Category toggle (collapse/expand)
  list.querySelectorAll('[data-cat-toggle]').forEach(el => {
    el.addEventListener('click', async (e) => {
      const ci = parseInt(el.dataset.catToggle);
      preset.categories[ci].collapsed = !preset.categories[ci].collapsed;
      await savePresets();
      lastDataStr = '';
      refreshQuests();
    });
  });

  // Toggle done (quests)
  list.querySelectorAll('[data-toggle-done]').forEach(input => {
    input.addEventListener('change', async () => {
      const [ci, ii] = input.dataset.toggleDone.split(',').map(Number);
      preset.categories[ci].items[ii].done = input.checked;
      await savePresets();
      lastDataStr = '';
      refreshQuests();
    });
  });

  // Toggle hidden (notes)
  list.querySelectorAll('[data-toggle-hidden]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const [ci, ii] = btn.dataset.toggleHidden.split(',').map(Number);
      preset.categories[ci].items[ii].hidden = !preset.categories[ci].items[ii].hidden;
      await savePresets();
      lastDataStr = '';
      refreshQuests();
    });
  });
}

// (Category menu, Item menu, Small popups, Preset manager — all removed, now in Editor window)

// ─── Runeword / Rune rendering ───

function createRunewordCard(rw) {
  const card = document.createElement('div');
  card.className = 'runeword-card';

  let tagsHtml = '';
  if (rw.hand) tagsHtml += `<span class="runeword-card__tag runeword-card__tag--hand">${rw.hand}</span>`;
  for (const t of rw.types) {
    tagsHtml += `<span class="runeword-card__tag">${t}</span>`;
  }

  let runesHtml = rw.runes.map(r => `
    <div class="runeword-rune">
      <span class="runeword-rune__name">${r.name}</span>
      <span class="runeword-rune__rank">#${r.rank}</span>
      <span class="runeword-rune__effect">${r.effect}</span>
    </div>
  `).join('');

  card.innerHTML = `
    <div class="item-card__corner item-card__corner--tl"></div>
    <div class="item-card__corner item-card__corner--tr"></div>
    <div class="item-card__corner item-card__corner--bl"></div>
    <div class="item-card__corner item-card__corner--br"></div>
    <div class="runeword-card__title">
      <span class="runeword-card__name">${rw.name}</span>
      <span class="runeword-card__level">Lv.${rw.level}</span>
    </div>
    <div class="runeword-card__meta">${tagsHtml}</div>
    <div class="runeword-card__runes">${runesHtml}</div>
  `;
  return card;
}

function renderRunewords(list, status) {
  return async function () {
    const apiData = await window.pywebview.api.get_runewords();
    const dataStr = JSON.stringify(apiData) + searchTerm;
    if (dataStr === lastDataStr) return;
    lastDataStr = dataStr;

    list.innerHTML = '';
    const rws = (apiData.runewords || []).filter(rw => {
      if (!searchTerm) return true;
      return rw.name.toLowerCase().includes(searchTerm) ||
             rw.types.some(t => t.toLowerCase().includes(searchTerm)) ||
             rw.runes.some(r => r.name.toLowerCase().includes(searchTerm) || r.effect.toLowerCase().includes(searchTerm));
    });

    status.textContent = `${rws.length} runewords`;

    if (rws.length === 0) {
      list.innerHTML = `<div class="quest-list__empty"><span class="runic-header__rune">${RUNE}</span><span>${searchTerm ? 'No matching runewords' : 'Loading...'}</span><span class="runic-header__rune">${RUNE}</span></div>`;
      return;
    }

    for (const rw of rws) {
      list.appendChild(createRunewordCard(rw));
    }
  };
}

function renderRunes(list, status) {
  return async function () {
    const apiData = await window.pywebview.api.get_runes();
    const dataStr = JSON.stringify(apiData) + searchTerm;
    if (dataStr === lastDataStr) return;
    lastDataStr = dataStr;

    list.innerHTML = '';
    const tiers = apiData.tiers || [];
    let total = 0;

    if (tiers.length === 0) {
      list.innerHTML = `<div class="quest-list__empty"><span class="runic-header__rune">${RUNE}</span><span>Loading...</span><span class="runic-header__rune">${RUNE}</span></div>`;
      status.textContent = 'loading...';
      return;
    }

    for (const tier of tiers) {
      const tierClass = tier.tier.toLowerCase();
      const section = document.createElement('div');
      section.className = `rune-tier rune-tier--${tierClass}`;

      const filtered = tier.runes.filter(r => {
        if (!searchTerm) return true;
        return r.name.toLowerCase().includes(searchTerm) ||
               r.stat.toLowerCase().includes(searchTerm);
      });

      if (filtered.length === 0) continue;
      total += filtered.length;

      let html = `<div class="rune-tier__title">${tier.tier}</div>`;
      html += `<div class="rune-tier__grid">`;
      for (const r of filtered) {
        html += `
          <div class="rune-card">
            <div class="rune-card__header">
              <span class="rune-card__name">${r.name}</span>
              <span class="rune-card__rank">#${r.rank}</span>
              <span class="rune-card__level">Lv.${r.level}</span>
            </div>
            <div class="rune-card__stat">${r.stat}</div>
          </div>`;
      }
      html += `</div>`;
      section.innerHTML = html;
      list.appendChild(section);
    }

    status.textContent = `${total} runes`;
  };
}

// ─── Items rendering ───

function getStatElement(statId) {
  for (const [el, keywords] of Object.entries(ELEMENT_KEYWORDS)) {
    if (keywords.some(kw => statId.includes(kw))) return el;
  }
  return '';
}

function formatStatValue(stat, statDefs) {
  const def = statDefs.find(d => d['Stat ID'] === stat.id);
  let text = def ? def['Stat Display'] : stat.id;
  if (stat.min != null && stat.max != null && stat.min !== stat.max) {
    text = text.replace('value1', `${stat.min}-${stat.max}`);
  } else if (stat.min != null) {
    text = text.replace('value1', String(stat.min));
  }
  text = text.replace(/value\d\w?/g, '?');
  if (stat.spell) text = text.replace(/\$\{.*?\}/, stat.spell);
  text = text.replace(/([+-]?\d+(?:[.-]\d+)*%?)/g, '<span class="item-stat__value">$1</span>');
  return text;
}

function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  const n = parseInt(hex, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function createItemCard(item, statDefs) {
  const card = document.createElement('div');
  card.className = 'item-card';
  const rarityColor = RARITY_COLORS[item.rarity] || RARITY_COLORS['None'];
  const rarityRgb = hexToRgb(rarityColor);
  card.style.setProperty('--item-rarity-color', rarityColor);
  card.style.setProperty('--rarity-rgb', rarityRgb);
  card.style.setProperty('--corner-rgb', rarityRgb);

  let levelHtml = item.level ? `<span class="item-card__level">Lv.${item.level}</span>` : '';

  let tagsHtml = `<span class="item-card__tag item-card__tag--type">${item.type}</span>`;
  if (item.rarity) {
    tagsHtml += `<span class="item-card__tag item-card__tag--rarity" style="--rarity-rgb:${rarityRgb}">${item.rarity}</span>`;
  }
  if (item.tier) {
    tagsHtml += `<span class="item-card__tag item-card__tag--tier">${item.tier}</span>`;
  }

  let statsHtml = '';
  for (const stat of (item.stats || [])) {
    const el = getStatElement(stat.id);
    const elClass = el ? ` item-stat--${el}` : '';
    const text = formatStatValue(stat, statDefs);
    statsHtml += `<div class="item-stat${elClass}">${text}</div>`;
  }

  card.innerHTML = `
    <div class="item-card__corner item-card__corner--tl"></div>
    <div class="item-card__corner item-card__corner--tr"></div>
    <div class="item-card__corner item-card__corner--bl"></div>
    <div class="item-card__corner item-card__corner--br"></div>
    <div class="item-card__title">
      <span class="item-card__name">${item.name}</span>
      ${levelHtml}
    </div>
    <div class="item-card__meta">${tagsHtml}</div>
    <div class="item-card__stats">${statsHtml}</div>
  `;
  return card;
}

// ─── Multi-select component ───

function createRunicMultiSelect(options, selected, { placeholder, colorFn } = {}) {
  const root = document.createElement('div');
  root.className = 'rms';

  const checkSvg = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 6l3 3 5-5"/></svg>';
  const chevronSvg = '<svg class="rms__chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6l4 4 4-4"/></svg>';
  const searchSvg = '<svg class="rms__search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>';

  const trigger = document.createElement('div');
  trigger.className = 'rms__trigger';
  trigger.innerHTML = `
    <span class="rms__rune rms__rune--tl">\u25C6</span>
    <span class="rms__rune rms__rune--tr">\u25C6</span>
    <span class="rms__rune rms__rune--bl">\u25C6</span>
    <span class="rms__rune rms__rune--br">\u25C6</span>
    <span class="rms__value rms__value--placeholder">${placeholder || 'Select...'}</span>
    <span class="rms__badge"></span>
    <button class="rms__clear" style="display:none">&times;</button>
    ${chevronSvg}
    <div class="rms__glow"></div>
  `;

  const dropdown = document.createElement('div');
  dropdown.className = 'rms__dropdown';

  const search = document.createElement('div');
  search.className = 'rms__search';
  search.innerHTML = `${searchSvg}<input class="rms__search-input" placeholder="Search..." type="text">`;

  const optionsList = document.createElement('div');
  optionsList.className = 'rms__options';

  dropdown.appendChild(search);
  dropdown.appendChild(optionsList);
  root.appendChild(trigger);
  root.appendChild(dropdown);

  let searchVal = '';
  const selectedSet = new Set(selected);

  function renderOptions() {
    optionsList.innerHTML = '';
    const filtered = options.filter(o => !searchVal || o.toLowerCase().includes(searchVal));
    for (const opt of filtered) {
      const el = document.createElement('div');
      const isSel = selectedSet.has(opt);
      el.className = 'rms__option' + (isSel ? ' rms__option--selected' : '');
      const labelColor = colorFn ? ` style="color:${colorFn(opt)}"` : '';
      el.innerHTML = `<span class="rms__checkbox">${checkSvg}</span><span class="rms__option-label"${labelColor}>${opt}</span>`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (selectedSet.has(opt)) selectedSet.delete(opt); else selectedSet.add(opt);
        updateTrigger();
        renderOptions();
        if (root.onchange) root.onchange([...selectedSet]);
      });
      optionsList.appendChild(el);
    }
  }

  function updateTrigger() {
    const val = trigger.querySelector('.rms__value');
    const badge = trigger.querySelector('.rms__badge');
    const clear = trigger.querySelector('.rms__clear');
    const n = selectedSet.size;
    if (n === 0) {
      val.textContent = placeholder || 'Select...';
      val.className = 'rms__value rms__value--placeholder';
      badge.textContent = '';
      clear.style.display = 'none';
      root.classList.remove('rms--has-selection');
    } else {
      val.textContent = `${n} selected`;
      val.className = 'rms__value';
      badge.textContent = n;
      clear.style.display = '';
      root.classList.add('rms--has-selection');
    }
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = root.classList.toggle('rms--open');
    if (isOpen) {
      renderOptions();
      search.querySelector('input').value = '';
      searchVal = '';
      search.querySelector('input').focus();
    }
  });

  trigger.querySelector('.rms__clear').addEventListener('click', (e) => {
    e.stopPropagation();
    selectedSet.clear();
    updateTrigger();
    renderOptions();
    if (root.onchange) root.onchange([]);
  });

  search.querySelector('input').addEventListener('input', (e) => {
    searchVal = e.target.value.toLowerCase();
    renderOptions();
  });
  search.querySelector('input').addEventListener('click', (e) => e.stopPropagation());

  document.addEventListener('click', () => { root.classList.remove('rms--open'); });

  updateTrigger();
  return root;
}

// ─── Filter popup ───

let filterPopupBuilt = false;

function buildFilterPopup() {
  if (filterPopupBuilt) return;
  filterPopupBuilt = true;

  const overlay = document.createElement('div');
  overlay.className = 'filter-overlay';
  overlay.id = 'filter-overlay';
  overlay.addEventListener('click', toggleFilterPopup);

  const panel = document.createElement('div');
  panel.className = 'filter-panel';
  panel.id = 'filter-panel';
  panel.addEventListener('click', (e) => e.stopPropagation());

  const header = document.createElement('div');
  header.className = 'filter-panel__header';
  header.innerHTML = `<span class="filter-panel__title">Filters</span>`;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'filter-panel__close';
  closeBtn.innerHTML = '&times;';
  closeBtn.addEventListener('click', toggleFilterPopup);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  const opts = itemFilterOptions || { types: [], rarities: [] };

  const raritySection = document.createElement('div');
  raritySection.className = 'filter-panel__section';
  raritySection.innerHTML = '<span class="filter-panel__label">Rarity</span>';
  const raritySelect = createRunicMultiSelect(opts.rarities, itemFilters.rarities, {
    placeholder: 'All rarities',
    colorFn: r => RARITY_COLORS[r] || '#c8c8c8',
  });
  raritySelect.onchange = (vals) => { itemFilters.rarities = vals; lastDataStr = ''; refreshQuests(); updateFabCount(); };
  raritySection.appendChild(raritySelect);
  panel.appendChild(raritySection);

  const typeSection = document.createElement('div');
  typeSection.className = 'filter-panel__section';
  typeSection.innerHTML = '<span class="filter-panel__label">Item Type</span>';
  const typeSelect = createRunicMultiSelect(opts.types, itemFilters.types, {
    placeholder: 'All types',
  });
  typeSelect.onchange = (vals) => { itemFilters.types = vals; lastDataStr = ''; refreshQuests(); updateFabCount(); };
  typeSection.appendChild(typeSelect);
  panel.appendChild(typeSection);

  const elSection = document.createElement('div');
  elSection.className = 'filter-panel__section';
  elSection.innerHTML = '<span class="filter-panel__label">Damage Element</span>';
  const elOptions = ['fire', 'cold', 'lightning', 'poison', 'arcane', 'physical', 'magic', 'elemental'];
  const elSelect = createRunicMultiSelect(elOptions, itemFilters.elements, {
    placeholder: 'All elements',
    colorFn: e => ELEMENT_COLORS[e] || '#c8c8c8',
  });
  elSelect.onchange = (vals) => { itemFilters.elements = vals; lastDataStr = ''; refreshQuests(); updateFabCount(); };
  elSection.appendChild(elSelect);
  panel.appendChild(elSection);

  const statSection = document.createElement('div');
  statSection.className = 'filter-panel__section';
  statSection.innerHTML = '<span class="filter-panel__label">Filter by Stat / Affix</span>';
  const statDefs = (itemFilterOptions && itemFilterOptions.stat_defs) || [];
  const statLabels = statDefs.map(s => s['Stat Display'].replace(/value\d\w?/g, 'X').replace(/\$\{.*?\}/g, '...'));
  const statIds = statDefs.map(s => s['Stat ID']);
  const statSelect = createRunicMultiSelect(statLabels, [], {
    placeholder: 'Search stats...',
  });
  statSelect.onchange = (selectedLabels) => {
    itemFilters.stats = selectedLabels.map(label => {
      const idx = statLabels.indexOf(label);
      return idx >= 0 ? statIds[idx] : '';
    }).filter(Boolean);
    lastDataStr = '';
    refreshQuests();
    updateFabCount();
  };
  statSection.appendChild(statSelect);
  panel.appendChild(statSection);

  const lvlSection = document.createElement('div');
  lvlSection.className = 'filter-panel__section';
  lvlSection.innerHTML = '<span class="filter-panel__label">Max Level Requirement</span>';
  const lvlInput = document.createElement('div');
  lvlInput.className = 'filter-level';
  lvlInput.innerHTML = `
    <input type="number" class="filter-level__input" id="filter-max-level"
           placeholder="Any level" min="0" max="100" value="${itemFilters.maxLevel || ''}">
  `;
  lvlInput.querySelector('input').addEventListener('input', (e) => {
    itemFilters.maxLevel = parseInt(e.target.value) || 0;
    lastDataStr = '';
    refreshQuests();
    updateFabCount();
  });
  lvlSection.appendChild(lvlInput);
  panel.appendChild(lvlSection);

  const sortSection = document.createElement('div');
  sortSection.className = 'filter-panel__section';
  sortSection.innerHTML = '<span class="filter-panel__label">Sort by</span>';
  const sortRow = document.createElement('div');
  sortRow.className = 'filter-panel__sort-row';
  sortRow.id = 'filter-sort-row';

  function renderSortButtons() {
    sortRow.innerHTML = '';
    for (const [key, label] of [['level', 'Level'], ['name', 'Alphabetical']]) {
      const btn = document.createElement('button');
      const isActive = itemFilters.sort === key;
      btn.className = 'filter-sort-btn' + (isActive ? ' filter-sort-btn--active' : '');
      btn.textContent = label + (isActive ? (itemFilters.sortDir === 'desc' ? ' \u25BC' : ' \u25B2') : '');
      btn.addEventListener('click', () => {
        if (itemFilters.sort === key) {
          itemFilters.sortDir = itemFilters.sortDir === 'desc' ? 'asc' : 'desc';
        } else {
          itemFilters.sort = key;
          itemFilters.sortDir = key === 'name' ? 'asc' : 'desc';
        }
        lastDataStr = '';
        renderSortButtons();
        refreshQuests();
      });
      sortRow.appendChild(btn);
    }
  }
  renderSortButtons();
  sortSection.appendChild(sortRow);
  panel.appendChild(sortSection);

  document.body.appendChild(overlay);
  document.body.appendChild(panel);
}

function toggleFilterPopup() {
  const overlay = document.getElementById('filter-overlay');
  const panel = document.getElementById('filter-panel');
  if (!overlay || !panel) return;
  const isOpen = overlay.classList.toggle('filter-overlay--open');
  panel.classList.toggle('filter-panel--open', isOpen);
}

function updateFabCount() {
  const fab = document.getElementById('filter-fab');
  if (!fab) return;
  const count = itemFilters.types.length + itemFilters.rarities.length + itemFilters.elements.length + itemFilters.stats.length + (itemFilters.maxLevel > 0 ? 1 : 0);
  const badge = fab.querySelector('.filter-fab__count');
  badge.textContent = count > 0 ? count : '';
}

function ensureFilterFab(list) {
  if (document.getElementById('filter-fab')) return;
  const fab = document.createElement('button');
  fab.className = 'filter-fab';
  fab.id = 'filter-fab';
  fab.innerHTML = `
    <svg class="filter-fab__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
    </svg>
    <span>Filters</span>
    <span class="filter-fab__count"></span>
  `;
  fab.addEventListener('click', () => {
    buildFilterPopup();
    toggleFilterPopup();
  });
  list.appendChild(fab);
  updateFabCount();
}

async function renderItems(list, status) {
  if (!itemFilterOptions || itemFilterOptions.types.length === 0) {
    try {
      const opts = await window.pywebview.api.get_item_filters();
      if (opts.types.length > 0) {
        itemFilterOptions = opts;
      }
    } catch (e) { return; }
  }

  const apiData = await window.pywebview.api.get_items(
    searchTerm,
    itemFilters.types.length > 0 ? itemFilters.types : null,
    itemFilters.rarities.length > 0 ? itemFilters.rarities : null,
    itemFilters.maxLevel || 0,
    itemFilters.elements.length > 0 ? itemFilters.elements : null,
    itemFilters.stats.length > 0 ? itemFilters.stats : null,
    itemFilters.sort,
    itemFilters.sortDir
  );

  const dataStr = JSON.stringify(apiData) + searchTerm + JSON.stringify(itemFilters);
  if (dataStr === lastDataStr) return;
  lastDataStr = dataStr;

  const scrollTop = list.scrollTop;
  list.innerHTML = '';

  const items = apiData.items || [];
  const total = apiData.total || 0;
  status.textContent = `${items.length}/${total} items`;

  if (items.length === 0) {
    list.innerHTML = `<div class="quest-list__empty"><span class="runic-header__rune">${RUNE}</span><span>${searchTerm || itemFilters.types.length || itemFilters.rarities.length ? 'No matching items' : 'Loading items...'}</span><span class="runic-header__rune">${RUNE}</span></div>`;
    ensureFilterFab(list);
    return;
  }

  const statDefs = (itemFilterOptions && itemFilterOptions.stat_defs) || [];
  for (const item of items) {
    list.appendChild(createItemCard(item, statDefs));
  }

  ensureFilterFab(list);
  list.scrollTop = scrollTop;
}

// ─── Stats rendering ───

let pinnedStats = [];
let snifferStatus = 'off';
let statsInterval = null;

const PILL_MAX_W = 350;

const STAT_LABELS = {
  character: { icon: '\uD83D\uDC64', name: 'Character', desc: 'Character info & kill stats' },
  session: { icon: '\u23F1', name: 'Session', desc: 'Session duration' },
  gold: { icon: '\uD83D\uDCB0', name: 'Gold', desc: 'Gold earned & per hour' },
  xp: { icon: '\u2B50', name: 'XP', desc: 'Experience earned & per hour' },
  items: { icon: '\uD83C\uDFF9', name: 'Items', desc: 'Item drops by rarity' },
  satanic_zone: { icon: '\uD83D\uDD25', name: 'Satanic Zone', desc: 'Current zone & buffs' },
};

function getBuffIcon(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('loot')) return '\uD83D\uDCE6';
  if (n.includes('rune')) return '\uD83D\uDD36';
  if (n.includes('gold')) return '\uD83D\uDCB0';
  if (n.includes('heroic')) return '\uD83D\uDEE1\uFE0F';
  if (n.includes('angelic')) return '\uD83D\uDC7C';
  if (n.includes('zephys') || n.includes('movement')) return '\uD83D\uDCA8';
  if (n.includes('fury') || n.includes('attack speed')) return '\u26A1';
  if (n.includes('casting')) return '\u2728';
  if (n.includes('onslaught') || n.includes('damage')) return '\u2694\uFE0F';
  if (n.includes('nether') || n.includes('magic')) return '\uD83D\uDD2E';
  if (n.includes('relic')) return '\uD83D\uDC8E';
  if (n.includes('goblin')) return '\uD83E\uDE99';
  if (n.includes('artifact') || n.includes('magic find')) return '\uD83D\uDD0D';
  if (n.includes('recruit') || n.includes('training') || n.includes('scarred') || n.includes('experience')) return '\uD83D\uDCDA';
  if (n.includes('clairvoyance') || n.includes('recovery')) return '\uD83D\uDC9A';
  if (n.includes('aftermath') || n.includes('legion')) return '\uD83D\uDC80';
  if (n.includes('deep cuts') || n.includes('critical')) return '\uD83D\uDDE1\uFE0F';
  if (n.includes('town') || n.includes('terror') || n.includes('carnage') || n.includes('ancient')) return '\uD83C\uDFDB\uFE0F';
  return '\uD83D\uDD25';
}

function formatNumber(n) {
  if (n == null) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function renderStatCard(key, data, isPinned) {
  const meta = STAT_LABELS[key];
  if (!meta) return '';
  const pinClass = isPinned ? ' stat-card__pin--active' : '';
  const pinSvg = isPinned
    ? `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1l2 3h3l-1 3 1 3H10l-2 3-2-3H3l1-3-1-3h3z"/></svg>`
    : `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 3v10M3 8h10"/></svg>`;

  let content = '';
  if (key === 'character' && data) {
    content = `<div class="stat-card__row"><span class="stat-card__label">Name</span><span class="stat-card__value">${data.name || '?'}</span></div>`;
    content += `<div class="stat-card__row"><span class="stat-card__label">Level</span><span class="stat-card__value">${data.level || 0}</span></div>`;
    content += `<div class="stat-card__row"><span class="stat-card__label">Difficulty</span><span class="stat-card__value">${data.difficulty || 0}${data.hardcore ? ' (HC)' : ''}</span></div>`;
    content += `<div class="stat-card__row"><span class="stat-card__label">Kills</span><span class="stat-card__value">${formatNumber(data.total_kills)}</span></div>`;
    content += `<div class="stat-card__row"><span class="stat-card__label">Champions</span><span class="stat-card__value">${formatNumber(data.champion_kills)}</span></div>`;
    content += `<div class="stat-card__row"><span class="stat-card__label">Ancients</span><span class="stat-card__value">${formatNumber(data.ancient_kills)}</span></div>`;
    content += `<div class="stat-card__row"><span class="stat-card__label">Deaths</span><span class="stat-card__value">${data.deaths || 0}</span></div>`;
  } else if (key === 'session' && data) {
    content = `<div class="stat-card__value">${data.duration || '0:00:00'}</div>`;
    if (data.has_mail) content += `<div class="stat-card__sub">\uD83D\uDCEC Mail available</div>`;
  } else if (key === 'gold' && data) {
    content = `<div class="stat-card__row"><span class="stat-card__label">Earned</span><span class="stat-card__value">${formatNumber(data.earned)}</span></div>`;
    content += `<div class="stat-card__row"><span class="stat-card__label">Per hour</span><span class="stat-card__value">${formatNumber(data.per_hour)}</span></div>`;
    content += `<div class="stat-card__row"><span class="stat-card__label">Total</span><span class="stat-card__value stat-card__value--dim">${formatNumber(data.total)}</span></div>`;
  } else if (key === 'xp' && data) {
    content = `<div class="stat-card__row"><span class="stat-card__label">Earned</span><span class="stat-card__value">${formatNumber(data.earned)}</span></div>`;
    content += `<div class="stat-card__row"><span class="stat-card__label">Per hour</span><span class="stat-card__value">${formatNumber(data.per_hour)}</span></div>`;
    content += `<div class="stat-card__row"><span class="stat-card__label">Total</span><span class="stat-card__value stat-card__value--dim">${formatNumber(data.total)}</span></div>`;
  } else if (key === 'items' && data) {
    const rarities = ['Angelic', 'Unholy', 'Heroic', 'Satanic'];
    for (const r of rarities) {
      const d = data[r];
      if (d) content += `<div class="stat-card__row"><span class="stat-card__label" style="color:${RARITY_COLORS[r] || '#c8c8c8'}">${r}</span><span class="stat-card__value">${d.total}${d.mf ? ` <span class="stat-card__mf">(${d.mf} MF)</span>` : ''}</span></div>`;
    }
  } else if (key === 'satanic_zone') {
    if (data && data.zone) {
      content = `<div class="stat-card__zone">${data.zone}</div>`;
      if (data.buffs && data.buffs.length > 0) {
        for (const b of data.buffs) {
          const ico = getBuffIcon(b.name);
          content += `<div class="stat-card__buff">`;
          content += `<span class="stat-card__buff-icon">${ico}</span>`;
          content += `<div class="stat-card__buff-info"><span class="stat-card__buff-name">${b.name}</span><span class="stat-card__buff-desc">${b.desc || ''}</span></div>`;
          content += `</div>`;
        }
      }
    } else {
      content = `<div class="stat-card__value stat-card__value--dim">Waiting for server update...</div><div class="stat-card__hint"><span class="stat-card__hint-icon">\u21BB</span>You can force a refresh by vote resetting or creating a new game.</div>`;
    }
  } else if (!data) {
    content = `<div class="stat-card__value stat-card__value--dim">Waiting for game data...</div>`;
  }

  return `
    <div class="stat-card" data-stat-key="${key}">
      <div class="item-card__corner item-card__corner--tl"></div>
      <div class="item-card__corner item-card__corner--tr"></div>
      <div class="item-card__corner item-card__corner--bl"></div>
      <div class="item-card__corner item-card__corner--br"></div>
      <div class="stat-card__header">
        <span class="stat-card__icon">${meta.icon}</span>
        <span class="stat-card__name">${meta.name}</span>
        <button class="stat-card__pin${pinClass}" data-pin-stat="${key}" data-tip="${isPinned ? 'Unpin from pill' : 'Pin to pill'}" data-tip-pos="left">${pinSvg}</button>
      </div>
      <div class="stat-card__body">${content}</div>
    </div>`;
}

async function renderStats(list, status) {
  try {
    snifferStatus = await window.pywebview.api.get_sniffer_status();
    pinnedStats = await window.pywebview.api.get_pinned_stats() || [];
  } catch (e) {}

  let statsData = null;
  try { statsData = await window.pywebview.api.get_live_stats(); } catch (e) {}

  const scrollTop = list.scrollTop;
  list.innerHTML = '';

  // Status indicator
  let statusIcon = '\u25CB';
  let statusText = 'Sniffer off';
  let statusClass = 'off';
  if (snifferStatus === 'searching') { statusIcon = '\u25CE'; statusText = 'Searching for game...'; statusClass = 'searching'; }
  else if (snifferStatus === 'connected') { statusIcon = '\u25CF'; statusText = 'Connected'; statusClass = 'connected'; }
  else if (snifferStatus === 'error') { statusIcon = '\u25CF'; statusText = 'Error (Npcap installed?)'; statusClass = 'error'; }

  let html = `<div class="stats-status stats-status--${statusClass}">`;
  html += `<span class="stats-status__dot">${statusIcon}</span>`;
  html += `<span class="stats-status__text">${statusText}</span>`;
  html += `<button class="runic-btn runic-btn--sm" id="stats-reset-btn" data-tip="Reset session">Reset</button>`;
  html += `</div>`;

  // Stat cards
  const keys = ['character', 'session', 'gold', 'xp', 'items', 'satanic_zone'];
  for (const key of keys) {
    const data = statsData ? statsData[key] : null;
    html += renderStatCard(key, data, pinnedStats.includes(key));
  }

  list.innerHTML = html;
  status.textContent = snifferStatus === 'connected' ? 'live' : snifferStatus;

  // Pin listeners
  list.querySelectorAll('[data-pin-stat]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const key = btn.dataset.pinStat;
      const idx = pinnedStats.indexOf(key);
      if (idx >= 0) pinnedStats.splice(idx, 1);
      else pinnedStats.push(key);
      await window.pywebview.api.set_pinned_stats(pinnedStats);
      lastDataStr = '';
      refreshQuests();
    });
  });

  // Reset button
  list.querySelector('#stats-reset-btn')?.addEventListener('click', async () => {
    await window.pywebview.api.reset_stats();
    lastDataStr = '';
    refreshQuests();
  });

  list.scrollTop = scrollTop;
}

// ─── Pill stats display ───

function renderPillStatsHTML(data) {
  if (!data || Object.keys(data).length === 0) return '';
  let html = '';

  for (const [key, val] of Object.entries(data)) {
    const meta = STAT_LABELS[key];
    if (!meta) continue;

    if (key === 'satanic_zone') {
      if (!val || !val.zone) {
        html += `<div class="pill-sz pill-sz--waiting"><span class="pill-sz__zone pill-sz__zone--dim">${RUNE} Satanic Zone</span><span class="pill-sz__waiting-text">Waiting for server update...</span><span class="pill-sz__hint"><span class="pill-sz__hint-icon">\u21BB</span>Vote reset or create a new game to force refresh</span></div>`;
        continue;
      }
      html += `<div class="pill-sz">`;
      html += `<div class="pill-sz__zone">${val.zone}</div>`;
      if (val.buffs && val.buffs.length > 0) {
        for (const b of val.buffs) {
          const ico = getBuffIcon(b.name);
          html += `<div class="pill-sz__buff">`;
          html += `<span class="pill-sz__buff-icon">${ico}</span>`;
          html += `<div class="pill-sz__buff-info">`;
          html += `<span class="pill-sz__buff-name">${b.name}</span>`;
          if (b.desc) html += `<span class="pill-sz__buff-desc">${b.desc}</span>`;
          html += `</div></div>`;
        }
      }
      html += `</div>`;
      continue;
    }

    if (!val) continue;
    // Compact stat line
    let display = '';
    if (key === 'character') display = val.name ? `${val.name} Lv.${val.level}` : '';
    else if (key === 'session') display = val.duration || '';
    else if (key === 'gold') display = formatNumber(val.earned);
    else if (key === 'xp') display = formatNumber(val.earned);
    else if (key === 'items') {
      const parts = [];
      for (const r of ['Angelic', 'Heroic', 'Satanic']) {
        if (val[r]) parts.push(`${val[r].total}`);
      }
      display = parts.join(' / ');
    }
    if (!display) continue;
    html += `<div class="pill-stat"><span class="pill-stat__icon">${meta.icon}</span><span class="pill-stat__label">${meta.name}</span><span class="pill-stat__value">${display}</span></div>`;
  }
  return html;
}

async function updatePillStats() {
  if (!isCollapsed || !isPillMode) return;
  const icon = document.getElementById('pill-logo');
  const container = document.getElementById('pill-stats');
  if (!container) return;

  const pillContent = document.getElementById('pill-content');

  if (!pinnedStats || pinnedStats.length === 0) {
    // No pins → logo only
    if (icon) icon.style.display = '';
    container.innerHTML = '';
    if (pillContent) pillContent.classList.add('pill-content--logo-only');
    return;
  }

  try {
    const data = await window.pywebview.api.get_pill_stats();
    const newHtml = renderPillStatsHTML(data);

    if (!newHtml) {
      // Pinned but no data yet → show placeholders
      if (icon) icon.style.display = 'none';
      if (pillContent) pillContent.classList.remove('pill-content--logo-only');
      let placeholderHtml = '';
      for (const key of pinnedStats) {
        const meta = STAT_LABELS[key];
        if (!meta) continue;
        if (key === 'satanic_zone') {
          placeholderHtml += `<div class="pill-sz pill-sz--waiting"><span class="pill-sz__zone pill-sz__zone--dim">${RUNE} Satanic Zone</span><span class="pill-sz__waiting-text">Waiting for server update...</span><span class="pill-sz__hint"><span class="pill-sz__hint-icon">\u21BB</span>Vote reset or create a new game to force refresh</span></div>`;
        } else {
          placeholderHtml += `<div class="pill-stat"><span class="pill-stat__icon">${meta.icon}</span><span class="pill-stat__label">${meta.name}</span><span class="pill-stat__value pill-stat__value--dim">-</span></div>`;
        }
      }
      container.innerHTML = placeholderHtml;
      // Resize for placeholders
      requestAnimationFrame(() => {
        const h = pillContent.scrollHeight + 4;
        const w = Math.min(pillContent.scrollWidth + 22, PILL_MAX_W);
        window.pywebview.api.resize_pill(Math.max(w, 270), Math.max(h, 30));
      });
      return;
    }

    // We have data to show → hide logo, show stats
    if (container.innerHTML !== newHtml) {
      if (icon) icon.style.display = 'none';
      if (pillContent) pillContent.classList.remove('pill-content--logo-only');
      container.innerHTML = newHtml;

      // Resize pill to fit actual rendered content
      requestAnimationFrame(() => {
        const h = pillContent.scrollHeight + 4;  // +4 for border
        const w = Math.min(pillContent.scrollWidth + 22, PILL_MAX_W);   // +22 for padding+border
        window.pywebview.api.resize_pill(Math.max(w, 270), Math.max(h, 30));
      });
    }

    // Mail badge — show/hide the tab peeking behind the pill
    const mailBadge = document.getElementById('pill-mail-badge');
    if (mailBadge) {
      const hasMail = data && data.has_mail;
      mailBadge.style.display = hasMail ? '' : 'none';
    }
  } catch (e) {}
}

// ─── Main refresh ───

async function refreshQuests() {
  try {
    const list = document.getElementById('quest-list');
    const status = document.getElementById('status-text');

    if (currentCategory === 'runewords') { await renderRunewords(list, status)(); return; }
    if (currentCategory === 'runes') { await renderRunes(list, status)(); return; }
    if (currentCategory === 'items') { await renderItems(list, status); return; }
    if (currentCategory === 'stats') { await renderStats(list, status); return; }

    // Load web quest data if not yet available (needed for both tabs)
    if (!webQuestData) {
      try { webQuestData = await window.pywebview.api.get_all_web_quests(); } catch (e) {}
    }

    // Quests category
    if (currentTab === 'pinned') {
      const presetStr = JSON.stringify(presetsData) + searchTerm + (webQuestData ? 'wd' : '');
      if (presetStr === lastDataStr) return;
      lastDataStr = presetStr;
      const scrollTop = list.scrollTop;
      list.innerHTML = '';
      renderGuide(list, status);
      list.scrollTop = scrollTop;
      return;
    }

    // "All" tab
    if (!webQuestData) {
      try { webQuestData = await window.pywebview.api.get_all_web_quests(); } catch (e) {}
    }

    const dataStr = JSON.stringify(webQuestData) + searchTerm;
    if (dataStr === lastDataStr) return;
    lastDataStr = dataStr;

    const scrollTop = list.scrollTop;
    list.innerHTML = '';

    if (!webQuestData || !webQuestData.questlines || webQuestData.questlines.length === 0) {
      list.innerHTML = `<div class="quest-list__empty"><span class="runic-header__rune">${RUNE}</span><span>Loading web data...</span><span class="runic-header__rune">${RUNE}</span></div>`;
      status.textContent = 'loading...';
      return;
    }

    let totalQuests = 0;
    let shownQuests = 0;

    for (const ql of webQuestData.questlines) {
      totalQuests += ql.quests.length;

      const filtered = ql.quests.filter(q => {
        if (!searchTerm) return true;
        return q.name.toLowerCase().includes(searchTerm) ||
               ql.questline.toLowerCase().includes(searchTerm) ||
               (q.description && q.description.toLowerCase().includes(searchTerm)) ||
               q.objectives.some(o => o.label.toLowerCase().includes(searchTerm));
      });

      if (filtered.length === 0) continue;
      shownQuests += filtered.length;

      const section = document.createElement('div');
      section.className = 'questline-section';
      const header = document.createElement('div');
      header.className = 'questline-header';
      header.innerHTML = `<span class="questline-header__arrow">\u25BC</span><span class="questline-header__name">${ql.questline}</span><span class="questline-header__count">${filtered.length} quests</span>`;
      header.addEventListener('click', () => section.classList.toggle('questline-section--collapsed'));
      section.appendChild(header);

      const body = document.createElement('div');
      body.className = 'questline-body';
      for (const quest of filtered) {
        body.appendChild(createAllQuestCard(quest, ql.questline));
      }
      section.appendChild(body);
      list.appendChild(section);
    }

    status.textContent = searchTerm ? `${shownQuests}/${totalQuests} quests` : `${totalQuests} quests`;
    list.scrollTop = scrollTop;
  } catch (e) {
    // API not ready
  }
}

// ─── Window controls ───

function initWindowControls() {
  document.getElementById('btn-minimize').addEventListener('click', () => {
    window.pywebview.api.minimize_window();
  });
  document.getElementById('btn-close').addEventListener('click', () => {
    window.pywebview.api.close_window();
  });

  document.getElementById('btn-debug').addEventListener('click', async () => {
    try {
      const state = await window.pywebview.api.get_debug_state();
      const text = JSON.stringify(state, null, 2);
      await navigator.clipboard.writeText(text);
      const btn = document.getElementById('btn-debug');
      btn.classList.add('copied');
      setTimeout(() => btn.classList.remove('copied'), 1500);
    } catch (e) {
      console.error('Copy failed', e);
    }
  });

  const dragArea = document.getElementById('titlebar');
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
    window.pywebview.api.move_window(dx, dy);
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
  });
}

// ─── Web status ───

async function updateWebStatus() {
  try {
    const status = await window.pywebview.api.get_web_status();
    const el = document.getElementById('web-status');
    el.className = `titlebar__web-status titlebar__web-status--${status}`;
    const titles = {
      loading: 'Fetching web data...',
      ready: 'Web data loaded',
      cached: 'Using cached web data',
      offline: 'Web data unavailable',
    };
    el.title = titles[status] || status;

    // Refresh web quest data when status changes to ready
    if (status === 'ready' && !webQuestData) {
      webQuestData = await window.pywebview.api.get_all_web_quests();
      lastDataStr = '';
      refreshQuests();
    }
  } catch (e) {}
}

// ─── Settings panel ───

let pillOrigin = 'top-right';
let fontTheme = 'classic';
let settingsBuilt = false;

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

function toggleSettings() {
  if (!settingsBuilt) buildSettingsPanel();
  const overlay = document.getElementById('settings-overlay');
  const panel = document.getElementById('settings-panel');
  const isOpen = overlay.classList.toggle('settings-overlay--open');
  panel.classList.toggle('settings-panel--open', isOpen);
}

function initSettings() {
  document.getElementById('btn-settings').addEventListener('click', toggleSettings);
}

function buildSettingsPanel() {
  settingsBuilt = true;

  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  overlay.id = 'settings-overlay';
  overlay.addEventListener('click', toggleSettings);

  const panel = document.createElement('div');
  panel.className = 'settings-panel';
  panel.id = 'settings-panel';
  panel.addEventListener('click', e => e.stopPropagation());

  panel.innerHTML = `
    <div class="settings-panel__header">
      <span class="settings-panel__title">Settings</span>
      <button class="settings-panel__close" id="settings-close">&times;</button>
    </div>
    <div class="setting-row">
      <div class="setting-row__info">
        <div class="setting-row__label">Pill Mode</div>
        <div class="setting-row__desc">When enabled, the window collapses into a small icon when your mouse leaves. Click the icon to expand it back.</div>
      </div>
      <label class="runic-toggle">
        <input type="checkbox" id="toggle-pill-mode" ${isPillMode ? 'checked' : ''}>
        <div class="runic-toggle__track"></div>
        <div class="runic-toggle__thumb"></div>
      </label>
    </div>
    <div class="setting-row setting-row--vertical">
      <div class="setting-row__info">
        <div class="setting-row__label">Expansion Origin</div>
        <div class="setting-row__desc">Which corner of the pill stays anchored when the window expands.</div>
      </div>
      <div class="origin-picker" id="origin-picker">
        <button class="origin-picker__btn${pillOrigin === 'top-left' ? ' origin-picker__btn--active' : ''}" data-origin="top-left">
          <span class="origin-picker__arrow">\u2196</span><span class="origin-picker__label">Top Left</span>
        </button>
        <button class="origin-picker__btn${pillOrigin === 'top-right' ? ' origin-picker__btn--active' : ''}" data-origin="top-right">
          <span class="origin-picker__arrow">\u2197</span><span class="origin-picker__label">Top Right</span>
        </button>
        <button class="origin-picker__btn${pillOrigin === 'bottom-left' ? ' origin-picker__btn--active' : ''}" data-origin="bottom-left">
          <span class="origin-picker__arrow">\u2199</span><span class="origin-picker__label">Bot. Left</span>
        </button>
        <button class="origin-picker__btn${pillOrigin === 'bottom-right' ? ' origin-picker__btn--active' : ''}" data-origin="bottom-right">
          <span class="origin-picker__arrow">\u2198</span><span class="origin-picker__label">Bot. Right</span>
        </button>
      </div>
    </div>
    <div class="setting-row setting-row--vertical">
      <div class="setting-row__info">
        <div class="setting-row__label">Font</div>
        <div class="setting-row__desc">Choose a font for better readability.</div>
      </div>
      <div class="origin-picker" id="font-picker">
        <button class="origin-picker__btn${fontTheme === 'classic' ? ' origin-picker__btn--active' : ''}" data-font="classic">
          <span class="origin-picker__label" style="font-family:Georgia,serif">Classic</span>
        </button>
        <button class="origin-picker__btn${fontTheme === 'system' ? ' origin-picker__btn--active' : ''}" data-font="system">
          <span class="origin-picker__label" style="font-family:'Segoe UI',sans-serif">System</span>
        </button>
      </div>
    </div>
    <div class="settings-panel__credits">
      <div class="settings-panel__credit-line">Game data by <a href="https://hero-siege-helper.vercel.app/" target="_blank" class="settings-panel__link">hero-siege-helper.vercel.app</a></div>
      <div class="settings-panel__credit-line">Stats inspired by <a href="https://github.com/GuilhermeFaga/hero-siege-stats" target="_blank" class="settings-panel__link">Hero Siege Stats</a></div>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(panel);

  // Open links in external browser
  panel.querySelectorAll('.settings-panel__link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      window.pywebview.api.open_url(link.href);
    });
  });

  panel.querySelector('#settings-close').addEventListener('click', toggleSettings);

  panel.querySelector('#toggle-pill-mode').addEventListener('change', async (e) => {
    isPillMode = e.target.checked;
    await window.pywebview.api.set_setting('pill_mode', isPillMode);
    document.getElementById('btn-pill').style.display = isPillMode ? '' : 'none';
  });

  panel.querySelectorAll('.origin-picker__btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      pillOrigin = btn.dataset.origin;
      await window.pywebview.api.set_setting('pill_origin', pillOrigin);
      panel.querySelectorAll('.origin-picker__btn').forEach(b => b.classList.remove('origin-picker__btn--active'));
      btn.classList.add('origin-picker__btn--active');
    });
  });

  // Font picker
  panel.querySelectorAll('[data-font]').forEach(btn => {
    btn.addEventListener('click', async () => {
      fontTheme = btn.dataset.font;
      applyFontTheme(fontTheme);
      await window.pywebview.api.set_setting('font_theme', fontTheme);
      panel.querySelectorAll('[data-font]').forEach(b => b.classList.remove('origin-picker__btn--active'));
      btn.classList.add('origin-picker__btn--active');
    });
  });
}

// ─── Pill mode ───

function closeAllPanels() {
  const so = document.getElementById('settings-overlay');
  const sp = document.getElementById('settings-panel');
  if (so) so.classList.remove('settings-overlay--open');
  if (sp) sp.classList.remove('settings-panel--open');
  const fo = document.getElementById('filter-overlay');
  const fp = document.getElementById('filter-panel');
  if (fo) fo.classList.remove('filter-overlay--open');
  if (fp) fp.classList.remove('filter-panel--open');
  closeAddPopup();
}

async function collapseToPill() {
  if (isCollapsed) return;
  isCollapsed = true;
  closeAllPanels();
  const app = document.getElementById('app');
  app.classList.add('app--hidden');

  const pillIcon = document.getElementById('pill-logo');
  const pillStats = document.getElementById('pill-stats');
  const pillContent = document.getElementById('pill-content');

  // If stats are pinned, prepare content BEFORE showing pill (no logo flash)
  if (pinnedStats && pinnedStats.length > 0) {
    let preHtml = '';
    try {
      const data = await window.pywebview.api.get_pill_stats();
      preHtml = renderPillStatsHTML(data);
    } catch (e) {}

    if (preHtml) {
      if (pillIcon) pillIcon.style.display = 'none';
      if (pillContent) pillContent.classList.remove('pill-content--logo-only');
      if (pillStats) pillStats.innerHTML = preHtml;
    } else {
      // No data yet — show logo
      if (pillIcon) pillIcon.style.display = '';
      if (pillStats) pillStats.innerHTML = '';
      if (pillContent) pillContent.classList.add('pill-content--logo-only');
    }
  } else {
    // No pins — logo only
    if (pillIcon) pillIcon.style.display = '';
    if (pillStats) pillStats.innerHTML = '';
    if (pillContent) pillContent.classList.add('pill-content--logo-only');
  }

  document.getElementById('pill-view').style.display = 'flex';

  // Resize after content is ready
  if (pinnedStats && pinnedStats.length > 0 && pillStats.innerHTML) {
    requestAnimationFrame(() => {
      const h = pillContent.scrollHeight + 4;
      const w = Math.min(pillContent.scrollWidth + 22, PILL_MAX_W);
      window.pywebview.api.resize_pill(Math.max(w, 270), Math.max(h, 30));
    });
  } else {
    window.pywebview.api.collapse_to_pill([]);
  }
}

function expandFromPill() {
  if (!isCollapsed) return;
  isCollapsed = false;
  // Reset pill view state
  document.getElementById('pill-view').style.display = 'none';
  const pillIcon = document.getElementById('pill-logo');
  if (pillIcon) pillIcon.style.display = '';
  const pillStatsEl = document.getElementById('pill-stats');
  if (pillStatsEl) pillStatsEl.innerHTML = '';
  window.pywebview.api.expand_from_pill().then(() => {
    const app = document.getElementById('app');
    app.classList.remove('app--hidden');
    app.classList.add('app--fading-in');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        app.classList.remove('app--fading-in');
        app.classList.add('app--visible');
        setTimeout(() => app.classList.remove('app--visible'), 200);
      });
    });
  });
}

function initPillMode() {
  document.getElementById('btn-pill').addEventListener('click', collapseToPill);

  // Pill interaction: short click = expand, long press = drag
  const pillView = document.getElementById('pill-view');
  let pillDragState = null; // { timer, startX, startY, isDragging }
  const LONG_PRESS_MS = 250;
  const DRAG_THRESHOLD = 4; // px movement to confirm drag

  pillView.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const sx = e.screenX, sy = e.screenY;
    pillDragState = { startX: sx, startY: sy, isDragging: false, moved: false };
    pillDragState.timer = setTimeout(() => {
      if (pillDragState) {
        pillDragState.isDragging = true;
        pillView.style.cursor = 'grabbing';
      }
    }, LONG_PRESS_MS);
  });

  document.addEventListener('mousemove', (e) => {
    if (!pillDragState) return;
    const dx = e.screenX - pillDragState.startX;
    const dy = e.screenY - pillDragState.startY;
    // If moved before long-press timer, start drag immediately
    if (!pillDragState.isDragging && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
      clearTimeout(pillDragState.timer);
      pillDragState.isDragging = true;
      pillView.style.cursor = 'grabbing';
    }
    if (pillDragState.isDragging) {
      pillDragState.moved = true;
      pillDragState.startX = e.screenX;
      pillDragState.startY = e.screenY;
      window.pywebview.api.move_window(dx, dy);
    }
  });

  document.addEventListener('mouseup', () => {
    if (!pillDragState) return;
    clearTimeout(pillDragState.timer);
    pillView.style.cursor = '';
    const wasDragging = pillDragState.isDragging && pillDragState.moved;
    pillDragState = null;
    // Only expand if it was a short click (not a drag)
    if (!wasDragging && isCollapsed) {
      expandFromPill();
    }
  });

  document.addEventListener('mouseleave', async () => {
    // Cancel any pill drag in progress
    if (pillDragState) {
      clearTimeout(pillDragState.timer);
      pillView.style.cursor = '';
      pillDragState = null;
    }
    if (isPillMode && !isCollapsed) {
      // Don't collapse when the editor window is open
      try {
        const editorOpen = await window.pywebview.api.is_editor_open();
        if (editorOpen) return;
      } catch (e) {}
      collapseToPill();
    }
  });
}

// ─── Clipboard fix for pywebview frameless ───

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey) {
    // Ensure copy/paste/cut/undo/redo work in inputs and editors
    if (['c', 'v', 'x', 'a', 'z', 'y'].includes(e.key.toLowerCase())) {
      // Don't block — let the default behavior through
      return true;
    }
  }
});

// ─── Init ───

initCategorySelect();
initTabs();
initSearch();
initWindowControls();
initSettings();
initPillMode();
setInterval(refreshQuests, 1000);
setInterval(updateWebStatus, 3000);
setInterval(updatePillStats, 500);

window.addEventListener('pywebviewready', async () => {
  // Load presets
  try {
    presetsData = await window.pywebview.api.get_presets_data();
  } catch (e) {}

  // Load pinned stats
  try {
    pinnedStats = await window.pywebview.api.get_pinned_stats() || [];
  } catch (e) {}

  // Load settings
  try {
    const settings = await window.pywebview.api.get_settings();
    isPillMode = settings.pill_mode || false;
    pillOrigin = settings.pill_origin || 'top-right';
    fontTheme = settings.font_theme || 'classic';
    applyFontTheme(fontTheme);
    document.getElementById('btn-pill').style.display = isPillMode ? '' : 'none';
    // Auto-collapse to pill on startup if pill mode is active
    if (isPillMode) {
      setTimeout(() => collapseToPill(), 300);
    }
  } catch (e) {}

  refreshQuests();
  updateWebStatus();
});

// Called by Python via evaluate_js when editor changes presets
async function reloadPresets() {
  try {
    presetsData = await window.pywebview.api.get_presets_data();
    lastDataStr = '';
    refreshQuests();
  } catch (e) {}
}
window.reloadPresets = reloadPresets;
