(function () {
  'use strict';

  var albumData = null;
  var html5QrCode = null;
  var scannerRunning = false;
  var lastScannedCode = '';
  var lastScanTime = 0;

  var scanBtn = document.getElementById('scan-btn');
  var statusEl = document.getElementById('data-status');

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

  var scannerConfig = {
    fps: 2,
    qrbox: { width: 300, height: 120 },
    formatsToSupport: [
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E
    ]
  };

  function onScanSuccess(decodedText) {
    // Debounce: ignore same barcode within 3 seconds
    var now = Date.now();
    if (decodedText === lastScannedCode && (now - lastScanTime) < 3000) {
      return;
    }
    lastScannedCode = decodedText;
    lastScanTime = now;

    // Stop scanner fully, then show result
    scannerRunning = false;
    html5QrCode.stop().then(function () {
      handleScan(decodedText);
    }).catch(function () {
      handleScan(decodedText);
    });
  }

  function startScanner() {
    if (!html5QrCode) {
      html5QrCode = new Html5Qrcode('reader');
    }

    html5QrCode.start(
      { facingMode: 'environment' },
      scannerConfig,
      onScanSuccess
    ).then(function () {
      scannerRunning = true;
      scanBtn.textContent = 'Stop Scanner';
    }).catch(function (err) {
      statusEl.innerHTML = '<span class="error">Camera: ' + err + '</span>';
      console.error('Scanner start error:', err);
    });
  }

  function stopScanner() {
    scannerRunning = false;
    if (html5QrCode) {
      html5QrCode.stop().then(function () {
        scanBtn.textContent = 'Start Scanner';
      }).catch(function () {
        scanBtn.textContent = 'Start Scanner';
      });
    }
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
    // Clear debounce so the same barcode can be re-scanned
    lastScannedCode = '';
    lastScanTime = 0;
    // Full restart -- resume is unreliable on iOS Safari
    startScanner();
  }

  // ---- Event handlers ----

  scanBtn.addEventListener('click', function () {
    if (scannerRunning) {
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

})();
