(function () {
  'use strict';

  var albumData = null;
  var scanning = false;
  var detector = null;
  var videoStream = null;
  var scanInterval = null;

  var video = document.getElementById('video');
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

  // ---- Barcode detection ----

  function initDetector() {
    if (typeof BarcodeDetector === 'undefined') {
      return false;
    }
    try {
      detector = new BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e']
      });
      return true;
    } catch (e) {
      console.error('BarcodeDetector init failed:', e);
      return false;
    }
  }

  function normalizeBarcode(raw) {
    // Strip non-digits
    var digits = raw.replace(/\D/g, '');
    // If 13 digits starting with 0, also generate 12-digit UPC-A variant
    // (some sidecars store without leading zero)
    return digits;
  }

  function lookupBarcode(raw) {
    if (!albumData || !albumData.albums) return null;
    var code = normalizeBarcode(raw);
    // Direct lookup
    if (albumData.albums[code]) return albumData.albums[code];
    // Try adding leading zero (UPC-A 12 -> EAN-13 13)
    if (code.length === 12 && albumData.albums['0' + code]) {
      return albumData.albums['0' + code];
    }
    // Try removing leading zero (EAN-13 -> UPC-A)
    if (code.length === 13 && code[0] === '0' && albumData.albums[code.substring(1)]) {
      return albumData.albums[code.substring(1)];
    }
    return null;
  }

  // ---- Scanner ----

  function startScanner() {
    if (!initDetector()) {
      statusEl.innerHTML = '<span class="error">Barcode scanner not supported on this browser</span>';
      return;
    }

    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    })
    .then(function (stream) {
      videoStream = stream;
      video.srcObject = stream;
      video.classList.add('active');
      scanning = true;
      scanBtn.textContent = 'Stop Scanner';

      scanInterval = setInterval(function () {
        if (!scanning || video.readyState < 2) return;
        detector.detect(video)
          .then(function (barcodes) {
            if (barcodes.length > 0) {
              handleScan(barcodes[0].rawValue);
            }
          })
          .catch(function () {});
      }, 250);
    })
    .catch(function (err) {
      statusEl.innerHTML = '<span class="error">Camera access denied</span>';
      console.error('Camera error:', err);
    });
  }

  function stopScanner() {
    scanning = false;
    if (scanInterval) {
      clearInterval(scanInterval);
      scanInterval = null;
    }
    if (videoStream) {
      videoStream.getTracks().forEach(function (t) { t.stop(); });
      videoStream = null;
    }
    video.srcObject = null;
    video.classList.remove('active');
    scanBtn.textContent = 'Start Scanner';
  }

  function handleScan(rawValue) {
    // Pause scanning while showing result
    scanning = false;
    if (scanInterval) {
      clearInterval(scanInterval);
      scanInterval = null;
    }

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
    // Resume scanning
    if (videoStream) {
      scanning = true;
      scanInterval = setInterval(function () {
        if (!scanning || video.readyState < 2) return;
        detector.detect(video)
          .then(function (barcodes) {
            if (barcodes.length > 0) {
              handleScan(barcodes[0].rawValue);
            }
          })
          .catch(function () {});
      }, 250);
    }
  }

  // ---- Event handlers ----

  scanBtn.addEventListener('click', function () {
    if (videoStream) {
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
