# Corpus sample

Sixteen documents of AIDP-2K, the 2,000-document dataset of AIDP-Bench, so a reader can look at the documents
without downloading all of them. The PDFs here are the published v1.0 files themselves: each one matches its line in
[PDF-SHA256SUMS](../corpus/PDF-SHA256SUMS).

Each document sits beside its answer key (`.gt.json`) and its page text (`.gt.txt`). The corpus is written answer key
first: the generator writes the answers, then draws the page from them. So a value a system returns that the answer
key does not hold was never printed, and that is what makes an invented value identifiable rather than arguable.
The `.png` file is a preview of the first page.

The first ten are the first document of each type, the ordinary case. The other six are the first document carrying
each hard condition:

- `invoice-001`: attachment: a separate attached file that breaks two of its lines down into their parts; coverPage: a cover page in front of the document proper.
- `invoice-004`: missingTotals: no printed total at all, so nothing confirms the line sum.
- `invoice-008`: scale=xl: a line-item table long enough to run over many pages.
- `invoice-013`: mismatch: a printed total that disagrees with the lines beneath it.
- `invoice-017`: noise=heavy: a heavily degraded scan, which is an image-only PDF with no text layer.
- `consignment-invoice-004`: stickerMismatch: a barcode sticker that contradicts the printed line it sits on.

In the dimensions column, `bundle` means the generator drew the attachment condition for that document. Of the
41 documents of the corpus drawn for it, the 12 with 3 to 8 lines carry an attachment: a second PDF that breaks two
of their lines down into their parts. No file holds two documents. Composition, locales and every hard condition: [CORPUS.md](../CORPUS.md).

| Preview | Type | Locale | Pages | Dimensions | Files |
|---|---|---|---|---|---|
| [`invoice-000`](invoice-000.png) | Invoice | ja-JP | 1 | scale=small, noise=none | [PDF](invoice-000.pdf) &middot; [answer key](invoice-000.gt.json) &middot; [page text](invoice-000.gt.txt) |
| [`purchase-order-000`](purchase-order-000.png) | Purchase Order | nl-NL | 1 | scale=small, noise=heavy | [PDF](purchase-order-000.pdf) &middot; [answer key](purchase-order-000.gt.json) &middot; [page text](purchase-order-000.gt.txt) |
| [`credit-note-000`](credit-note-000.png) | Credit Note | sv-SE | 1 | scale=medium, noise=light | [PDF](credit-note-000.pdf) &middot; [answer key](credit-note-000.gt.json) &middot; [page text](credit-note-000.gt.txt) |
| [`receipt-000`](receipt-000.png) | Receipt | sv-SE | 1 | scale=medium, noise=heavy | [PDF](receipt-000.pdf) &middot; [answer key](receipt-000.gt.json) &middot; [page text](receipt-000.gt.txt) |
| [`quote-000`](quote-000.png) | Quote | sv-SE | 2 | scale=medium, noise=none | [PDF](quote-000.pdf) &middot; [answer key](quote-000.gt.json) &middot; [page text](quote-000.gt.txt) |
| [`freight-invoice-000`](freight-invoice-000.png) | Freight Invoice | es-ES | 1 | scale=small, noise=light | [PDF](freight-invoice-000.pdf) &middot; [answer key](freight-invoice-000.gt.json) &middot; [page text](freight-invoice-000.gt.txt) |
| [`consignment-order-000`](consignment-order-000.png) | Consignment Order | en-US | 1 | scale=small, noise=heavy | [PDF](consignment-order-000.pdf) &middot; [answer key](consignment-order-000.gt.json) &middot; [page text](consignment-order-000.gt.txt) |
| [`consignment-invoice-000`](consignment-invoice-000.png) | Consignment Invoice | de-CH | 1 | scale=small, noise=heavy | [PDF](consignment-invoice-000.pdf) &middot; [answer key](consignment-invoice-000.gt.json) &middot; [page text](consignment-invoice-000.gt.txt) |
| [`bank-statement-000`](bank-statement-000.png) | Bank Statement | en-US | 1 | scale=small, noise=light | [PDF](bank-statement-000.pdf) &middot; [answer key](bank-statement-000.gt.json) &middot; [page text](bank-statement-000.gt.txt) |
| [`general-contract-000`](general-contract-000.png) | General Contract | en-GB | 1 | scale=small, noise=none | [PDF](general-contract-000.pdf) &middot; [answer key](general-contract-000.gt.json) &middot; [page text](general-contract-000.gt.txt) |
| [`invoice-001`](invoice-001.png) | Invoice | ja-JP | 2 | scale=small, noise=light, coverPage, bundle | [PDF](invoice-001.pdf) &middot; [attachment](invoice-001-att-A.pdf) &middot; [answer key](invoice-001.gt.json) &middot; [page text](invoice-001.gt.txt) |
| [`invoice-004`](invoice-004.png) | Invoice | en-IN | 1 | scale=small, noise=none, missingTotals | [PDF](invoice-004.pdf) &middot; [answer key](invoice-004.gt.json) &middot; [page text](invoice-004.gt.txt) |
| [`invoice-008`](invoice-008.png) | Invoice | nl-NL | 11 | scale=xl, noise=light | [PDF](invoice-008.pdf) &middot; [answer key](invoice-008.gt.json) &middot; [page text](invoice-008.gt.txt) |
| [`invoice-013`](invoice-013.png) | Invoice | ja-JP | 1 | scale=small, noise=light, bundle, mismatch | [PDF](invoice-013.pdf) &middot; [attachment](invoice-013-att-A.pdf) &middot; [answer key](invoice-013.gt.json) &middot; [page text](invoice-013.gt.txt) |
| [`invoice-017`](invoice-017.png) | Invoice | ja-JP | 6 | scale=large, noise=heavy | [PDF](invoice-017.pdf) &middot; [answer key](invoice-017.gt.json) &middot; [page text](invoice-017.gt.txt) |
| [`consignment-invoice-004`](consignment-invoice-004.png) | Consignment Invoice | en-US | 2 | scale=medium, noise=light, stickerMismatch | [PDF](consignment-invoice-004.pdf) &middot; [answer key](consignment-invoice-004.gt.json) &middot; [page text](consignment-invoice-004.gt.txt) |

To rebuild this folder exactly (with the v1.0 PDFs unpacked into `aidp-bench/corpus/`):

```bash
node aidp-bench/bench/corpus-sample.mjs
```

Without the PDFs it draws them with the generator instead (after `npx playwright install chromium`); a drawn PDF
has the same pages and text as the release file, and never the same bytes, because it carries the date it was drawn;
1,975 of the 2,012 files also have the same pixels (see [CORPUS.md](../CORPUS.md)).
