var book = ePub();
var rendition;
var displayed;
var chapters = []
var FONT_FACE_CSS = ""; // This will hold our dynamically generated font CSS
var spineSectionTotals = {};
var bookWidePageTotal = 0;
// True while the measurement sweep is navigating every section. While set, the
// relocate handler stays silent so the host UI does not flash through pages.
var paginating = false;
// Base64-encoded cached `book.locations` JSON, supplied via loadBook so repeat
// opens skip the expensive generation pass.
var savedLocationsB64 = "";
// Tracks slider / programmatic jumps so intermediate or regressive `relocated`
// events from the continuous manager are not forwarded to Flutter.
var programmaticNav = null; // { targetIndex: number (0-based), startedAt: number }
var navSettlePage = 0;
var navSettleUntil = 0;
var navGeneration = 0;
// Progress navigation requested before book.locations is ready (e.g. bookmark fallback).
var pendingProgressNav = null;

function resetBookPaginationState() {
  spineSectionTotals = {};
  bookWidePageTotal = 0;
  paginating = false;
  programmaticNav = null;
  navSettlePage = 0;
  navSettleUntil = 0;
  pendingProgressNav = null;
}

// Decodes base64 produced by Dart's base64Encode(utf8.encode(...)).
function b64ToString(b64) {
  if (!b64) {
    return "";
  }
  try {
    return decodeURIComponent(escape(atob(b64)));
  } catch (e) {
    return atob(b64);
  }
}

// True once every linear section has a measured page count, meaning the
// book-wide page/total reported to the host are exact (stable total, correct
// jumps, +1 per page) rather than an extrapolated estimate.
function isPaginationComplete() {
  var spineLength = book.spine && book.spine.spineItems ? book.spine.spineItems.length : 0;
  if (spineLength <= 0) {
    return false;
  }
  var knownCount = 0;
  for (var key in spineSectionTotals) {
    if (Object.prototype.hasOwnProperty.call(spineSectionTotals, key)) {
      knownCount++;
    }
  }
  return knownCount >= spineLength;
}

function computeBookWidePagination(location) {
  var start = location && location.start;
  var displayedPage = null;
  var displayedTotal = null;

  if (!start || !start.displayed) {
    return { displayedPage: displayedPage, displayedTotal: displayedTotal };
  }

  var spineIndex = start.index != null ? start.index : 0;
  var sectionPage = start.displayed.page || 1;
  var sectionTotal = start.displayed.total || 0;

  if (sectionTotal > 0) {
    spineSectionTotals[spineIndex] = sectionTotal;
  }

  var offset = 0;
  for (var i = 0; i < spineIndex; i++) {
    offset += spineSectionTotals[i] || 0;
  }
  displayedPage = offset + sectionPage;

  var sumKnown = 0;
  var knownCount = 0;
  for (var key in spineSectionTotals) {
    if (Object.prototype.hasOwnProperty.call(spineSectionTotals, key)) {
      sumKnown += spineSectionTotals[key];
      knownCount++;
    }
  }

  var spineLength = book.spine && book.spine.spineItems ? book.spine.spineItems.length : 0;
  var estimatedTotal = 0;

  if (spineLength > 0 && knownCount >= spineLength) {
    estimatedTotal = sumKnown;
  } else if (knownCount > 0 && spineLength > 0) {
    var averageSectionPages = sumKnown / knownCount;
    estimatedTotal = Math.ceil(sumKnown + averageSectionPages * (spineLength - knownCount));
  }

  if (estimatedTotal > bookWidePageTotal) {
    bookWidePageTotal = estimatedTotal;
  }

  if (bookWidePageTotal > 0) {
    displayedTotal = bookWidePageTotal;
  } else if (sectionTotal > 0) {
    displayedTotal = sectionTotal;
  }

  if (displayedPage == null && start.location != null) {
    displayedPage = start.location + 1;
  }

  return {
    displayedPage: displayedPage,
    displayedTotal: displayedTotal,
    paginationReady: isPaginationComplete(),
  };
}

// Sweeps every linear section once, displaying it so epub.js reports that
// section's rendered page count. Populating the full per-section map makes the
// book-wide page number exact: the total is stable, slider jumps land on the
// right page, and each swipe advances by exactly one. Runs behind the host's
// loading overlay; the relocate handler is muted via `paginating` so the user
// never sees the sweep. Result is pushed to the host for caching so this only
// happens once per book + layout.
// Logs the active layout so we can tell whether `displayed.total` is being
// reported in spread (2-up) columns vs single pages.
function logPaginationLayout() {
  try {
    var settings = rendition && rendition.settings ? rendition.settings : {};
    var layout = rendition && rendition.manager && rendition.manager.layout ? rendition.manager.layout : {};
    console.log("EPUB_PAGINATION layout", JSON.stringify({
      manager: settings.manager,
      flow: settings.flow,
      spread: settings.spread,
      axis: settings.axis,
      direction: settings.direction,
      layoutName: layout.name,
      layoutSpread: layout.spread,
      divisor: layout.divisor,
      pageWidth: layout.pageWidth,
      width: layout.width,
      delta: layout.delta,
      columnWidth: layout.columnWidth,
    }));
  } catch (e) {
    console.log("EPUB_PAGINATION layout log failed", e);
  }
}

function precomputeVisualPages() {
  if (paginating || !rendition) {
    console.log("EPUB_PAGINATION sweep skipped (paginating or no rendition)", paginating, !!rendition);
    return;
  }

  var startCfi = rendition.location && rendition.location.start ? rendition.location.start.cfi : null;
  var items = book.spine && book.spine.spineItems ? book.spine.spineItems : [];
  var linearCount = 0;
  for (var c = 0; c < items.length; c++) {
    if (items[c] && items[c].linear !== false && items[c].linear !== 'no') {
      linearCount++;
    }
  }
  var index = 0;
  paginating = true;

  console.log("EPUB_PAGINATION sweep start", JSON.stringify({
    spineItems: items.length,
    linearSections: linearCount,
    startCfi: startCfi,
    locationsTotal: book.locations ? book.locations.total : null,
  }));
  logPaginationLayout();

  function finish() {
    var sum = 0;
    var measuredCount = 0;
    for (var key in spineSectionTotals) {
      if (Object.prototype.hasOwnProperty.call(spineSectionTotals, key)) {
        sum += spineSectionTotals[key];
        measuredCount++;
      }
    }
    if (sum > 0) {
      bookWidePageTotal = sum;
    }

    console.log("EPUB_PAGINATION sweep done", JSON.stringify({
      measuredSections: measuredCount,
      linearSections: linearCount,
      renderedTotal: bookWidePageTotal,
      locationsTotal: book.locations ? book.locations.total : null,
      ratioRenderedToLocations: book.locations && book.locations.total > 0
        ? (bookWidePageTotal / book.locations.total).toFixed(2)
        : null,
      sectionTotals: spineSectionTotals,
    }));

    var restore = startCfi ? rendition.display(startCfi) : rendition.display();
    var report = function () {
      paginating = false;
      window.flutter_inappwebview.callHandler('visualPaginationReady', {
        sectionTotals: spineSectionTotals,
        total: bookWidePageTotal,
      });
      if (rendition && rendition.location) {
        window.flutter_inappwebview.callHandler('relocated', buildLocationPayload(rendition.location));
      }
    };
    restore.then(report).catch(report);
  }

  function step() {
    if (index >= items.length) {
      finish();
      return;
    }
    var section = items[index];
    index++;
    if (!section || section.linear === false || section.linear === 'no') {
      step();
      return;
    }
    rendition.display(section.href).then(function () {
      var loc = rendition.location;
      var total = loc && loc.start && loc.start.displayed ? loc.start.displayed.total : 0;
      var page = loc && loc.start && loc.start.displayed ? loc.start.displayed.page : null;
      var idx = loc && loc.start && loc.start.index != null ? loc.start.index : section.index;
      var visibleCount = loc && loc.length != null ? loc.length : null;
      if (total > 0) {
        spineSectionTotals[idx] = total;
      }
      console.log("EPUB_PAGINATION section", JSON.stringify({
        requestedHref: section.href,
        requestedIndex: section.index,
        landedIndex: idx,
        displayedPage: page,
        displayedTotal: total,
        visibleViews: visibleCount,
      }));
      step();
    }).catch(function (e) {
      console.log("EPUB_PAGINATION section failed", section.href, e);
      step();
    });
  }

  step();
}

// Restores a previously measured per-section page map (base64 JSON from the
// host cache) so a fresh open is exact immediately, skipping the sweep.
function applyVisualPagination(b64) {
  try {
    var parsed = JSON.parse(b64ToString(b64));
    var totals = parsed && parsed.sectionTotals ? parsed.sectionTotals : parsed;
    if (!totals) {
      return;
    }
    spineSectionTotals = {};
    var sum = 0;
    for (var key in totals) {
      if (Object.prototype.hasOwnProperty.call(totals, key)) {
        var value = totals[key] | 0;
        if (value > 0) {
          spineSectionTotals[key] = value;
          sum += value;
        }
      }
    }
    bookWidePageTotal = parsed && parsed.total > 0 ? parsed.total : sum;
    console.log("EPUB_PAGINATION cache applied", JSON.stringify({
      cachedTotal: parsed ? parsed.total : null,
      summedTotal: sum,
      appliedTotal: bookWidePageTotal,
      locationsTotal: book.locations ? book.locations.total : null,
      sectionCount: Object.keys(spineSectionTotals).length,
    }));
    if (rendition && rendition.location) {
      window.flutter_inappwebview.callHandler('relocated', buildLocationPayload(rendition.location));
    }
  } catch (e) {
    console.error("applyVisualPagination failed", e);
  }
}

function base64ToUint8Array(base64) {
  var binary = atob(base64);
  var len = binary.length;
  var bytes = new Uint8Array(len);
  for (var i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function prepareFonts(fontJson) {
  if (!fontJson) {
    return;
  }

  try {
    const fontMap = JSON.parse(fontJson);
    var cssString = "";
    for (const fontFamily in fontMap) {
      if (fontMap.hasOwnProperty(fontFamily)) {
        const base64 = fontMap[fontFamily];
        const format = (fontFamily === 'Open Dyslexic') ? 'opentype' : 'truetype';
        const mime = (fontFamily === 'Open Dyslexic') ? 'font/otf' : 'font/ttf';

        cssString += `
          @font-face {
              font-family: "${fontFamily}";
              src: url(data:${mime};base64,${base64}) format("${format}");
          }
        `;
      }
    }
    FONT_FACE_CSS = cssString;
    console.log("Custom font faces have been prepared.");
  } catch (e) {
    console.error("Failed to parse font JSON", e);
  }
}

function scheduleLocationGeneration() {
  setTimeout(function () {
    var loadedFromCache = false;
    book.ready.then(function () {
      if (book.locations && book.locations.total > 0) {
        return book.locations;
      }
      if (savedLocationsB64) {
        try {
          var arr = JSON.parse(b64ToString(savedLocationsB64));
          if (arr && arr.length) {
            book.locations.load(arr);
            loadedFromCache = true;
            return book.locations;
          }
        } catch (e) {
          console.error("locations.load failed, regenerating", e);
        }
      }
      return book.locations.generate(1600);
    }).then(function () {
      var totalPages = book.locations.total;
      console.log("Locations ready. Total pages:", totalPages, "fromCache:", loadedFromCache);
      window.flutter_inappwebview.callHandler('epubPageCount', totalPages);
      if (!loadedFromCache) {
        try {
          window.flutter_inappwebview.callHandler('locationsReady', book.locations.save());
        } catch (e) {
          console.error("locations.save failed", e);
        }
      }
      if (pendingProgressNav != null) {
        var queued = pendingProgressNav;
        pendingProgressNav = null;
        console.log("Replaying queued toProgress:", queued);
        toProgress(queued);
      }
    });
  }, 50);
}

function loadBook(data, cfi, manager, flow, spread, snap, allowScriptedContent, direction, useCustomSwipe, backgroundColor, foregroundColor, locationsCacheB64) {
  resetBookPaginationState();
  savedLocationsB64 = locationsCacheB64 || "";

  var viewportHeight = window.innerHeight;
  document.getElementById('viewer').style.height = viewportHeight;
  var uint8Array = typeof data === 'string' ? base64ToUint8Array(data) : new Uint8Array(data);
  book.open(uint8Array,)
  rendition = book.renderTo("viewer", {
    manager: manager,
    flow: flow,
    spread: spread,
    width: "100vw",
    height: "100vh",
    snap: snap && !useCustomSwipe,
    allowScriptedContent: allowScriptedContent,
    defaultDirection: direction
  });

  if (cfi) {
    displayed = rendition.display(cfi)
  } else {
    displayed = rendition.display()
  }

  displayed.then(function (renderer) {
    console.log("displayed")
    window.flutter_inappwebview.callHandler('displayed');
    scheduleLocationGeneration();
  });

  book.loaded.navigation.then(function (toc) {
    chapters = parseChapters(toc)
    window.flutter_inappwebview.callHandler('chapters');
  })

  rendition.on("rendered", function () {
    window.flutter_inappwebview.callHandler('rendered');
  })

  rendition.on("selected", function (cfiRange, contents) {
    book.getRange(cfiRange).then(function (range) {
      var selectedText = range.toString();
      var args = [cfiRange.toString(), selectedText]
      window.flutter_inappwebview.callHandler('selection', ...args);
    })
  });

  rendition.on("relocated", function (location) {
    // Stay silent while the measurement sweep flips through sections so the
    // host UI is not flooded with transient positions.
    if (paginating) {
      return;
    }
    var payload = buildLocationPayload(location);
    if (shouldSuppressRelocated(payload)) {
      return;
    }
    console.log("EPUB_PAGINATION relocated", JSON.stringify({
      progress: payload.progress,
      displayedPage: payload.displayedPage,
      displayedTotal: payload.displayedTotal,
      locationPage: payload.locationPage,
      absoluteTotalPages: payload.absoluteTotalPages,
      paginationReady: payload.paginationReady,
      atStart: payload.atStart,
      atEnd: payload.atEnd,
    }));
    window.flutter_inappwebview.callHandler('relocated', payload);
  });

  rendition.on('displayError', function (e) {
    console.log("displayError")
    window.flutter_inappwebview.callHandler('displayError');
  })

  rendition.on('markClicked', function (cfiRange) {
    console.log("markClicked")
    var args = [cfiRange.toString()]
    window.flutter_inappwebview.callHandler('markClicked', ...args);
  })

  // This is the single, correct hook that uses the FONT_FACE_CSS variable.
  rendition.hooks.content.register((contents) => {
    var head = contents.document.head;
    var style = contents.document.createElement("style");
    style.id = "custom-font-faces";
    style.innerHTML = FONT_FACE_CSS;
    head.appendChild(style);

     if(useCustomSwipe){
      const el = contents.document.documentElement;

      if (el) {
        // console.log('EPUB_TEST_HOOK_IF')
        detectSwipe(el, function(el,direction){
          // console.log("EPUB_TEST_DIR"+direction.toString())

            if(direction == 'l'){
              rendition.next()
            }
            if(direction== 'r'){
              rendition.prev()
            }
          });
      }
    }
    });

  updateTheme(backgroundColor, foregroundColor);
}

window.addEventListener("flutterInAppWebViewPlatformReady", function (event) {
  window.flutter_inappwebview.callHandler('readyToLoad');
});

function next() {
  rendition.next()
}

function previous() {
  rendition.prev()
}

function cfiDisplayTarget(cfi) {
  if (!cfi) {
    return null;
  }
  // Bookmark ranges are stored as start,end pairs; rendition.display needs a point CFI.
  if (cfi.indexOf(",") > cfi.indexOf("!")) {
    try {
      var parsed = new ePub.CFI(cfi);
      if (parsed.range) {
        return parsed.collapse(true).toString();
      }
    } catch (e) {
      console.warn("cfiDisplayTarget failed", e);
    }
  }
  return cfi;
}

function toCfi(cfi) {
  var target = cfiDisplayTarget(cfi);
  if (!target) {
    return;
  }
  if (book.locations && book.locations.total > 0) {
    try {
      var loc = book.locations.locationFromCfi(target);
      if (loc >= 0) {
        beginProgrammaticNav(loc);
      }
    } catch (e) {
      console.warn("toCfi locationFromCfi failed", e);
    }
  }
  rendition.display(target);
}

function getChapters() {
  return chapters;
}

async function getBookInfo() {
  const metadata = book.package.metadata;
  metadata['coverImage'] = book.cover;
  console.log("getBookInfo", await book.coverUrl());
  return metadata;
}

function beginProgrammaticNav(targetIndex) {
  navGeneration++;
  programmaticNav = {
    generation: navGeneration,
    targetIndex: targetIndex,
    startedAt: Date.now(),
  };
}

function shouldSuppressRelocated(payload) {
  var locationPage = payload.locationPage || 0;
  var now = Date.now();

  if (programmaticNav) {
    var targetPage = programmaticNav.targetIndex + 1;
    var age = now - programmaticNav.startedAt;
    if (locationPage > 0 && Math.abs(locationPage - targetPage) <= 3) {
      programmaticNav = null;
      navSettlePage = locationPage;
      navSettleUntil = now + 2000;
      return false;
    }
    if (age > 4000) {
      programmaticNav = null;
      return false;
    }
    console.log("EPUB_PAGINATION suppressed in-flight relocate", JSON.stringify({
      locationPage: locationPage,
      targetPage: targetPage,
      ageMs: age,
    }));
    return true;
  }

  if (navSettleUntil && now < navSettleUntil) {
    if (locationPage > 0 && locationPage < navSettlePage - 3) {
      console.log("EPUB_PAGINATION suppressed stale relocate", JSON.stringify({
        locationPage: locationPage,
        anchorPage: navSettlePage,
      }));
      return true;
    }
    return false;
  }

  navSettlePage = 0;
  navSettleUntil = 0;
  return false;
}

function buildLocationPayload(location) {
  var start = location && location.start;
  var percent = start && start.percentage != null ? start.percentage : 0;
  var pagination = computeBookWidePagination(location);
  var absoluteTotalPages = book.locations && book.locations.total > 0 ? book.locations.total : 0;
  var locationPage = start && start.location != null ? start.location + 1 : null;
  var hasRenderedPagination = pagination.displayedPage != null && pagination.displayedPage > 0;
  return {
    startCfi: start ? start.cfi : "",
    endCfi: location.end ? location.end.cfi : "",
    href: start && start.href ? start.href : "",
    progress: percent,
    totalPages: absoluteTotalPages,
    absoluteTotalPages: absoluteTotalPages,
    locationPage: locationPage,
    displayedPage: pagination.displayedPage,
    displayedTotal: pagination.displayedTotal,
    hasRenderedPagination: hasRenderedPagination,
    paginationReady: pagination.paginationReady === true,
    atEnd: !!(location && location.atEnd),
    atStart: !!(location && location.atStart),
  };
}

function getCurrentLocation() {
  return buildLocationPayload(rendition.location);
}

var parseChapters = function (toc) {
  var chapters = []
  toc.forEach(function (chapter) {
    chapters.push({
      title: chapter.label,
      href: chapter.href,
      id: chapter.id,
      subitems: parseChapters(chapter.subitems)
    })
  })
  return chapters;
}

function searchInBook(query) {
  search(query).then(function (data) {
    var args = [data]
    window.flutter_inappwebview.callHandler('search', ...args);
  })
}

function addHighlight(cfiRange, color, opacity) {
  rendition.annotations.highlight(cfiRange, {}, (e) => {}, "hl", { "fill": color, "fill-opacity": '0.3', "mix-blend-mode": "multiply" });
}

function addUnderLine(cfiString) {
  rendition.annotations.underline(cfiString)
}

function addMark(cfiString) {
  rendition.annotations.mark(cfiString)
}

function removeHighlight(cfiString) {
  rendition.annotations.remove(cfiString, "highlight");
}

function removeUnderLine(cfiString) {
  rendition.annotations.remove(cfiString, "underline");
}

function removeMark(cfiString) {
  rendition.annotations.remove(cfiString, "mark");
}

function toProgress(progress) {
  if (!book.locations || book.locations.total <= 0) {
    pendingProgressNav = progress;
    console.log("toProgress queued until locations ready:", progress);
    return;
  }
  pendingProgressNav = null;
  var index = Math.max(
    0,
    Math.min(
      Math.round(progress * (book.locations.total - 1)),
      book.locations.total - 1
    )
  );
  beginProgrammaticNav(index);
  var cfi = book.locations.cfiFromPercentage(progress);
  if (cfi) {
    rendition.display(cfi);
  }
}

function toLocationPage(page) {
  if (!book.locations || book.locations.total <= 0) {
    var total = page > 1 ? page : 2;
    toProgress((page - 1) / (total - 1));
    return;
  }
  var index = Math.max(0, Math.min(page - 1, book.locations.total - 1));
  var cfi = book.locations.cfiFromLocation(index);
  if (cfi) {
    beginProgrammaticNav(index);
    rendition.display(cfi);
  }
}

function search(q) {
  return Promise.all(
    book.spine.spineItems.map(item => item.load(book.load.bind(book)).then(item.find.bind(item, q)).finally(item.unload.bind(item)))
  ).then(results => Promise.resolve([].concat.apply([], results)));
};

function applyReaderStyles(fontFamily, fontSize) {
  console.log(`Applying styles: Family=${fontFamily}, Size=${fontSize}px`);
  if (rendition) {
    rendition.themes.override("font-family", fontFamily, true); // true for !important
    rendition.themes.override("font-size", `${fontSize}px`, true); // true for !important
    console.log("Custom styles applied via override.");
  } else {
    console.log("Error: Rendition object not found.");
  }
}

function setSpread(spread) {
  rendition.spread(spread);
}

function setFlow(flow) {
  rendition.flow(flow);
}

function setManager(manager) {
  rendition.manager(manager);
}

// Only one setFontSize function is needed.
function setFontSize(fontSize) {
  rendition.themes.fontSize(`${fontSize}px`);
}

function getCurrentPageText() {
  var startCfi = rendition.location.start.cfi
  var endCfi = rendition.location.end.cfi
  var cfiRange = makeRangeCfi(startCfi, endCfi)
  book.getRange(cfiRange).then(function (range) {
    var text = range.toString();
    var args = [text, cfiRange]
    window.flutter_inappwebview.callHandler('epubText', ...args);
  })
}

function getTextFromCfi(startCfi, endCfi) {
  var cfiRange = makeRangeCfi(startCfi, endCfi)
  book.getRange(cfiRange).then(function (range) {
    var text = range.toString();
    var args = [text, cfiRange]
    window.flutter_inappwebview.callHandler('epubText', ...args);
  })
}

function updateTheme(backgroundColor, foregroundColor) {
  if (backgroundColor && foregroundColor) {
    rendition.themes.register("dark", { "body": { "background": backgroundColor, "color": foregroundColor } });
    rendition.themes.select("dark");
  }
}

const makeRangeCfi = (a, b) => {
  const CFI = new ePub.CFI()
  const start = CFI.parse(a), end = CFI.parse(b)
  const cfi = {
    range: true,
    base: start.base,
    path: { steps: [], terminal: null },
    start: start.path,
    end: end.path
  }
  const len = cfi.start.steps.length
  for (let i = 0; i < len; i++) {
    if (CFI.equalStep(cfi.start.steps[i], cfi.end.steps[i])) {
      if (i == len - 1) {
        if (cfi.start.terminal === cfi.end.terminal) {
          cfi.path.steps.push(cfi.start.steps[i])
          cfi.range = false
        }
      } else cfi.path.steps.push(cfi.start.steps[i])
    } else break
  }
  cfi.start.steps = cfi.start.steps.slice(cfi.path.steps.length)
  cfi.end.steps = cfi.end.steps.slice(cfi.path.steps.length)

  return 'epubcfi(' + CFI.segmentString(cfi.base)
    + '!' + CFI.segmentString(cfi.path)
    + ',' + CFI.segmentString(cfi.start)
    + ',' + CFI.segmentString(cfi.end)
    + ')'
}

function detectSwipe(el,func) {
  swipe_det = new Object();
  swipe_det.sX = 0;
  swipe_det.sY = 0;
  swipe_det.eX = 0;
  swipe_det.eY = 0;
  var min_x = 50;  //min x swipe for horizontal swipe
  var max_x = 40;  //max x difference for vertical swipe
  var min_y = 40;  //min y swipe for vertical swipe
  var max_y = 50;  //max y difference for horizontal swipe
  var direc = "";
  ele = el
  ele.addEventListener('touchstart',function(e){
    var t = e.touches[0];
    swipe_det.sX = t.screenX; 
    swipe_det.sY = t.screenY;
  },false);
  ele.addEventListener('touchmove',function(e){
//    e.preventDefault();
    var t = e.touches[0];
    swipe_det.eX = t.screenX; 
    swipe_det.eY = t.screenY;    
  },false);
  ele.addEventListener('touchend',function(e){
    //horizontal detection
    if ((((swipe_det.eX - min_x > swipe_det.sX) || (swipe_det.eX + min_x < swipe_det.sX)) && ((swipe_det.eY < swipe_det.sY + max_y) && (swipe_det.sY > swipe_det.eY - max_y)))) {
      if(swipe_det.eX > swipe_det.sX) direc = "r";
      else direc = "l";
    }
    //vertical detection
    if ((((swipe_det.eY - min_y > swipe_det.sY) || (swipe_det.eY + min_y < swipe_det.sY)) && ((swipe_det.eX < swipe_det.sX + max_x) && (swipe_det.sX > swipe_det.eX - max_x)))) {
      if(swipe_det.eY > swipe_det.sY) direc = "d";
      else direc = "u";
    }

    if (direc != "") {
      if(typeof func == 'function') func(el,direc);
    }
    direc = "";
  },false);  
}


