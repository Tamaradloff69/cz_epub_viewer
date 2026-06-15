var book = ePub();
var rendition;
var displayed;
var chapters = []
var FONT_FACE_CSS = ""; // This will hold our dynamically generated font CSS
var spineSectionTotals = {};
var bookWidePageTotal = 0;

function resetBookPaginationState() {
  spineSectionTotals = {};
  bookWidePageTotal = 0;
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

  return { displayedPage: displayedPage, displayedTotal: displayedTotal };
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
    book.ready.then(function () {
      if (book.locations && book.locations.total > 0) {
        return book.locations;
      }
      return book.locations.generate(1600);
    }).then(function () {
      var totalPages = book.locations.total;
      console.log("Locations generated. Total pages:", totalPages);
      window.flutter_inappwebview.callHandler('epubPageCount', totalPages);
    });
  }, 50);
}

function loadBook(data, cfi, manager, flow, spread, snap, allowScriptedContent, direction, useCustomSwipe, backgroundColor, foregroundColor) {
  resetBookPaginationState();

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
    var args = [buildLocationPayload(location)]
    window.flutter_inappwebview.callHandler('relocated', ...args);
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

function toCfi(cfi) {
  rendition.display(cfi)
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
    progress: percent,
    totalPages: absoluteTotalPages,
    absoluteTotalPages: absoluteTotalPages,
    locationPage: locationPage,
    displayedPage: pagination.displayedPage,
    displayedTotal: pagination.displayedTotal,
    hasRenderedPagination: hasRenderedPagination,
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
  var cfi = book.locations.cfiFromPercentage(progress);
  rendition.display(cfi);
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
}