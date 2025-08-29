var book = ePub();
var rendition;
var displayed;
var chapters = []
var FONT_FACE_CSS = ""; // This will hold our dynamically generated font CSS

// The 'fontJson' argument has been added at the end of the function signature.
function loadBook(data, cfi, manager, flow, spread, snap, allowScriptedContent, direction, useCustomSwipe, backgroundColor, foregroundColor, fontJson) {
  // This block processes the Base64 font data passed from Dart.
  if (fontJson) {
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
      FONT_FACE_CSS = cssString; // Set the global variable
      console.log("Custom font faces have been prepared from loadBook.");
    } catch (e) {
      console.error("Failed to parse font JSON", e);
    }
  }

  var viewportHeight = window.innerHeight;
  document.getElementById('viewer').style.height = viewportHeight;
  var uint8Array = new Uint8Array(data)
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
    var percent = location.start.percentage;
     var locationData = {
       startCfi: location.start.cfi,
       endCfi: location.end.cfi,
       progress: percent,
       totalPages: book.locations.total // ADD THIS LINE
     }
    var args = [locationData]
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

  book.ready.then(function(){
    // Important: Return the promise from generate()
    return book.locations.generate(1600);
  }).then(function(locations){
    // This part now waits for generate() to complete
    var totalPages = book.locations.total;
    console.log("Locations generated. Total pages:", totalPages);

    // Call our new handler to send the total pages back to Flutter
    window.flutter_inappwebview.callHandler('epubPageCount', totalPages);
  });

  // This is the single, correct hook that uses the FONT_FACE_CSS variable.
  rendition.hooks.content.register((contents) => {
    var head = contents.document.head;
    var style = contents.document.createElement("style");
    style.id = "custom-font-faces";
    style.innerHTML = FONT_FACE_CSS;
    head.appendChild(style);

    if (useCustomSwipe) {
      const el = contents.document.documentElement;
      if (el) {
        detectSwipe(el, function (el, direction) {
          if (direction == 'l') { rendition.next() }
          if (direction == 'r') { rendition.prev() }
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

function getCurrentLocation() {
  var percent = rendition.location.start.percentage;
  var location = {
    startCfi: rendition.location.start.cfi,
    endCfi: rendition.location.end.cfi,
    progress: percent,
    totalPages: book.locations.total
  }
  return location;
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

function detectSwipe(el, func) {
  var swipe_det = new Object();
  swipe_det.sX = 0; swipe_det.sY = 0; swipe_det.eX = 0; swipe_det.eY = 0;
  var min_x = 50; var max_x = 40; var min_y = 40; var max_y = 50;
  var direc = "";
  var ele = el
  ele.addEventListener('touchstart', function (e) {
    var t = e.touches[0];
    swipe_det.sX = t.screenX;
    swipe_det.sY = t.screenY;
  }, false);
  ele.addEventListener('touchmove', function (e) {
    e.preventDefault();
    var t = e.touches[0];
    swipe_det.eX = t.screenX;
    swipe_det.eY = t.screenY;
  }, { passive: false });
  ele.addEventListener('touchend', function (e) {
    if ((((swipe_det.eX - min_x > swipe_det.sX) || (swipe_det.eX + min_x < swipe_det.sX)) && ((swipe_det.eY < swipe_det.sY + max_y) && (swipe_det.sY > swipe_det.eY - max_y)))) {
      if (swipe_det.eX > swipe_det.sX) direc = "r";
      else direc = "l";
    }
    if ((((swipe_det.eY - min_y > swipe_det.sY) || (swipe_det.eY + min_y < swipe_det.sY)) && ((swipe_det.eX < swipe_det.sX + max_x) && (swipe_det.sX > swipe_det.eX - max_x)))) {
      if (swipe_det.eY > swipe_det.sY) direc = "d";
      else direc = "u";
    }
    if (direc != "") {
      if (typeof func == 'function') func(el, direc);
    }
    direc = "";
  }, false);
}