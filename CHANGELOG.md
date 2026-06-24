## 1.2.3
- Fixed bookmark and progress navigation opening page 1 when `book.locations` was not yet ready (progress jumps are now queued until locations generate)
- Fixed CFI-based navigation for bookmark ranges by collapsing range CFIs to a display point before calling `rendition.display`
- Fixed slider navigation stale relocate events bouncing the reader to an earlier page after a programmatic jump
- Added `toLocationPage` for 1-based location-index navigation aligned with the page slider
- Added programmatic navigation guards (`beginProgrammaticNav`, `shouldSuppressRelocated`) to filter ghost relocate events from the continuous manager
- Added locations cache support via `locationsCacheB64` on `loadBook` and `locationsReady` callback for persisting generated locations
- Fixed `EpubController.display()` to pass CFIs through `jsonEncode` so special characters do not break the WebView JS call

## 1.2.2
- Added book metadata

## 1.2.1
- Fixed book loading issues
- Fixed font size adjust issues
- Added change theme function
- Added navigation to first and last pages

## 1.2.0
- Added Epub Theme with background and foreground color

## 1.1.6
- Remove Highlight fix

## 1.1.5
- LTR -RTL fixes
- Sub chapter parsing fixes
- Fixed `onRelocated` callback on Android
- Changed Default display settings

## 1.1.4

- Size fit fixes

## 1.1.3

- Added reading progress

## 1.1.2

- Added Annotation click handler

## 1.1.1

- Fixed book reloading issues

## 1.1.0

- Added Local file and asset support
- Added underline annotation
- Added text content extraction

## 1.0.2

- Document changes

## 1.0.1

- Fixed blank screen

## 1.0.0

- Highlight text
- Search in Epub
- List chapters
- Text selection
- Highly customizable UI
- Resume reading using cfi
- Custom context menus for selection
