import { BarcodeDetector } from 'https://cdn.jsdelivr.net/npm/barcode-detector@2/dist/es/pure.min.js';

// ============================================================
// lyrec v3.2 -- Lyra's Album Recommendations
// ============================================================

var albumData = null;
var detector = null;
var videoStream = null;
var scanning = false;
var lastCode = '';
var lastTime = 0;
var searchTimeout = null;

// Watchdog state
var lastDetectAttempt = 0;
var watchdogInterval = null;
var WATCHDOG_STALL_MS = 8000;    // if no detect attempts in 8s, mark yellow
var WATCHDOG_RESTART_MS = 20000; // auto-restart after 20s of no attempts

// ---- DOM refs ----

var video = document.getElementById('video');
var scanBtn = document.getElementById('scan-btn');
var statusLine1 = document.getElementById('data-status-line1');
var statusLine2 = document.getElementById('data-status-line2');
var splashImage = document.getElementById('splash-image');
var splashImg = document.getElementById('splash-img');
var scanIndicator = document.getElementById('scan-indicator');
var scanPulse = scanIndicator.querySelector('.scan-pulse');
var restartCamBtn = document.getElementById('restart-cam-btn');

var resultOverlay = document.getElementById('result-overlay');
var resultThumb = document.getElementById('result-thumb');
var resultBadge = document.getElementById('result-badge');
var resultArtist = document.getElementById('result-artist');
var resultAlbum = document.getElementById('result-album');
var resultCompletion = document.getElementById('result-completion');
var resultTracks = document.getElementById('result-tracks');
var resultFormat = document.getElementById('result-format');
var resultEncoding = document.getElementById('result-encoding');
var resultRecommendation = document.getElementById('result-recommendation');
var resultBarcode = document.getElementById('result-barcode');
var dismissBtn = document.getElementById('dismiss-btn');

var notfoundOverlay = document.getElementById('notfound-overlay');
var notfoundBarcode = document.getElementById('notfound-barcode');
var dismissNfBtn = document.getElementById('dismiss-nf-btn');

var menuBtn = document.getElementById('menu-btn');
var menuOverlay = document.getElementById('menu-overlay');
var menuClose = document.getElementById('menu-close');
var menuHistorySub = document.getElementById('menu-history-sub');

var gsPage = document.getElementById('gs-page');
var historyPage = document.getElementById('history-page');
var aboutPage = document.getElementById('about-page');

var historyRecent = document.getElementById('history-recent');
var historySummary = document.getElementById('history-summary');
var historyClearBtn = document.getElementById('history-clear-btn');
var historyTabs = document.querySelectorAll('.history-tab');

var barcodeInput = document.getElementById('barcode-input');
var barcodeGo = document.getElementById('barcode-go');
var searchInput = document.getElementById('search-input');
var searchResults = document.getElementById('search-results');

// ---- Splash image selector ----

var splashImages = [
  'images/lyrec_icon_1024_edge_1.png',
  'images/lyrec_icon_1024_edge_2.png',
  'images/lyrec_icon_1024_edge_3.png',
  'images/lyrec_icon_1024_edge_4.png'
];

var splashIndex = parseInt(localStorage.getItem('lyrec_splash') || '2', 10);
if (splashIndex < 0 || splashIndex >= splashImages.length) splashIndex = 2;
splashImg.src = splashImages[splashIndex];

splashImage.addEventListener('click', function () {
  splashIndex = (splashIndex + 1) % splashImages.length;
  splashImg.src = splashImages[splashIndex];
  localStorage.setItem('lyrec_splash', String(splashIndex));
});

// ---- Data loading ----

function loadData() {
  statusLine1.textContent = 'Loading...';
  statusLine2.textContent = '';
  fetch('data/store-check.json?t=' + Date.now())
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) {
      albumData = data;
      updateStatusBar();
      updateAboutPage();
      scanBtn.disabled = false;
    })
    .catch(function (err) {
      statusLine1.innerHTML = '<span class="error">Failed to load data</span>';
      statusLine2.textContent = '';
      console.error('Data load error:', err);
    });
}

function updateStatusBar() {
  if (!albumData) return;
  var count = albumData.album_count || 0;
  var total = albumData.total_library_albums || count;
  var pct = total > 0 ? Math.round((count / total) * 100) : 0;

  statusLine1.textContent = formatNum(count) + ' albums of ' + formatNum(total) + ' indexed';

  var ageText = getDataAge(albumData.generated || '');
  statusLine2.innerHTML = pct + '% UPC &middot; ' + ageText;
}

function formatNum(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function getDataAge(isoString) {
  if (!isoString) return '<span class="old">no date</span>';
  var genDate = new Date(isoString);
  var now = new Date();
  var diffMs = now - genDate;
  var diffDays = Math.floor(diffMs / 86400000);

  if (diffDays === 0) return '<span class="ready">updated today</span>';
  if (diffDays === 1) return '<span class="ready">updated yesterday</span>';
  if (diffDays <= 3) return '<span class="stale">' + diffDays + ' days ago</span>';
  return '<span class="old">' + diffDays + ' days ago</span>';
}

// ---- About page stats ----

function updateAboutPage() {
  if (!albumData) return;
  var count = albumData.album_count || 0;
  var total = albumData.total_library_albums || 0;
  var pct = total > 0 ? Math.round((count / total) * 100) : 0;

  // Count thumbs
  var thumbCount = 0;
  var keys = Object.keys(albumData.albums || {});
  for (var i = 0; i < keys.length; i++) {
    if (albumData.albums[keys[i]].thumb) thumbCount++;
  }
  var thumbPct = count > 0 ? Math.round((thumbCount / count) * 100) : 0;

  document.getElementById('about-indexed').textContent = formatNum(count);
  document.getElementById('about-total').textContent = formatNum(total);
  document.getElementById('about-coverage').textContent = pct + '%';
  document.getElementById('about-artwork').textContent = formatNum(thumbCount) + ' (' + thumbPct + '%)';

  var gen = albumData.generated || '';
  if (gen) {
    var d = new Date(gen);
    var dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    document.getElementById('about-generated').textContent = dateStr;
  }
}

// ---- Barcode lookup ----

function normalizeBarcode(raw) {
  return raw.replace(/\D/g, '');
}

function lookupBarcode(raw) {
  if (!albumData || !albumData.albums) return null;
  var code = normalizeBarcode(raw);
  if (albumData.albums[code]) return albumData.albums[code];
  if (code.length === 12 && albumData.albums['0' + code]) {
    return albumData.albums['0' + code];
  }
  if (code.length === 13 && code[0] === '0' && albumData.albums[code.substring(1)]) {
    return albumData.albums[code.substring(1)];
  }
  return null;
}

// ---- Haptic feedback ----

function hapticSuccess() {
  try { if (navigator.vibrate) navigator.vibrate(80); } catch (e) {}
}

function hapticNotFound() {
  try { if (navigator.vibrate) navigator.vibrate([40, 60, 40]); } catch (e) {}
}

// ---- Scanner ----

async function initDetector() {
  detector = new BarcodeDetector({
    formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e']
  });
}

async function startScanner() {
  try {
    if (!detector) await initDetector();

    var stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      }
    });

    videoStream = stream;
    video.srcObject = stream;
    video.style.display = 'block';
    splashImage.style.display = 'none';
    scanIndicator.classList.remove('hidden');
    scanPulse.classList.remove('warn');

    var track = stream.getVideoTracks()[0];
    var caps = track.getCapabilities ? track.getCapabilities() : {};
    if (caps.focusMode && caps.focusMode.indexOf('continuous') >= 0) {
      try {
        await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      } catch (e) {}
    }

    scanning = true;
    lastDetectAttempt = Date.now();
    scanBtn.textContent = 'Stop Scanner';
    startWatchdog();
    scanLoop();
  } catch (err) {
    statusLine1.innerHTML = '<span class="error">Camera: ' + err.message + '</span>';
    console.error('Scanner start error:', err);
  }
}

function scanLoop() {
  if (!scanning || video.readyState < 2) {
    if (scanning) requestAnimationFrame(scanLoop);
    return;
  }

  lastDetectAttempt = Date.now();

  detector.detect(video).then(function (barcodes) {
    if (barcodes.length > 0 && scanning) {
      var code = barcodes[0].rawValue;
      var now = Date.now();
      if (code !== lastCode || (now - lastTime) > 3000) {
        lastCode = code;
        lastTime = now;
        scanning = false;
        handleScan(code);
        return;
      }
    }
    if (scanning) requestAnimationFrame(scanLoop);
  }).catch(function () {
    if (scanning) requestAnimationFrame(scanLoop);
  });
}

function stopScanner() {
  scanning = false;
  stopWatchdog();
  if (videoStream) {
    videoStream.getTracks().forEach(function (t) { t.stop(); });
    videoStream = null;
  }
  video.srcObject = null;
  video.style.display = 'none';
  splashImage.style.display = 'flex';
  scanIndicator.classList.add('hidden');
  scanBtn.textContent = 'Start Scanner';
}

async function restartScanner() {
  stopScanner();
  // Brief pause to let camera release
  setTimeout(function () { startScanner(); }, 300);
}

function startWatchdog() {
  stopWatchdog();
  watchdogInterval = setInterval(function () {
    if (!scanning) return;
    var elapsed = Date.now() - lastDetectAttempt;
    if (elapsed > WATCHDOG_RESTART_MS) {
      console.warn('Watchdog: scanner stalled, restarting');
      restartScanner();
    } else if (elapsed > WATCHDOG_STALL_MS) {
      scanPulse.classList.add('warn');
    } else {
      scanPulse.classList.remove('warn');
    }
  }, 2000);
}

function stopWatchdog() {
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }
}

function handleScan(rawValue) {
  var album = lookupBarcode(rawValue);
  if (album) {
    hapticSuccess();
    addToHistory(rawValue, album);
    showResult(album, rawValue);
  } else {
    hapticNotFound();
    addToHistory(rawValue, null);
    showNotFound(rawValue);
  }
}

// ---- Manual barcode entry ----

function handleManualBarcode() {
  var val = barcodeInput.value.trim();
  if (!val) return;
  var album = lookupBarcode(val);
  if (album) {
    hapticSuccess();
    addToHistory(val, album);
    showResult(album, val);
  } else {
    hapticNotFound();
    addToHistory(val, null);
    showNotFound(val);
  }
  barcodeInput.value = '';
  barcodeInput.blur();
}

// ---- Text search ----

function handleSearch() {
  var query = searchInput.value.trim().toLowerCase();
  searchResults.innerHTML = '';

  if (query.length < 2 || !albumData || !albumData.albums) return;

  var results = [];
  var keys = Object.keys(albumData.albums);
  for (var i = 0; i < keys.length && results.length < 20; i++) {
    var a = albumData.albums[keys[i]];
    if (a.artist.toLowerCase().indexOf(query) >= 0 ||
        a.album.toLowerCase().indexOf(query) >= 0) {
      results.push({ barcode: keys[i], album: a });
    }
  }

  if (results.length === 0) {
    searchResults.innerHTML = '<div style="padding:8px 0;font-size:12px;color:var(--text-faint);text-align:center">No matches</div>';
    return;
  }

  var html = '';
  for (var j = 0; j < results.length; j++) {
    var r = results[j];
    var badge = getBadgeInfo(r.album.recommendation);
    var thumbHtml = r.album.thumb
      ? '<img class="search-item-thumb" src="data:image/jpeg;base64,' + r.album.thumb + '" alt="">'
      : '<div class="search-item-thumb search-item-thumb-empty"></div>';
    html += '<div class="search-item" data-barcode="' + r.barcode + '">' +
      thumbHtml +
      '<div class="search-item-text">' +
      '<div class="search-item-artist">' + escHtml(r.album.artist) + '</div>' +
      '<div class="search-item-album">' + escHtml(r.album.album) + '</div>' +
      '</div>' +
      '<span class="search-item-badge badge-' + badge.cls + '">' + badge.text + '</span>' +
      '</div>';
  }
  searchResults.innerHTML = html;
}

function escHtml(s) {
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ---- Scan history ----

var HISTORY_KEY = 'lyrec_history';
var HISTORY_MAX = 100;
var HISTORY_TTL = 86400000; // 24 hours

function getHistory() {
  try {
    var raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    var arr = JSON.parse(raw);
    var now = Date.now();
    return arr.filter(function (h) { return (now - h.ts) < HISTORY_TTL; });
  } catch (e) { return []; }
}

function saveHistory(arr) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(arr.slice(0, HISTORY_MAX)));
  } catch (e) {}
}

function addToHistory(barcode, album) {
  var arr = getHistory();
  var entry = {
    bc: normalizeBarcode(barcode),
    ts: Date.now()
  };
  if (album) {
    entry.artist = album.artist;
    entry.album = album.album;
    entry.rec = album.recommendation;
    if (album.thumb) entry.thumb = album.thumb;
  } else {
    entry.nf = true;
  }
  // Keep same barcode if multiple times -- remove old entries with same barcode
  arr = arr.filter(function (h) { return h.bc !== entry.bc; });
  arr.unshift(entry);
  saveHistory(arr);
  updateMenuHistorySub();
}

function updateMenuHistorySub() {
  var arr = getHistory();
  if (arr.length === 0) {
    menuHistorySub.textContent = 'No recent scans';
  } else if (arr.length === 1) {
    menuHistorySub.textContent = '1 scan in the last 24 hours';
  } else {
    menuHistorySub.textContent = arr.length + ' scans in the last 24 hours';
  }
}

function renderHistoryRecent() {
  var arr = getHistory();
  if (arr.length === 0) {
    historyRecent.innerHTML = '<div class="history-empty">No scans yet. Start scanning to build your history.</div>';
    return;
  }

  var html = '';
  for (var i = 0; i < arr.length; i++) {
    html += renderHistoryItem(arr[i]);
  }
  historyRecent.innerHTML = html;
}

function renderHistoryItem(h) {
  var timeStr = formatTime(h.ts);
  var thumbHtml;
  if (h.thumb) {
    thumbHtml = '<img class="history-item-thumb" src="data:image/jpeg;base64,' + h.thumb + '" alt="">';
  } else if (h.nf) {
    thumbHtml = '<div class="history-item-thumb history-item-thumb-empty">?</div>';
  } else {
    thumbHtml = '<div class="history-item-thumb history-item-thumb-empty"></div>';
  }

  if (h.nf) {
    return '<div class="history-item" data-barcode="' + h.bc + '">' +
      thumbHtml +
      '<div class="history-item-text">' +
      '<div class="history-item-artist">' + h.bc + '</div>' +
      '<div class="history-item-notfound">Not in library</div>' +
      '</div>' +
      '<span class="history-item-badge badge-nf">N/F</span>' +
      '<span class="history-item-time">' + timeStr + '</span>' +
      '</div>';
  }

  var badge = getBadgeInfo(h.rec || '');
  return '<div class="history-item" data-barcode="' + h.bc + '">' +
    thumbHtml +
    '<div class="history-item-text">' +
    '<div class="history-item-artist">' + escHtml(h.artist || '') + '</div>' +
    '<div class="history-item-album">' + escHtml(h.album || '') + '</div>' +
    '</div>' +
    '<span class="history-item-badge badge-' + badge.cls + '">' + badge.text + '</span>' +
    '<span class="history-item-time">' + timeStr + '</span>' +
    '</div>';
}

function renderHistorySummary() {
  var arr = getHistory();
  if (arr.length === 0) {
    historySummary.innerHTML = '<div class="history-empty">No scans yet.</div>';
    return;
  }

  // Group by recommendation
  var groups = { buy: [], consider: [], upgrade: [], wait: [], skip: [], nf: [] };
  var groupOrder = [
    { key: 'buy', label: 'Buy', cls: 'buy' },
    { key: 'consider', label: 'Consider', cls: 'consider' },
    { key: 'upgrade', label: 'Upgrade', cls: 'upgrade' },
    { key: 'wait', label: 'Wait', cls: 'wait' },
    { key: 'skip', label: 'Skip', cls: 'skip' },
    { key: 'nf', label: 'Not in library', cls: 'nf' }
  ];

  for (var i = 0; i < arr.length; i++) {
    var h = arr[i];
    if (h.nf) {
      groups.nf.push(h);
    } else {
      var b = getBadgeInfo(h.rec || '');
      if (groups[b.cls]) groups[b.cls].push(h);
    }
  }

  var html = '';
  for (var g = 0; g < groupOrder.length; g++) {
    var grp = groupOrder[g];
    var items = groups[grp.key];
    if (items.length === 0) continue;

    html += '<div class="summary-group">' +
      '<div class="summary-group-header">' +
      '<span class="summary-group-badge badge-' + grp.cls + '">' + grp.label + '</span>' +
      '<span class="summary-group-count">' + items.length + '</span>' +
      '</div>';
    for (var k = 0; k < items.length; k++) {
      html += renderHistoryItem(items[k]);
    }
    html += '</div>';
  }

  historySummary.innerHTML = html;
}

function formatTime(ts) {
  var d = new Date(ts);
  var h = d.getHours();
  var m = d.getMinutes();
  var ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return h + ':' + (m < 10 ? '0' : '') + m + ampm;
}

// ---- Result display ----

function getBadgeInfo(recommendation) {
  var r = (recommendation || '').toLowerCase();
  if (r.indexOf('do not buy') === 0) return { text: 'Skip', cls: 'skip' };
  if (r.indexOf('wait') === 0) return { text: 'Wait', cls: 'wait' };
  if (r.indexOf('upgrade') === 0) return { text: 'Upgrade', cls: 'upgrade' };
  if (r.indexOf('consider') === 0) return { text: 'Consider', cls: 'consider' };
  if (r.indexOf('buy') === 0) return { text: 'Buy', cls: 'buy' };
  return { text: '?', cls: 'consider' };
}

function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function getTrackText(album) {
  if (album.have && album.want) {
    return album.have + ' of ' + album.want + ' tracks';
  }
  if (album.track_count) {
    return album.track_count + ' tracks';
  }
  return '--';
}

function showResult(album, barcode) {
  if (album.thumb) {
    resultThumb.src = 'data:image/jpeg;base64,' + album.thumb;
    resultThumb.classList.add('visible');
  } else {
    resultThumb.src = '';
    resultThumb.classList.remove('visible');
  }

  var badge = getBadgeInfo(album.recommendation);
  resultBadge.textContent = badge.text;
  resultBadge.className = 'result-badge ' + badge.cls;
  resultArtist.textContent = album.artist;
  resultAlbum.textContent = album.album;
  resultCompletion.textContent = capitalize(album.completion);
  resultTracks.textContent = getTrackText(album);
  resultFormat.textContent = album.format;
  resultEncoding.textContent = album.encoding;
  resultRecommendation.textContent = album.recommendation;
  resultBarcode.textContent = barcode;
  showOverlay(resultOverlay);
}

function showNotFound(barcode) {
  notfoundBarcode.textContent = barcode;
  showOverlay(notfoundOverlay);
}

function showOverlay(el) {
  el.classList.add('visible');
}

function hideOverlay(el) {
  el.classList.remove('visible');
}

function dismissResult() {
  hideOverlay(resultOverlay);
  hideOverlay(notfoundOverlay);
  resultThumb.classList.remove('visible');
  lastCode = '';
  lastTime = 0;
  if (videoStream) {
    scanning = true;
    lastDetectAttempt = Date.now();
    scanLoop();
  }
}

// ---- Menu & pages ----

function showMenu() {
  updateMenuHistorySub();
  showOverlay(menuOverlay);
}

function hideMenu() {
  hideOverlay(menuOverlay);
}

function showPage(pageEl) {
  hideMenu();
  // Delay briefly so menu starts hiding first
  setTimeout(function () {
    pageEl.classList.add('visible');
  }, 50);
}

function hidePage(pageEl) {
  pageEl.classList.remove('visible');
}

// ---- Swipe-to-dismiss ----

function attachSwipeDismiss(overlayEl, cardSelector, dismissFn, axis) {
  var card = overlayEl.querySelector(cardSelector);
  if (!card) return;

  var startY = 0, startX = 0;
  var currentY = 0, currentX = 0;
  var dragging = false;

  card.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) return;
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    currentY = 0;
    currentX = 0;
    dragging = true;
    card.classList.add('swiping');
  }, { passive: true });

  card.addEventListener('touchmove', function (e) {
    if (!dragging || e.touches.length !== 1) return;
    currentY = e.touches[0].clientY - startY;
    currentX = e.touches[0].clientX - startX;

    if (axis === 'x') {
      // Horizontal swipe (landscape result card flies out right)
      if (currentX > 0) {
        card.style.transform = 'translateX(' + currentX + 'px)';
      }
    } else {
      // Vertical swipe down
      if (currentY > 0) {
        card.style.transform = 'translateY(' + currentY + 'px)';
      }
    }
  }, { passive: true });

  card.addEventListener('touchend', function () {
    if (!dragging) return;
    dragging = false;
    card.classList.remove('swiping');
    var threshold = 100;
    if ((axis === 'x' && currentX > threshold) || (axis !== 'x' && currentY > threshold)) {
      dismissFn();
      // Reset after dismiss animation
      setTimeout(function () { card.style.transform = ''; }, 350);
    } else {
      card.style.transform = '';
    }
  });

  card.addEventListener('touchcancel', function () {
    dragging = false;
    card.classList.remove('swiping');
    card.style.transform = '';
  });
}

// ---- Event handlers ----

scanBtn.addEventListener('click', function () {
  if (scanning || videoStream) {
    stopScanner();
  } else {
    startScanner();
  }
});

restartCamBtn.addEventListener('click', function (e) {
  e.stopPropagation();
  restartScanner();
});

dismissBtn.addEventListener('click', dismissResult);
dismissNfBtn.addEventListener('click', dismissResult);

// Menu
menuBtn.addEventListener('click', showMenu);
menuClose.addEventListener('click', hideMenu);
menuOverlay.addEventListener('click', function (e) {
  if (e.target === menuOverlay) hideMenu();
});

// Menu items
document.querySelectorAll('.menu-item').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var page = btn.getAttribute('data-page');
    if (page === 'getting-started') showPage(gsPage);
    else if (page === 'history') {
      renderHistoryRecent();
      renderHistorySummary();
      showPage(historyPage);
    } else if (page === 'about') showPage(aboutPage);
  });
});

// Page back buttons
document.querySelectorAll('.page-back').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var target = btn.getAttribute('data-target');
    if (target === 'gs-page') hidePage(gsPage);
    else if (target === 'history-page') hidePage(historyPage);
    else if (target === 'about-page') hidePage(aboutPage);
  });
});

// History tabs
historyTabs.forEach(function (tab) {
  tab.addEventListener('click', function () {
    historyTabs.forEach(function (t) { t.classList.remove('active'); });
    tab.classList.add('active');
    var view = tab.getAttribute('data-view');
    if (view === 'recent') {
      historyRecent.classList.remove('hidden');
      historySummary.classList.add('hidden');
    } else {
      historyRecent.classList.add('hidden');
      historySummary.classList.remove('hidden');
    }
  });
});

// History clear
historyClearBtn.addEventListener('click', function () {
  if (confirm('Clear scan history?')) {
    localStorage.removeItem(HISTORY_KEY);
    renderHistoryRecent();
    renderHistorySummary();
    updateMenuHistorySub();
  }
});

// History item tap (both recent and summary)
function handleHistoryTap(e) {
  var item = e.target.closest('.history-item');
  if (!item) return;
  var bc = item.getAttribute('data-barcode');
  if (!bc) return;
  var album = lookupBarcode(bc);
  if (album) {
    showResult(album, bc);
  } else {
    showNotFound(bc);
  }
}
historyRecent.addEventListener('click', handleHistoryTap);
historySummary.addEventListener('click', handleHistoryTap);

// Manual barcode entry
barcodeGo.addEventListener('click', handleManualBarcode);
barcodeInput.addEventListener('keydown', function (e) {
  if (e.key === 'Enter') handleManualBarcode();
});

// Text search with debounce
searchInput.addEventListener('input', function () {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(handleSearch, 300);
});

// Search result tap
searchResults.addEventListener('click', function (e) {
  var item = e.target.closest('.search-item');
  if (!item) return;
  var bc = item.getAttribute('data-barcode');
  if (!bc) return;
  var album = lookupBarcode(bc);
  if (album) {
    addToHistory(bc, album);
    showResult(album, bc);
  }
  searchInput.value = '';
  searchInput.blur();
  searchResults.innerHTML = '';
});

// Close overlays on backdrop tap
resultOverlay.addEventListener('click', function (e) {
  if (e.target === resultOverlay) dismissResult();
});
notfoundOverlay.addEventListener('click', function (e) {
  if (e.target === notfoundOverlay) dismissResult();
});

// Swipe-to-dismiss -- direction depends on orientation
function getSwipeAxis() {
  return window.matchMedia('(orientation: landscape)').matches ? 'x' : 'y';
}

// Attach swipe handlers (re-attach on orientation change via simple approach)
function setupSwipe() {
  var axis = getSwipeAxis();
  attachSwipeDismiss(resultOverlay, '.overlay-card', dismissResult, axis);
  attachSwipeDismiss(notfoundOverlay, '.overlay-card', dismissResult, axis);
  attachSwipeDismiss(menuOverlay, '.sheet-card', hideMenu, 'y');
}
setupSwipe();

// ---- Service worker ----

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(function (err) {
    console.error('SW registration failed:', err);
  });
}

// ---- Init ----

loadData();
updateMenuHistorySub();
