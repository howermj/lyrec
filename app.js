import { BarcodeDetector } from 'https://cdn.jsdelivr.net/npm/barcode-detector@2/dist/es/pure.min.js';

var albumData = null;
var detector = null;
var videoStream = null;
var scanTimer = null;
var scanning = false;
var lastCode = '';
var lastTime = 0;

var video = document.getElementById('video');
var scanBtn = document.getElementById('scan-btn');
var statusEl = document.getElementById('data-status');
var splashImage = document.getElementById('splash-image');
var splashImg = document.getElementById('splash-img');

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

var resultContainer = document.getElementById('result-container');
var resultBadge = document.getElementById('result-badge');
var resultArtist = document.getElementById('result-artist');
var resultAlbum = document.getElementById('result-album');
var resultCompletion = document.getElementById('result-completion');
var resultFormat = document.getElementById('result-format');
var resultEncoding = document.getElementById('result-encoding');
var resultRecommendation = document.getElementById('result-recommendation');
var resultBarcode = document.getElementById('result-barcode');
var dismissBtn = document.getElementById('dismiss-btn');

var notFoundContainer = document.getElementById('not-found-container');
var notFoundBarcode = document.getElementById('not-found-barcode');
var dismissNfBtn = document.getElementById('dismiss-nf-btn');

// ---- Data loading ----

function loadData() {
  statusEl.textContent = 'Loading album data...';
  fetch('data/store-check.json?t=' + Date.now())
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) {
      albumData = data;
      var generated = data.generated || '';
      var date = generated.substring(0, 10);
      statusEl.innerHTML = '<span class="ready">' + data.album_count +
        ' albums indexed</span> &middot; ' + date;
      scanBtn.disabled = false;
    })
    .catch(function (err) {
      statusEl.innerHTML = '<span class="error">Failed to load data</span>';
      console.error('Data load error:', err);
    });
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

    // Request continuous autofocus if supported
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
      // Debounce same code within 3 seconds
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
    showResult(album, rawValue);
  } else {
    showNotFound(rawValue);
  }
}

// ---- Result display ----

function getBadgeInfo(recommendation) {
  var r = recommendation.toLowerCase();
  if (r.indexOf('do not buy') === 0) return { text: 'Skip', cls: 'skip' };
  if (r.indexOf('wait') === 0) return { text: 'Wait', cls: 'wait' };
  if (r.indexOf('upgrade') === 0) return { text: 'Upgrade', cls: 'upgrade' };
  if (r.indexOf('consider') === 0) return { text: 'Consider', cls: 'consider' };
  if (r.indexOf('buy') === 0) return { text: 'Buy', cls: 'buy' };
  return { text: 'Unknown', cls: 'consider' };
}

function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function showResult(album, barcode) {
  var badge = getBadgeInfo(album.recommendation);
  resultBadge.textContent = badge.text;
  resultBadge.className = badge.cls;
  resultArtist.textContent = album.artist;
  resultAlbum.textContent = album.album;
  resultCompletion.textContent = capitalize(album.completion);
  resultFormat.textContent = album.format;
  resultEncoding.textContent = album.encoding;
  resultRecommendation.textContent = album.recommendation;
  resultBarcode.textContent = barcode;
  resultContainer.classList.remove('hidden');
}

function showNotFound(barcode) {
  notFoundBarcode.textContent = barcode;
  notFoundContainer.classList.remove('hidden');
}

function dismissResult() {
  resultContainer.classList.add('hidden');
  notFoundContainer.classList.add('hidden');
  lastCode = '';
  lastTime = 0;
  // Camera is still running, just resume the scan loop
  scanning = true;
  scanLoop();
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

// ---- Service worker ----

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(function (err) {
    console.error('SW registration failed:', err);
  });
}

// ---- Init ----

loadData();
