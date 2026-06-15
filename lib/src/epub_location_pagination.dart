import 'package:flutter_epub_viewer/src/helper.dart';

/// Device paginated page numbers exposed for reader UI.
extension EpubLocationPagination on EpubLocation {
  /// True when [displayedPage] and [displayedTotal] are valid for UI display.
  bool get hasDisplayedPagination {
    final page = displayedPage;
    final total = displayedTotal;
    return page != null && total != null && page > 0 && total > 0;
  }
}
