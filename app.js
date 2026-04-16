import { BarcodeDetector } from 'https://cdn.jsdelivr.net/npm/barcode-detector@2/dist/es/pure.min.js';

// ============================================================
// lyrec v3.0 -- Lyra's Album Recommendations
// ============================================================

var albumData = null;
var detector = null;
var videoStream = null;
var scanning = false;
var lastCode = '';
var lastTime = 0;
var searchTimeout = null;

// ---- DOM refs ----

var video = document.getElementById('video');
var scanBtn = document.getElementById('scan-btn');
var statusEl = document.getElementById('data-status');
var splashImage = document.getElementById('splash-image');
var splashImg = document.getElementById('splash-img');

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

var helpBtn = document.getElementById('help-btn');
var helpOverlay = document.getElementById('help-overlay');
var helpDismiss = document.getElementById('help-dismiss');

var barcodeInput = document.getElementById('barcode-input');
var barcodeGo = document.getElementById('barcode-go');
var searchInput = document.getElementById('search-input');
var searchResults = document.getElementById('search-results');

var historySection = document.getElementById('history-section');
var historyList = document.getElementById('history-list');
var historyClear = document.getElementById('history-clear');

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
  statusEl.textContent = 'Loading...';
  fetch('data/store-check.json?t=' + Date.now())
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) {
      albumData = data;
      updateStatusBar();
      scanBtn.disabled = false;
    })
    .catch(function (err) {
      statusEl.innerHTML = '<span class="error">Failed to load data</span>';
      console.error('Data load error:', err);
    });
}

function updateStatusBar() {
  if (!albumData) return;
  var count = albumData.album_count || 0;
  var generated = albumData.generated || '';
  var ageText = getDataAge(generated);
  statusEl.innerHTML = count + ' albums &middot; ' + ageText;
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

    var track = stream.getVideoTracks()[0];
    var caps = track.getCapabilities ? track.getCapabilities() : {};
    if (caps.focusMode && caps.focusMode.indexOf('continuous') >= 0) {
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    }

    scanning = true;
    scanBtn.textContent = 'Stop Scanner';
    scanLoop();
  } catch (err) {
    statusEl.innerHTML = '<span class="error">Camera: ' + err.message + '</span>';
    console.error('Scanner start error:', err);
  }
}

function scanLoop() {
  if (!scanning || video.readyState < 2) {
    if (scanning) requestAnimationFrame(scanLoop);
    return;
  }

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
  if (videoStream) {
    videoStream.getTracks().forEach(function (t) { t.stop(); });
    videoStream = null;
  }
  video.srcObject = null;
  video.style.display = 'none';
  splashImage.style.display = 'flex';
  scanBtn.textContent = 'Start Scanner';
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
var HISTORY_MAX = 50;
var HISTORY_TTL = 86400000; // 24 hours

function getHistory() {
  try {
    var raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    var arr = JSON.parse(raw);
    var now = Date.now();
    // Prune old entries
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
  } else {
    entry.nf = true;
  }
  // Add to front, remove duplicates of same barcode
  arr = arr.filter(function (h) { return h.bc !== entry.bc; });
  arr.unshift(entry);
  saveHistory(arr);
  renderHistory();
}

function renderHistory() {
  var arr = getHistory();
  if (arr.length === 0) {
    historySection.classList.add('hidden');
    return;
  }
  historySection.classList.remove('hidden');

  var html = '';
  for (var i = 0; i < arr.length; i++) {
    var h = arr[i];
    var timeStr = formatTime(h.ts);

    if (h.nf) {
      html += '<div class="history-item" data-barcode="' + h.bc + '">' +
        '<div class="history-item-text">' +
        '<div class="history-item-notfound">Not found: ' + h.bc + '</div>' +
        '</div>' +
        '<span class="history-item-badge badge-nf">N/F</span>' +
        '<span class="history-item-time">' + timeStr + '</span>' +
        '</div>';
    } else {
      var badge = getBadgeInfo(h.rec || '');
      html += '<div class="history-item" data-barcode="' + h.bc + '">' +
        '<div class="history-item-text">' +
        '<div class="history-item-artist">' + escHtml(h.artist || '') + '</div>' +
        '<div class="history-item-album">' + escHtml(h.album || '') + '</div>' +
        '</div>' +
        '<span class="history-item-badge badge-' + badge.cls + '">' + badge.text + '</span>' +
        '<span class="history-item-time">' + timeStr + '</span>' +
        '</div>';
    }
  }
  historyList.innerHTML = html;
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
  // Thumbnail
  if (album.thumb) {
    resultThumb.src = 'data:image/jpeg;base64,' + album.thumb;
    resultThumb.style.display = 'block';
    resultThumb.style.marginLeft = 'auto';
    resultThumb.style.marginRight = 'auto';
  } else {
    resultThumb.src = '';
    resultThumb.style.display = 'none';
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
  resultThumb.style.display = 'none';
  resultThumb.src = '';
  lastCode = '';
  lastTime = 0;
  if (videoStream) {
    scanning = true;
    scanLoop();
  }
}

// ---- Help screen ----

function showHelp() {
  showOverlay(helpOverlay);
}

function hideHelp() {
  hideOverlay(helpOverlay);
}

// ---- Event handlers ----

scanBtn.addEventListener('click', function () {
  if (scanning || videoStream) {
    stopScanner();
  } else {
    startScanner();
  }
});

dismissBtn.addEventListener('click', dismissResult);
dismissNfBtn.addEventListener('click', dismissResult);

helpBtn.addEventListener('click', showHelp);
helpDismiss.addEventListener('click', hideHelp);
helpOverlay.addEventListener('click', function (e) {
  if (e.target === helpOverlay) hideHelp();
});

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
  searchResults.innerHTML = '';
});

// History item tap
historyList.addEventListener('click', function (e) {
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
});

// History clear
historyClear.addEventListener('click', function () {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
});

// Close overlays on backdrop tap
resultOverlay.addEventListener('click', function (e) {
  if (e.target === resultOverlay) dismissResult();
});
notfoundOverlay.addEventListener('click', function (e) {
  if (e.target === notfoundOverlay) dismissResult();
});

// ---- Service worker ----

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(function (err) {
    console.error('SW registration failed:', err);
  });
}

// ---- Init ----

loadData();
renderHistory();
