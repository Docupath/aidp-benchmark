# The Agentic IDP Accuracy Standard (AIDP)

**Version 1.0. The measurement standard behind AIDP-Bench.**
Maintained by Docupath. Licensed CC BY 4.0. Its scoring rules were fixed and committed before each benchmark
run they govern: for the reference run on AIDP-2K in Docupath's private development repository, and for the
capability run on AIDP-CAP in the public repository that publishes this standard, before that run's documents
existed. Annex B gives each commit and time, and lists every decision made after a run. None of them changes a
rule; after the capability run, six corrections brought its scoring code into line with this standard, and Annex B
gives what each one moves, with the scoreboard as registered published beside the corrected one.

This document defines how to measure the accuracy of an automated document processing system: what
to count, how to count it, how to combine the counts into one score, and what must be published
beside that score. It is written so that anyone can apply it to any system, and it does not depend on
the system that its author sells.

**IDP** stands for intelligent document processing: software that reads business documents, such as
invoices and purchase orders, and turns them into data another system can use. **Agentic** means the
output is consumed by other software rather than checked by a person first. That change is the reason
this standard exists: when no person reads every document, every error that the measurement misses
reaches the business.

---

## 1. Scope and purpose

### 1.1 What this standard defines

- **Twenty-five capabilities** in **five layers**. A capability is one distinct way a system can
  fail, with one question and one unit of count. The register in section 4 lists all of them. Every one
  but Escalation enters the score; Escalation is the safety panel.
- **Thirty-one score-bearing measures** and exactly how each is counted (section 5): thirteen measured on
  AIDP-2K and eighteen on AIDP-CAP.
- **The AIDP Score**: one number, the geometric mean of the score-bearing measures, and its exact split
  into five layer scores (section 6).
- **What is published beside the score**: for any result that claims documents can proceed without a
  person, a safety panel of escaped errors; and the diagnostics the harness computes (section 7).
- **The evidence a result must rest on**: generated corpora and a collected corpus (section 8).
- **How a run is carried out and how failures are counted** (section 9), and **how uncertainty is
  stated** (section 10).
- **What a result must disclose** to claim it follows this standard (section 12).

### 1.2 The problem it addresses

Accuracy in document processing is usually reported as one percentage: of the fields a system tried
to read, the share it read correctly. That figure has three weaknesses.

1. **The system under test chooses its denominator.** A field the system never attempted is not in
   the count, so a system can raise its figure by attempting less.
2. **It is counted in a unit no business uses.** Businesses use whole documents. A document is usable
   only if every value it needs is right. At 99 percent field accuracy, a document with 200 values
   contains at least one error about 87 times in 100.
3. **It cannot see invention.** A system that returns a plausible value for a field the document
   never printed is not penalised by any measure that only checks a list of expected values. Older
   reading software failed visibly. Systems built on generative models fail fluently: the wrong value
   looks exactly like a right one.

### 1.3 Design principles

1. **Every number states its unit.** A figure counted in one unit is never presented as an answer in
   another.
2. **One score, pinned.** The formula is part of the standard. Every score-bearing measure enters it
   with equal weight, the weakest included, and the score is never published without its components.
3. **Absence must be provable.** The evaluation corpus must make it possible to establish that a
   value is not on the page, not merely to assume it.
4. **Reality gets a vote.** Generated evidence can be tuned to its own generator, so it is paired
   with evidence collected from real traffic.
5. **Silence is scored.** A system is measured on whether it knows when it is wrong, not only on
   whether it is right.
6. **One event, one count.** A failure caused only by a convention counts against exactly one score-bearing
   measure; an earlier failure, such as a missed row, still lowers every later measure it affects.
7. **Nothing is dropped.** A document the system misclassified, or failed to process, stays in every
   denominator.
8. **Reproducible by a third party.** A result must be recomputable from published artefacts.

### 1.4 Independent of document type

The standard defines no document types and requires none. A repeating row is a repeating row whether
it is an invoice line, a fee entry or a bank transaction. A benchmark built on capabilities does not
need rewriting when a system learns a new kind of document, and results stay comparable.

---

## 2. Definitions

**Answer key.** The values that are true of a document, written in the schema the system under test
emits. Also called ground truth.

**Field-key document type.** A document type whose answer key lists every field value. In AIDP-2K
these are invoice, purchase order, credit note, freight invoice, consignment order and consignment
invoice.

**Fact-key document type.** A document type whose schema is too open to list field by field, so its
answer key lists facts that must appear somewhere in the output. In AIDP-2K these are receipt, quote,
bank statement and general contract.

**Capability.** One of the twenty-five ways a system can fail (section 4), with one question and one
unit of count.

**Layer.** A stage of work, defined by the knowledge it needs beyond the page. The five are Read,
Capture, Understand, Reason and Trust. Trust is not a stage of work: it is a property of the system
that did the other four.

**Measure.** A number computed by the harness: what it counts, over which values or documents.

**Score-bearing measure.** A measure that enters the AIDP Score. The set is fixed before the run.

**Diagnostic measure.** A measure the harness computes and publishes that does not enter the score,
listed with the reason (section 7.6).

**Captured value.** A value the system returned for a field that the answer key fills.

**Missing value.** A field the answer key fills for which the system returned nothing.

**Invented value.** A value the system returned for a field the answer key leaves empty.

**Derived value.** A value the system did not read but computed from values it did read, by a method
it states, from inputs it states, and reported as computed.

**Canonical form.** The form a value takes once the world's conventions are applied: a date as a
calendar date, a number as a magnitude, a country as its ISO 3166 code, a currency as its ISO 4217
code.

**Contract.** The output the customer agreed to receive: the schema (which sections and keys, in which
shapes) and the formats the customer chose. AIDP-2K's reference contract holds dates as DD/MM/YYYY and numbers
as plain numbers; AIDP-CAP's customer contract is in section 5.8.

**Full lane.** The document submitted as a customer submits it: the rendered PDF, read by the system,
classified, then extracted.

**Text lane.** The same document's own correct text, given to extraction with the correct document
type. It removes reading from the measurement. The difference between the two lanes is the cost of
reading the page.

**Routed to a person.** The system's own decision that a document must be checked by somebody before
it is used, rather than accepted automatically.

**Critical error.** A wrong, missing or invented value in a field a finance system needs to post the
document, an inexact row count, or a wrong document type (section 7.1).

**Generated corpus.** Documents rendered from answer keys written first, so absence is provable by
construction. The reference generated corpora are AIDP-2K and AIDP-CAP (section 8.2).

**Collected corpus.** Documents from production traffic that people reviewed, with every correction they made
recorded. The reference collected corpus is AIDP-Field.

---

## 3. Units of count

A result states the unit of every figure.

| Unit | One of these is | Used for |
|---|---|---|
| Token | one word or one number in the source text | reading |
| Value | one named value in the output schema | capture, understanding, contract |
| Row | one instance of a repeating structure, such as a line item | tables |
| Check | one arithmetic, schema or format test | consistency, contract |
| Payload | one decoded barcode or symbol | barcodes |
| Page | one page of a file that arrived | intake |
| Mark | one handwritten note, stamp, signature or tick | handwriting and stamps |
| Document | one source document, whole | identification, segmentation, resolution, repeatability, escalation |
| Case | one document that should be stopped, or a control that should not | anomaly detection, consistency |

Token, value, row and check figures are diagnostic: they say where errors are. Document figures are
operational: they say what reaches the business. A headline claim must include at least one document
figure. The AIDP Score carries six: Identification, Segmentation, Resolution and Repeatability, and the
documents and cases of contradictions flagged and of anomaly detection. A claim that documents can proceed
without a person must also carry the safety panel (section 7.1).

---

## 4. Five layers, twenty-five capabilities

### 4.1 What a layer is

> **A layer is a stage of work, defined by the knowledge it needs beyond the page.**

Each layer needs more knowledge than the one before, and that requirement decides where every task
belongs. Decoding a barcode, meaning recovering the exact string stored in the symbol, needs only the
page, so it is Read. Knowing that "(10)" inside that string introduces a lot number needs the GS1
standard, a set of rules for interpreting such codes, so it is Understand. Deciding which of three
similarly named suppliers the document means needs the customer's own supplier list, so it is Reason.

| # | Layer | The work | Needs, beyond the page |
|---|---|---|---|
| 1 | **Read** | Get everything off the page as content | nothing |
| 2 | **Capture** | Turn content into a faithful record of this document | knowledge of what business documents look like |
| 3 | **Understand** | Turn that record into clean, canonical, complete data | the world's conventions |
| 4 | **Reason** | Make that data fit this customer's business | this customer's records, contract and instructions |
| 5 | **Trust** | Not a stage of work: a property of the system that did the other four | evidence about the system itself, across documents and runs |

**The placement rule.** A capability belongs to the layer whose knowledge it requires. Trust follows a
different rule on purpose, because it describes the system rather than work done to a document, and
it can only be observed across documents and runs.

### 4.2 What a capability is

A capability is one way a stage of work can fail. It has one question, phrased so that "yes" is the
good answer, and it starts by stating what it counts, because capabilities that sound alike often
count different things.

One example shows why. A fax of three pages, including an attached packing list, carries 78 printed
values. If page two never converts into something the system can read, that is an **Intake** failure,
counted in pages. If every page arrives but the system returns 74 of the 78 values, that is a
**Completeness** failure, counted in values returned. If all 78 return but the buyer's VAT number sits
in the seller's field, that is a **Fidelity** failure, counted in values correct and in the right
field. Three failures of one fax, and three different engineers would fix them.

Every capability must be **declared** in a result: as score-bearing, as reported beside the score, or
as not yet measured. A capability left out silently makes the result non-conformant. In this version every
capability but Escalation is score-bearing.

### 4.3 The register

Status is for this version, on the reference corpora. "Score" means one or more score-bearing measures
(section 5), with the corpus each is measured on: AIDP-2K, the 2,000 documents of the reference run, or AIDP-CAP,
the capability set (section 8.2). Escalation is the safety panel (section 7.1).

#### Layer 1: Read (needs nothing beyond the page)

| Capability | Counts | Question | What failure looks like | Status |
|---|---|---|---|---|
| **Intake** | pages, attachments | Did every page and attachment that arrived get read? | Page 2 never converts; the packing list is dropped without notice; the email body carrying the order number is never read. | score: pages read (AIDP-CAP) |
| **Printed text** | tokens | Were the printed words and numbers recovered? | The letters, numbers and symbols on the page are not read exactly as they appear. | score: word token recall, numeric token recall (AIDP-2K) |
| **Handwriting and stamps** | marks | Were handwriting, stamps, ticks and signatures read? | The note "SHORT, 3 cartons" written beside line 7 is missed. | score: marks read (AIDP-CAP) |
| **Barcodes** | payloads | Was each barcode decoded to its exact stored string? | A GS1 barcode, a standardised barcode, is read as anything other than the exact sequence of characters it contains. | score: symbols decoded (AIDP-CAP) |
| **Reading order** | sequences | Was the reading order and table structure recovered? | Two columns are mixed into one stream of nonsense instead of being read separately. | score: rows read in order (AIDP-CAP) |
| **Legibility** | marks | Did the system report what it could not read, instead of guessing? | A coffee ring covers a quantity and the system returns an 8 instead of saying it cannot be read. | score: unreadable values declared (AIDP-CAP) |

#### Layer 2: Capture (knows what business documents look like)

| Capability | Counts | Question | What failure looks like | Status |
|---|---|---|---|---|
| **Identification** | documents | Was it recognised as the right kind of document? | A credit note, which reduces money owed, is treated as an invoice, which asks for payment, and its meaning reverses. A misclassified document counts as a failure; it never disappears. | score: document type accuracy (AIDP-2K) |
| **Segmentation** | boundaries | Where several documents arrived in one file, were they split correctly? | Three delivery notes scanned into one PDF, and the system cannot say where the second begins. | score: documents cut out exactly (AIDP-CAP) |
| **Line items** | rows | Was every repeating row found exactly once, and no row invented? | Rows 41 and 42 have the same name but different lot numbers, and one of them is lost or counted twice. | score: row recall, row precision (AIDP-2K) |
| **Completeness** | values returned | Was every value the page carries returned? | The page carries 78 values and the system returns 74. | score (AIDP-2K) |
| **Fidelity** | values correct, in the right field | Does every value returned match the page, in the right field? | The buyer's VAT number is copied perfectly into the seller's field. The answer is still wrong. | score (AIDP-2K) |
| **Restraint** | values invented | Was nothing returned that the page never carried? | The order number field is empty on the page and the system supplies PO-2024-0117, convincing and false. | score: non-invention (AIDP-2K) |

#### Layer 3: Understand (knows the world's conventions)

| Capability | Counts | Question | What failure looks like | Status |
|---|---|---|---|---|
| **Normalisation** | values | Was each value understood and converted to its canonical form? | 23.05.2026 is taken for the wrong day, or 1.234,56 for one point two. | score: dates, numbers, country and currency codes (AIDP-2K) |
| **Parsing** | fields | Were compound values separated into the fields that hold their parts? | Product details packed into one description are left there; a one-line address is not split into street, city and postal code. | score: parts in their own field (AIDP-CAP) |
| **Decoding** | payload fields | Were standards-bearing strings interpreted rather than passed through raw? | "(10)" is not read as the lot and "(21)" as the serial, or the payload is assigned to row 5 instead of row 4. | score: label fields on the right line (AIDP-CAP) |
| **Computation** | declared derivations | Were values the page implies but never prints computed correctly, from stated inputs? | Thirty line amounts and no total, and the total is not computed, or computed without showing the working. | score: implied values computed and shown (AIDP-CAP) |
| **Consistency** | checks | Does the delivered document agree with its own arithmetic? | The page prints 5 times 12.00 as 600.00 and the mismatch is neither flagged nor left visible. | score: arithmetic consistency (AIDP-2K), contradictions flagged (AIDP-CAP) |

#### Layer 4: Reason (knows this customer)

| Capability | Counts | Question | What failure looks like | Status |
|---|---|---|---|---|
| **Resolution** | matches: entities and codes | Was the right real-world entity, or the right customer code, identified? | "ACME GmbH & Co. KG", "ACME" and "Acme Group" are matched to one of two plausible wrong entries in the supplier list instead of the right one. External registries count as the same kind of knowledge. | score: supplier identified (AIDP-CAP, against the customer's supplier list published with it) |
| **Instructions** | rule targets, and the untouched baseline | Did the written rules do what they said, change nothing else, and report what they changed? | "Dates in ISO": not every date changes, or something else changes too. | score: adherence and containment (AIDP-CAP) |
| **Contract** | contracted keys and format checks | Was the output delivered in the agreed schema, shapes and formats? | Items[].Net Amount arrives as text in local punctuation, or under the name Line_Items[].netAmount. | score: customer contract (AIDP-CAP) |

#### Layer 5: Trust (a property of the system)

| Capability | Counts | Question | What failure looks like | Status |
|---|---|---|---|---|
| **Repeatability** | values and documents, across runs | Does the same document give the same answer every time? | The same invoice processed on Tuesday and on Thursday gives two answers, and the person checking has to choose. | score: field stability (AIDP-2K) |
| **Traceability** | values | Can every delivered value be traced to its evidence? | A value points neither at its place on the page nor at a stated computation. | score: value located on the page (AIDP-CAP, against where the page prints it) |
| **Calibration** | probabilities | Does the confidence attached to a value predict whether it is right? | Values reported 92 percent confident are wrong far more, or far less, often than 8 times in 100. | score: calibration error and discrimination (AIDP-CAP) |
| **Anomaly detection** | flags | Were the things that should stop a document detected, even when the page itself is consistent? | The same supplier as last month, with a different bank account, passes without a flag. | score: anomaly cases handled right (AIDP-CAP) |
| **Escalation** | documents | Did the documents that truly contained a critical error reach a person? | A document with a wrong total is accepted automatically and nobody sees it. | the safety panel, published with any result that claims documents can proceed without a person (this edition makes no such claim) |

Learning, the question of whether a person's correction becomes permanent knowledge, is real and
valuable, but it needs observation over time: a deployed system followed through months of real documents, or a
sequential dataset that presents corrections and then related documents in order. A fixed document corpus cannot
measure it. It sits
outside the register, in the disclosure annex (Annex A), and never contributes to a score.

### 4.4 Two counting rules

**One event, one count.** A failure caused only by a convention counts against exactly one score-bearing measure. A date that
was understood correctly but delivered with the page's punctuation instead of the contract's is a
contract failure, and only a contract failure: Normalisation credits the understanding, Contract
charges the format. A value read correctly and converted wrongly by a convention (the day and month
swapped, a decimal separator taken for a thousands separator) is a Normalisation failure, and only a
Normalisation failure: it does not also fail Fidelity. An invented value is a Restraint failure whether
or not the system labelled it as computed. An earlier failure is different: a missed row or a wrong document type
lowers every later measure it affects, because a value never captured cannot be correct.

**Units first.** Every capability states what it counts before it states anything else, so two
capabilities that sound alike cannot be confused, and a failure is always charged in the right unit.

---

## 5. The score-bearing measures

Thirty-one measures enter the AIDP Score, in five layers: Read 7, Capture 7, Understand 8, Reason 4, Trust 5.
Every one is a share between 0 and 1. Thirteen are computed on AIDP-2K (sections 5.2 to 5.6): unless stated
otherwise each in the full lane over the six field-key document types, and pooled: the passes of every document
of a type are added up and divided by the checks of every document of that type, so a one-line receipt and a
five-hundred-line order each count by how much they contain. Eighteen are computed on AIDP-CAP (section 5.8).

Three measures of the reference run tested their capabilities only in part: Decoding, payload syntax (raw barcode
text kept out of values, not each barcode field placed on its line); Contract against the published contract
(not a customer's own); and Traceability, provenance (a source the system names, not checked against the page).
AIDP-CAP measures those three capabilities in full, so the three are diagnostics in this version: they keep their
definitions below and their figures are published, and none of them enters the score.

### 5.1 How values are compared

Every value is compared according to what the answer key holds:

- **Number** (a quantity, a rate or an amount of money). The returned value passes only when it
  parses, with the locale's separators taken into account, to exactly the key's number: the same
  sign and the same magnitude. 1.234,56 and 1,234.56 both mean 1234.56 and pass for it. 24.60336 does
  not pass for 24603.36, and 2310.98 does not pass for -2310.98. No comparison of digits alone ever
  passes a number.
- **Date**. The returned value passes when it is the same calendar date, whatever separators it uses.
- **Identifier or code** (a value written in digits that names something rather than measuring it:
  a document, reference, account, article or VAT number, a line position, a postal code). Compared as
  text, where a comparison of letters and digits alone is legitimate, because 4006-381-333931 and
  4006381333931 name the same article. A field is an identifier when its name says so: number, no.,
  ID, code, reference, account, postal, VAT and similar words. Every other field whose key holds a
  number is a numeric field.
- **Text**. Compared after case, whitespace and trailing punctuation are smoothed away, then on
  letters and digits alone.

A value whose key holds letters of any script is text, even if it contains digits: an address ending
in a building number is an address.

### 5.2 Read

| Measure | What it is |
|---|---|
| **Printed text, words** | For each document, the share of the word tokens in the document's own correct text that appear in the text the system read from the page (multiset recall). Averaged over every document of all ten types, fact-key types included. |
| **Printed text, numbers** | The same for numeric tokens, compared on their digits. A number is digit groups joined by single separators (a dot, a comma, an apostrophe or one space), so a thousands separator stays inside it; two or more spaces, a tab or a line break end it, so the gap between two table columns never joins two numbers. |

Read is the one layer averaged per document over the whole corpus rather than per document type
(section 6.2). A document whose full lane failed, or returned no text, scores zero on both.

### 5.3 Capture

| Measure | Passes | Checks |
|---|---|---|
| **Identification, document type** | documents assigned the right type (declared alternatives accepted) | documents |
| **Line items, recall** | answer-key rows matched one to one by a returned row | answer-key rows |
| **Line items, precision** | returned rows matched one to one to an answer-key row | returned rows |
| **Completeness** | answer-key values for which the system returned a value | answer-key values |
| **Fidelity** | captured values that are right | captured values, right or wrong, except convention-only errors (section 5.4) |
| **Restraint, non-invention** | returned values that are not invented | values returned: right, wrong or invented |

Rows are matched first on an identity key formed from the row's identifier and description, then, for
rows that key cannot place, on a numeric fingerprint formed from the absolute values of its numbers.
A row with no article column (a shipment, a container, a location, a tax line, a payment account) is
identified by its first identifier column instead, such as the shipment reference or the row id.
That is how the line-item measures place rows. The field measures (Completeness, Fidelity and Restraint) pair
rows on an identity key and otherwise by position, so a row whose identity is missing or read differently is
compared with the row at its position (`aidp-bench/FINDINGS.md`, B8).
The Barcodes section is scored under Barcodes, not as fields. A free-text catch-all field that
legitimately takes surrounding content (Payment Details Description) is left out.

**Labelled or not, counted once.** A value the system returns for a field the answer key leaves empty
is an invention, and Restraint counts it, whether or not the system labels it as derived, computed or
calculated. Only a value the answer key holds is not an invention. A derivation is still audited under
Computation (section 7.5), which is reported beside the score and charges nothing.

### 5.4 Understand

| Measure | Passes | Checks |
|---|---|---|
| **Normalisation, dates** | dates that mean the key's calendar date | dates whose content the system recovered |
| **Normalisation, numbers** | numbers that mean the key's number | numbers whose content the system recovered |
| **Normalisation, country and currency codes** | country and currency codes equal to the key | country and currency codes the key holds |
| **Decoding, payload syntax** (diagnostic) | delivered values free of GS1 application-identifier syntax, such as "(10)" | delivered values outside the Barcodes section |
| **Consistency, arithmetic** | checks that hold on the delivered output | quantity times unit price against the line amount; subtotal plus tax against the total |

**Normalisation scores understanding.** A returned date or number passes when it means the same value
as the key, whatever its punctuation: "22.02.2026" for 22/02/2026 passes, and so does "1.234,56" for
1234.56. A swapped day and month fails, and so does a number with the right digits and the wrong
value because a separator was taken for the other one. The format the value arrived in is Contract's
to judge (section 5.5), so a punctuation-only difference is never charged here.

**Convention-only errors belong to Normalisation alone.** A wrong value is convention-only when one of
two tests, applied to the returned value and the key's value, holds:

- **a date in another order**: both read as dates, and the returned date's day, month and year are the
  key's three numbers in a different order (22/02/2026 returned as 02/22/2026);
- **a separator confusion**: both read as numbers with the same sign, their significant digits (every
  digit, leading and trailing zeros removed, at least two of them) are the same, and their values are
  not (24603.36 returned as 24.60336, 7761.00 as 7.761).

Such a value fails Normalisation and leaves Fidelity's count: it is neither a pass nor a failure there.
It still counts as a captured value for Completeness, and as an error for the safety panel, because the
value delivered is wrong. Every other wrong value fails Fidelity. A flipped sign is not a convention
error (no separator convention turns a credit into a debit): it fails Fidelity and is not counted in
Normalisation.

**The Normalisation denominator** is the values whose content the system recovered: those that match
the key exactly, those that mean the same value, and the convention-only errors above. A value the
system simply misread belongs to Fidelity and is not counted here, so this measure is not a second copy
of Fidelity. Text has no canonical form a convention decides, so text values are counted and published
as a diagnostic and kept out of the measure. Values in identifier fields are text for this purpose.

**Consistency** compares magnitudes, so a credit note that prints every line negative is not charged
for its sign convention, and rows that agree only once the sign is ignored are counted separately. A
check passes within 0.02 or half of one per cent of the amount, whichever is larger. Some documents
genuinely do not add up; the planted contradictions in the corpus are reported beside this measure.

### 5.5 Reason

**Contract against the published contract** (diagnostic; the score-bearing Contract is the customer's contract,
section 5.8) is one measure, pooled over every check of every document. It is checked against the
**contracted output schema** of the document type, never against the answer key's structure: the
published output contract (the one the answer keys are written in), with every section under the name
a response gives it (a table the listing names "Charges" is returned as "Invoice Charges"; a record
nested inside a shipment is returned as a table of its own) and in the shape the published format
declares for it. The contract of every type is written beside the answer keys as `contract.json`, so the
scorer needs nothing outside this repository.

- **Schema checks.** Each section the contract defines is present, in its contracted shape (a
  one-entry list and a bare object holding the same content count as the same shape). Each contracted
  field is emitted, on the object or on the first row of a list the system returned, rather than
  dropped, because a consumer expecting the field breaks when it is missing; a field where the answer
  key holds a value is Capture's to count instead. Each section in the output is one the published
  format allows for the type; a section it allows is not a break, even one a system adds to every response.
- **Format checks.** Each date the key holds, where the system returned a value, is delivered as
  DD/MM/YYYY. Each number the key holds in a numeric field, where the system returned a value, is
  delivered as a plain number: digits, an optional minus sign and an optional decimal point, with no
  thousands separators, currency or units.

Contract = (schema checks passed + format checks passed) / (schema checks + format checks). A value
the system did not return is Completeness's to count, not the contract's. A document with no checks,
such as a fact-key document with no contracted schema, does not count at all.

### 5.6 Trust

| Measure | What it is |
|---|---|
| **Repeatability, field stability** | For each document of the declared repeatability sample, the share of output fields whose value was identical across three submissions with the extraction cache bypassed. The reference run reused its stored page reading after the first submission, so this measure mostly excludes reading variation. Averaged per document within each type. A document whose repeats did not all succeed scores zero. |
| **Traceability, provenance** (diagnostic) | Of the values the system delivered and scored, the share whose evidence record names identifiable evidence: an exact span on the page, a normalised or approximate match, or a stated computation. A value whose evidence is "none" counts against it. |

This diagnostic reads the system's own evidence record. The score-bearing Traceability is measured on AIDP-CAP
against where the page prints each value (section 5.8).

### 5.7 Failures stay in every denominator

- **A misclassified document** is still scored on every measure. Its output is compared with its own
  answer key and fails wherever it differs.
- **A failed or missing lane** scores as a total failure: it passes nothing, and each measure charges it
  exactly the checks a complete, correct answer from that lane would have produced. Read scores zero.
  For the measures whose denominator is normally the system's own output (line-item precision,
  Fidelity, Restraint, Traceability), it is charged the answer key's count.

### 5.8 Measured on AIDP-CAP

Eighteen measures are computed on AIDP-CAP, the capability set (section 8.2). Fifteen are pooled: their passes over
their checks, summed over every unit of the measure. AIDP-CAP holds the same number of documents of each of its six
types, so pooling counts each type by how much of the capability it carries. Instructions has two measures, each the
average of its seven instructions, each instruction pooled over its own checks, so no instruction weighs more for
having more targets. Calibration has two measures computed over every header value returned. Every measure counts
what the system returned, as the runner kept it, and a lane that failed is charged as section 5.7 requires: it passes
nothing, each pooled measure charges it every check a complete answer would have produced, and Calibration counts
every header value its key holds as returned wrong at full confidence. Where a measure has controls, a control passes
by being left alone, so a system that answers everything the same way scores no better than half. The scorer is
`aidp-bench/bench/score-cap.mjs`, and its own test (`test-score-cap.mjs`) gives a perfect answer one on every measure,
and a failed one zero while charging it as many checks as the perfect one.

| Measure | Passes | Checks |
|---|---|---|
| **Intake, pages read** | pages whose words and numbers are at least half present in the reading page matched to them (multiset recall, against the page's own text as its PDF hands it back; words in a right-to-left script, which a PDF hands back in visual order and in pieces, are left out, and such a page is judged by its numbers and its other words). Every page that arrived is matched one to one with the pages of the reading, best pairs first, however the reading numbers or orders them, so a page the reading dropped is not read, however much it resembles another | every page that needed converting or could be dropped: the pages of each attachment, of each scanned document, and each page fed upside down; and as many ordinary pages of digital documents, drawn by the registered rule |
| **Handwriting and stamps, marks read** | handwritten notes whose wording is in what the system recorded for their page apart from what the page prints (its page description, and its reading less the page's own printed words), with at most one character in five different and every short word (initials, a count) exactly; stamps whose words are there on the same terms and whose date is there in any written form; signatures and ticks the system reported on their page; control pages on which it reported nothing of the mark's kind | every mark, and one control page for each: the same page of a document that carries no mark and nothing made unreadable (an ink blot, a coffee ring or a label, which a system may fairly describe as a mark), or its last page where it is shorter, of the same type where one is left |
| **Barcodes, symbols decoded** | symbols whose payload the system returned, compared as the reference run compares them: an escaped line break read as a line break, a symbology identifier dropped, then letters and digits only, case aside, so a GS1 string with or without its brackets and separators, and a payment code with its lines broken or joined, compare alike; a symbol that prints its payload as text beneath it may be read from that text, as a reader at a desk would | every barcode symbol printed whole |
| **Reading order, rows read in order** | rows held on one line of the reading, every cell in reading order (section 5.2's reading, the judge of `post-run/reading-order.mjs`); a row with a cell the reading does not hold (misread, dropped or marked unreadable) is not read in order, as in the reference run's figure | every row of every printed table that has two cells or more to judge |
| **Legibility, unreadable values declared** | values made unreadable for which the system returned nothing, or a value carrying its own word that it could not read it (a confidence flag naming the reading uncertain, unreadable, illegible or obscured, or an [obscured], [illegible] or [cut off] tag in the value; a flag saying only that the value was not found in the text does not count, since a guess is never found there either); readable controls returned right and not so marked; a value on a line the system did not return is neither declared nor read, and fails | every value made unreadable (an ink blot, a label stuck over it), and one readable control beside each, under a coffee ring that leaves it legible |
| **Segmentation, documents cut out exactly** | documents one returned part spans exactly, first page to last, in a file whose returned parts do not overlap | every document inside a file holding several, and every single-document control file |
| **Parsing, parts in their own field** | parts of a value printed as one (an address on one line, a postal code with its city, an account number with its bank code, a vessel with its voyage) returned right in their own field | every such part the key holds |
| **Decoding, label fields on the right line** | lot and serial numbers that the line carrying the label holds exactly as the label gives them | every lot and serial number printed only on a line's label |
| **Computation, implied values computed and shown** | values the page implies but does not print, returned right and recorded by the system as computed: in its derivation record, by the value's source, in its own words for the field, or by locating the value at the values it was computed from | every such value (a line amount, a net amount, a tax total, a grand total, a due date from the printed terms) |
| **Consistency, contradictions flagged** | documents with a printed contradiction that the system flagged, as an arithmetic mismatch on an amount (a failed check digit of a bank or tax number is not one); clean controls it did not flag | every document with a printed contradiction, of one of four kinds (a line amount that is not its quantity times its price, a subtotal that is not the sum of the lines, a total that is not the subtotal plus tax, a tax amount that is not the printed rate times the subtotal), and as many clean controls |
| **Resolution, supplier identified** | documents on which the system delivered the supplier's code from the customer's supplier list, or no code for a supplier that is not on it | every invoice, credit note, consignment invoice and freight invoice |
| **Instructions, adherence** | targets holding exactly the instructed value, the instruction applied to the value the system returned for that target with no instruction | every target of every instruction applied, for which the system returned a value with no instruction; each instruction pooled, the seven averaged |
| **Instructions, containment** | values outside the instruction's scope left as the system returned them with no instruction | every value outside the instruction's scope in either answer, except a value the system returned differently in its two answers with no instruction; each instruction pooled, the seven averaged |
| **Contract, customer contract** | schema checks and format checks the customer's contract passes on the answer the customer receives | every check: each contracted section in its shape, each contracted field emitted, no section outside the contract (the customer's own field is allowed), each date as YYYY-MM-DD, each bank account number in capital letters and digits only, each number a plain number, for every value the key holds (a value the answer leaves out does not meet the customer's format) |
| **Traceability, value located on the page** | values delivered right whose box, on the right page, holds the centre of where the page prints the value, is no taller than three of its lines and no wider than four times its width, or, where the page also carries the value in a barcode (a label for its own line's values), whose box covers that symbol's corner and is no larger than a symbol; implied values delivered right that the system records as computed, as Computation reads it | every value the page prints legibly (a value made unreadable is left out, its readable control is not), and every implied value, less the values on a page fed upside down, on which a system may give a box in the page's own frame or turned upright; a value not delivered right is untraced |
| **Calibration, one minus calibration error** | one minus the expected calibration error over ten equal-width confidence bins: the size-weighted gap between the confidence given and the share of values that were right | every header value the system returned in a field the answer key defines, a nested block (taxes, payment methods) value by value, each with its own confidence, judged right or not against the key (an implied value against the value implied, a value the key does not hold as wrong; whether it should have been returned at all is Restraint's to count); a value with no confidence is taken as fully confident, so withholding confidence earns nothing. Both Calibration measures are also published over the values the key holds alone, beside the score |
| **Calibration, discrimination** | the share of pairs of a right and a wrong value in which the right one carries the higher confidence, ties counting half (the area under the ROC curve) | every pair of a right and a wrong returned header value, on the same terms |
| **Anomaly detection, cases handled right** | anomaly cases the system stopped (a duplicate signal, a rule's flag or rejection, a matching exception), and controls it did not stop, each judged on the document's answer and its matching verdict together, so a case without either fails | every anomaly case and as many controls of the same kinds |

**Instructions** are applied in the text lane, one extraction per instruction with the extraction cache bypassed, on
the registered sample of ten documents of each type, beside two extractions of the same text with no instruction.
Seven instructions (`rule-packs-cap.mjs`): every date as YYYY-MM-DD; the seller's name in capital letters; the prefix
REF- before the document number; bank account numbers without spaces; article IDs without hyphens; country names as
two-letter ISO codes; quantities with exactly two decimal places. An instruction applies to a document when the key
holds a target for it (two dates for the date instruction). A target's expected value is the instruction carried out
on what the system returned with no instruction, so the instruction is judged on transforming what the system read,
not on reading it, which other measures count; the country code is the country's own, which the key holds. A target
passes only as the exact text instructed: a format instruction is a promise about characters. Each instruction has a
scope, the values it may legitimately change (every date, for the date instruction), which containment leaves out;
the second answer with no instruction tells the instruction's effect from the system's own variation.

**Contract** is checked on the registered sample of twenty documents of each type, run again in the full lane under the
customer's contract: the published output contract of each type, with the customer's own field "Supplier Code" allowed
beside it (whether it is filled right is Resolution's to count), and the customer's formats, given to the system as
its written instructions (`cap-customer.mjs`). The answer the customer receives is the system's enriched answer, which
carries the customer's field.

**The customer's setup** applies to every AIDP-CAP document in the full lane: the supplier list and the bank master as
reference data, the rules that look the supplier up in them and check its bank account, and the platform's
purchase-order matching. It is the configuration a customer of the system under test would give it, through the
system's own customer configuration, and it is published with the corpus.

**Controls** are drawn by the registered rule in `score-cap.mjs`, in the order of the SHA-256 of the seed, the purpose
and the document's id, one for each case they balance, from a document of the same type where one is left and from any
type where none is, so a measure never holds fewer controls than cases (only when every document that could serve has served, in a small part of a set and never in the whole of AIDP-CAP, does one serve again): for contradictions, clean documents (no
contradiction, implied value or hidden value); for marks, documents that carry no mark and nothing made unreadable,
each serving once for each kind of mark; for Intake, ordinary pages of digital documents, as many as the pages that
needed converting. A case document of Anomaly detection carries no hidden value,
implied value, contradiction or upside-down page, so no case is decided for another capability's reason.

**Escalation** keeps the safety panel (section 7.1): it is published with any result that claims documents can proceed
without a person, and computed on AIDP-CAP's full lane as on AIDP-2K's.

---

## 6. The AIDP Score

### 6.1 The formula

```
AIDP Score = 100 x exp( mean( ln( min(m_i, 1) ) ) )   over the thirty-one score-bearing measures m_i
```

- **Nothing is excluded.** Every score-bearing measure enters, the weakest included, each capped at 1.
- **The geometric mean is required.** It is the harshest of the standard means: a collapse in any one
  measure drags the score in a way an arithmetic mean would hide.
- **Only measures that can fail are score-bearing.** A measure that cannot fail in practice adds a
  constant 1 that props the score up without measuring anything, so such a measure is a diagnostic.
- **The score never travels alone.** It is published with its components, at equal prominence, and with
  the safety panel (section 7.1) beside it whenever the result claims documents can proceed without a
  person.

### 6.2 One weighting, read from the corpus

Each of the six field-key document types counts equally, exactly as each does in the generated corpus,
which holds the same number of documents of every type. Nothing outside the published corpus enters
the score, so anyone holding the corpus and a run's outputs can recompute it to the last decimal. A
weighting taken from a vendor's production traffic would make the score depend on confidential counts
that no one else can check, and on a mix of documents that differs from vendor to vendor and moves
over time, so two results could not be compared.

Every measure except the two Read measures is computed per document type, pooled over that type's
checks, and then combined across the six types with equal weights. A type with no checks for a measure
is left out of that measure's combination. The two Read measures are averaged per document over all
ten document types.

AIDP-CAP's measures are computed over all its documents together (section 5.8): AIDP-CAP holds the same number of
documents of each of its six types, so pooling already counts every type, and a measure such as anomaly detection,
whose cases fall unevenly across types by construction, is not given to the type with the fewest.

The per-type values of every measure are always published (section 12). A reader who wants a figure
for their own mix of documents can recombine them with their own weights; that figure is the reader's
own and is not the AIDP Score.

### 6.3 The layer decomposition

```
Layer score L_j = 100 x exp( mean( ln( min(m_i, 1) ) ) )   over the score-bearing measures of layer j
AIDP Score      = 100 x exp( sum_j( n_j x ln(L_j / 100) ) / sum_j( n_j ) )
```

where n_j is the number of score-bearing measures in layer j (Read 7, Capture 7, Understand 8,
Reason 4, Trust 5). Because the geometric mean splits exactly into groups, the layer scores recombine
to the AIDP Score to the last published decimal. A layer score that does not
recombine is not a layer score, and the reference harness refuses to publish one.

Layer scores are the score opened up. They are published with the score and its components, never
instead of them, and membership of a layer is fixed by this standard. A layer a system does not
implement scores zero, and because the score is a geometric mean, the whole score is then zero: that
is intended, because a missing layer is a missing capability, not a neutral one.

---

## 7. Reported beside the score

Every capability but Escalation is score-bearing in this version. The reference run reported four capabilities
beside the score (calibration, barcodes, written instructions, computation), as declared before that run; their
figures stay published as diagnostics, and AIDP-CAP's score-bearing measures of the same capabilities replace them
in the score. Sections 7.2 to 7.5 define those diagnostics.

### 7.1 The safety panel

Shown beside the score of any result that claims documents can proceed without a person, computed on
the field-key documents of the full lane under the critical error budget, and broken down by document type.

- **Escaped critical errors.** The share of field-key documents that contain at least one critical
  error and that the system did not route to a person: it accepted them automatically, or recorded no
  need for review. This is the only outcome in which wrong data reaches a downstream system with
  nothing attached to warn anyone. Published as a count and as a share.
- **Catch rate.** Of the documents with a critical error, the share routed to a person.
- **False-alarm rate.** Of the documents with no critical error, the share routed to a person.
- **Safe-handling rate.** The share of field-key documents in which no critical error passed unchecked: each one
  either carried no critical error or was routed to a person. It is one minus the share of escaped critical errors.
  Wherever such a result quotes the AIDP Score, it quotes the safe-handling rate beside it (Annex B): the
  score counts values, this rate counts documents that were safe to let through, and neither may stand for the
  other.

**Caught means routed to a person**, the capability's own definition ("reached a person"), not that a
flag was raised somewhere inside a document that was then accepted. The routing decision is the
system's own document-level decision as it records it. Evidence that records only per-field decisions
is read as routed whenever any returned field was not accepted on its own, a deterministic check
flagged the document, or the system suspected its parties were swapped; the signal used is published
with the panel. Evidence that carries confidence but records no decision at all, neither the document's nor any
field's, says nothing about routing: its documents are neither caught nor escaped, and a result resting on it has
no safety panel. A document with no confidence at all, which nothing vouches for, counts as sent to a person.

**The critical error budget**, declared before the run: a document has a critical error when any of
its critical fields is wrong, missing or invented, when its row count is not exact, or when its type is
wrong. A document whose full lane failed counts as an escaped critical error. The critical fields, by
type, as `aidp-bench/bench/budgets.mjs` selects them from each type's contract:

| Type | Header fields | Every row |
|---|---|---|
| Invoice, credit note | Buyer Name, Seller Name; Invoice Details: Invoice Number, Invoice Date, Due Date, Currency Code, Net Amount, Total Tax, Total Amount, Purchase Order Number; Payment Details: Tax Amount, Total | Items: Article ID, Quantity, Unit Price, Net Amount |
| Purchase order | Buyer Name, Seller Name; Order Details: PO Number, PO Date, Due Date, Currency Code, Net Amount, Total Amount; Payment Details: Subtotal, Total | Items: Article ID, Quantity, Unit Price, Net Amount |
| Freight invoice | Buyer Name, Seller Name; Invoice Details: Invoice Number, Invoice Date, Due Date, Currency Code, Net Amount, Total Tax, Total Amount | none |
| Consignment order, consignment invoice | Buyer Name, Seller Name; Consignment Details: Consignment Number, Consignment Date, Currency Code; Payment Details: Subtotal, Total | Items: Article ID, Quantity, Unit Price, Net Amount |

The number of values the budget looks at is published with the panel.

The three numbers are published together, with their denominators, because each alone is trivially
moved: a system that routes every document to a person catches everything and automates nothing, and
a system that routes nothing has no false alarms.

### 7.2 Calibration

Computed offline from the confidence the system attached to each value, on one set: every value the
system returned in a header field (line items excluded) of a field-key document in the full lane, that
carries a confidence, and that the answer key can judge (right, wrong or invented). Three numbers on
that same set:

- **Expected calibration error**, over ten equal-width confidence bins: the size-weighted average gap
  between each bin's mean confidence and the share of its values actually right.
- **Discrimination**, the area under the ROC curve: the chance that a randomly chosen right value
  carries a higher confidence than a randomly chosen wrong one. 0.5 is a coin flip.
- **The share of values in the system's high confidence tier.**

Returned header values that carry no confidence are counted and published beside the result. On AIDP-CAP the first two
are score-bearing (section 5.8), with a value carrying no confidence taken as fully confident.

### 7.3 Barcodes and facts

- **Barcode symbol recall**, pooled over payloads: of the barcode payloads printed in the corpus, the
  share whose exact string the system recovered.
- **Fact recall** for each fact-key document type: of the facts the answer key requires, the share
  found in the output. A numeric fact is found only where a delivered value parses to exactly the same
  number. Fact-key documents enter the Read measures like every other document.

### 7.4 Written instructions

On a pre-declared sample of documents, each document is extracted once per applicable rule pack, with
a plain written instruction whose correct outcome can be computed from the answer key. **Adherence** is
the share of the rule's targets that changed as instructed. **Containment** is one minus the share of
other fields that changed against the same document extracted with no instruction. They are published
together, because a rule engine that changes whatever it likes scores well on adherence alone. The
no-instruction baseline is itself a separate extraction, so containment is an upper bound on damage
and is read beside the repeatability figure.

### 7.5 Computation, resolution and diagnostics

- **Computation**: derivation precision (derived values that match the key where the key can judge
  them), recall (planted omitted values that were derived) and attribution (derivations that state
  their method, inputs and reason).
- **Resolution** has no figure in this edition: AIDP-2K holds no customer reference records. The collected corpus
  (section 8.2) shows how often names and addresses are corrected, and a public supplier list will make Resolution
  measurable on the generated corpus.
- **Identification over all ten types**, beside the six-type score-bearing figure.

### 7.6 The registry: score-bearing and diagnostic

The set of measures the score is computed over is declared before the run and published with the
result. Everything else the harness computes is diagnostic and is listed with its reason. Four reasons
are recognised: the measure cannot fail in practice; the measure is known to mis-score a class of
system by construction; the measure's evidence is too thin or rests on a drifting baseline; or the
measure is published beside the score by design.

| Diagnostic | Reason |
|---|---|
| Decoding, payload syntax; Contract against the published contract; Traceability, provenance | each tests its capability only in part; AIDP-CAP measures the three in full (section 5) |
| The reference run's calibration, barcode recall, written instructions and computation | declared beside the score before that run; AIDP-CAP's measures of the same capabilities are score-bearing |
| The six figures computed after the reference run (intake, stamps, reading order, legibility, parsing, duplicates) | defined after that run, on outputs already stored; AIDP-CAP measures the same capabilities as declared before its own run |
| Escalation, verification ran | it records only that some deterministic check ran on a document, never whether the check was right; Escalation is the safety panel |
| Character error rate | it penalises correct content emitted in a different reading order |
| The rest of section 7 | published beside the score by design (the safety panel only for a result that claims documents can proceed without a person) |

A measure becomes score-bearing only by being declared before a run, never by promotion after results
are known.

---

## 8. Evidence

### 8.1 Two corpora, because each is blind where the other sees

**A generated corpus** proves what only construction can prove. Its answer keys are written first and
its documents rendered from them, so a value the system returns in a field the key leaves empty was
provably not printed for that field (section 8.3). Invention, completeness against a full key, and behaviour on planted defects are
measurable only this way. The key also holds each value in standard form while the page prints it in
local form: the key stores 23/05/2026 where a German page prints 23.05.2026, and DE where the page
prints only "Germany". The difference between the two is exactly the conversion the system is asked
to perform.

**A collected corpus** proves what only the world can prove: how the system behaves on the documents
real customers send, checked by people. A benchmark that is generated end to end can be tuned to its
own generator, so the collected corpus is the counterweight.

### 8.2 The reference corpora

**AIDP-2K** is generated: 2,000 documents, ten document types with 200 of each, twelve locales, one
published seed (`docupath-corpus-v1`). The ten types are invoice, purchase order, credit note,
receipt, quote, freight invoice, consignment order, consignment invoice, bank statement and general
contract. The corpus is regenerated from the seed with the current generator and the field definitions
frozen in `aidp-bench/corpus-gen/schema-snapshot.json`; any difference against earlier answer keys is recorded
and published.

**AIDP-CAP** is generated: the capability set, 960 documents of the six field-key types with 160 of each, drawn
by AIDP-2K's builders (the same twelve locales and four noise levels) from a seed taken from public randomness
after the set was registered (Annex B). Each capability AIDP-2K does not measure has its condition, present in a
minority of documents so the rest are its controls: further files arriving with a document, a page scanned upside
down, handwritten notes, stamps, signatures and ticks, values hidden under an ink blot or a label, values the page
implies but does not print, printed contradictions, barcode labels on consignment lines, suppliers written in
several forms, documents that should be stopped (a duplicate, a changed bank account, a price above the purchase
order, an amount far above the supplier's usual), and files holding several documents. It is published with the
customer's supplier list and bank master, the maps of where every value is printed, and its generator
(`aidp-bench/corpus-gen/cap/`); `aidp-bench/corpus-cap/README.md` describes it.

**AIDP-Field** is collected: the dated snapshot of 28 August 2026, 1,490 measurable documents reviewed
by people. Every figure from the collected corpus comes from that one snapshot. Its documents cannot be
published. The figures published from it are all-account totals, each with a plain description of how it
was computed. No customer name, document or value is published.

### 8.3 The answer key holds what the page prints

**Every value the page prints is held by the answer key, in the field the output contract defines
for it.** A value printed on the page but left out of the key would turn a correct reading into an
invention, so this is checked rather than assumed: the generator's model of each page is compared
with its key, every printed value is accounted for, and the result is published with the corpus.

- Where the contract defines a field for a printed value, the key holds the value in that field: a
  person printed under "Your Reference" is the contact name where the contract says so; a printed
  "Due Date" is the payment due date, never a delivery date; a total printed on a document whose
  header has no total field sits in the field the contract names for it.
- The key is written in the contract's names and shapes: a table the response returns under another
  name carries that name, and a section the response returns as a list of rows is a list of rows in
  the key, one row for each the page prints.
- Where the contract mandates a value the page implies, such as the buyer's address standing in for a
  shipping address that is not printed, the key holds the mandated value.
- A printed value for which the contract has no field (a bank's name, for example) cannot be returned
  in a contracted field, and is listed rather than keyed.

Corrections made under this rule are made before a run, are listed with the number of documents and
values they touch, and never change a page: the rendered files and their text stay byte-identical.

### 8.4 Absence must be provable

Completeness, Restraint and Computation need to tell a value the document carries from one it does
not. A corpus labelled by people cannot prove absence, because a labeller records what they found and
cannot certify what a page does not say. Two constructions satisfy this standard: generated with the
answer key first, as above, or labelled with explicit absence, every field of the schema recorded as
present or verifiably absent and checked independently. A result states which it used.

### 8.5 Planted defects and clean controls

The generated corpus carries planted defects at known locations (a printed total that disagrees with
its lines, an omitted total, a barcode sticker that contradicts its printed line) and clean controls
that resemble them without the defect. The counts of both are published, because a false-alarm rate
measured on few controls, or a catch rate on few defects, carries a wide range.

### 8.6 Reproducibility

A generated corpus is published as its generator, seed and generator settings at a pinned commit; the
rendered files regenerate from them. The answer keys a run was scored against are published with the raw evidence,
so anyone can regenerate the corpus and compare.

---

## 9. Running a benchmark

1. **Every document, both lanes.** Every document of the corpus runs in the full lane and in the text
   lane. No lane is ever dropped.
2. **Retries are for transport, never for answers.** A request that fails before an answer arrives (no
   connection, a timeout, the service busy or failing) is retried. A response that arrived is never
   retried because of what it contains.
3. **Failures are scored, not excluded.** A lane still failing after the retry limit scores as a total
   failure in every measure (section 5.7), and is listed in the run's record.
4. **No correction after the run.** No output is changed after it was returned, by any means. Publication may
   replace names, remove token counts, replace error texts and omit the system's review decisions, as Annex B
   records; none of that changes a score.
5. **Repeatability on a pre-declared sample.** 20 documents of each type, chosen at random by a fixed
   seed and committed before the run, each submitted three times in the full lane with the extraction
   cache bypassed. The number of repeats is published, and so is how often a stored page reading was reused.
6. **Written instructions on a pre-declared sample.** 10 documents of each field-key type, chosen and
   committed the same way.
7. **The system under test is stated exactly**: its version, where it ran, and the configuration it
   ran with.
8. **The run records itself.** When it starts, the documents it plans to run; when it ends, its
   counts, its permanent failures and its timings.
9. **AIDP-CAP runs in phases, as one customer's account.** The full lane carries the customer's setup (section
   5.8). The documents that refer to earlier ones (a copy sent twice, an invoice against its purchase order, a
   supplier's later invoice) run in a second phase, after the first has finished. Files holding several documents
   go to the system's splitting step; the contract sample runs again under the customer's contract; the
   instructions sample runs in the text lane. Value locations and matching verdicts are collected when every lane
   is in (`aidp-bench/bench/run-cap.mjs`).

---

## 10. Statistics

Every score, layer score and measure is published with a 95 per cent bootstrap range: 2,000
resamples with a fixed seed, documents resampled with replacement within their
document type, so each resample keeps the corpus's composition and only the documents inside each type
vary. The repeatability documents are resampled the same way from their own sample. AIDP-CAP is resampled by
owner: each document, each copy sent twice and each file holding several documents is drawn with replacement within
its type (files within a stratum of their own), and a drawn owner brings every unit it carries, in every measure, so
the measures move together as they would on another draw of documents. AIDP-CAP and AIDP-2K are resampled side by
side and the score is recomputed from both on every resample (`score-cap.mjs`, seed `aidp-v1.0-cap-bootstrap`). Every
figure resting on a small sample states the number of documents behind it.

---

## 11. Reporting profiles

Accuracy is not one number but the peak of a surface. A result reports its measures across these
profiles, so a buyer whose documents sit away from the peak can see which way the surface falls.

| Profile | Bands |
|---|---|
| Difficulty | clean (a digital render or high-quality scan), degraded (visible scan artefacts, skew, overlays), hostile (heavy degradation, folds, stains, occluding stickers) |
| Rows per document | 1 to 10, 11 to 100, 101 to 500 |
| Locale | each locale separately |
| Lane | full lane against text lane |

---

## 12. Conformance

A result that claims to follow this standard states:

1. The standard and version: AIDP v1.0.
2. Both corpora: the generated corpus's construction, size, seed, generator commit and generator settings;
   the collected corpus's snapshot date, size, population definition and how its aggregates were computed.
3. The register: every capability as score-bearing, beside the score, not yet scored, or not yet measured.
4. The AIDP Score, every layer score, and every score-bearing measure with its unit, its denominator
   and its value for each document type, each with its 95 per cent range.
5. For a result that claims documents can proceed without a person, the safety panel with its
   denominators, by document type, and the routing signal it used.
6. Fact recall, and the diagnostics of section 7.6, with their denominators.
7. The critical error budget in full, and the counts of planted defects and clean controls.
8. The repeatability protocol: sample, seed, repeats, and how the cache was bypassed.
9. Every failure: lanes that failed, documents misclassified, and how each was scored.
10. Every exclusion: a field, a section or a document class left out of scoring, and why.
11. The system under test exactly, and the dates of the run.
12. Where the raw per-document evidence can be obtained and re-scored.

A result missing any of these does not conform. A result missing item 12 is a claim rather than a
measurement.

---

## 13. What this standard does not do

It does not define a passing score: the threshold depends on what the output is used for, and a
system posting payments needs a different escaped-error rate from one filling a search index. It does
not measure cost, speed, deployment or security. It does not rank vendors; it defines what a vendor
would have to publish for a ranking to mean anything, and a vendor's published figures can be placed
on the five layers by anyone, the empty layers included.

---

## Annex A. Disclosure: Learning

Learning asks whether a person's correction becomes permanent knowledge, so the same fix is never
needed twice. It needs observation over time: following a deployed system through real documents, or a sequential
dataset that presents corrections and then related documents in order. A fixed generated or collected corpus
cannot measure it. It therefore sits outside the register and
never contributes to a score. A result may report it, for example as the rate at which previously
corrected values need correcting again, and must then state the period over which the system was
observed.

## Annex B. The pre-registered runs

The reference implementation of this standard is the AIDP-Bench harness in this repository, run against the
Docupath platform.

### Fixed before the run

These choices were fixed and committed before the run:

- **Corpus**: all 2,000 documents of AIDP-2K, regenerated from seed `docupath-corpus-v1` with the
  current generator and the field definitions now frozen in `aidp-bench/corpus-gen/schema-snapshot.json`;
  differences against earlier answer keys recorded and published.
- **Answer-key corrections under section 8.3**, made before the run, with every rendered page and its
  text verified byte-identical before and after (1,200 answer keys rewritten, no page changed; every
  changed value is counted in `aidp-bench/corpus-key-corrections.json`):
  - consignment orders and consignment invoices (200 each): Consignment Details Contact Name holds the
    person printed under "Your Reference"; Payment Due Date holds the printed "Due Date", and Delivery
    Date stays empty, since no delivery date is printed; Payment Details Subtotal and Total hold the
    printed subtotal and total, which the consignment contract calls "the only field a consignment
    document has for that amount";
  - purchase orders (200): Order Details Contact Name holds the person printed under "Your Reference",
    which the purchase-order contract defines as the contact name on a supplier-authored form; Payment
    Methods is a list of rows, as the contract returns it, with one row for the printed IBAN and BIC and
    the method the contract mandates for an IBAN ("IBAN");
  - invoices and credit notes (200 each): Payment Details Payment Methods holds the printed IBAN and
    BIC in the contract's list form, with the method "IBAN" the contract mandates, in place of the bare
    label "IBAN"; Shipping Details holds the buyer's address, as both contracts mandate when no ship-to
    address is printed;
  - freight invoices (200): the key carries the contract's tables under the contract's names (Freight
    Shipments, Ship From, Ship To, Departure Location, Arrival Location, Line Containers, Line Charges,
    Invoice Containers, Invoice Charges, Payment Methods, Tax) and holds the printed shipment: its
    reference, both bills of lading, the vessel name and voyage number, the origin and destination as
    printed with their country codes and cities, its containers, its four charges (description, amount,
    and the description as the code, since no code is printed) and the tax line; the links the
    response's projection assigns to every shipment's rows (SF1, ST1, DL1, AL1, S1-N1, S1-C1) are keyed
    too; the shipment is an ocean shipment (bills of lading, a vessel, an "Ocean Freight" charge);
    Seller Registration No holds the printed registration number (89 documents); the three note lines
    of the freight schema listing no longer become empty sections; amounts in a locale printing no
    decimals are held as printed (11 documents);
  - one Japanese credit note: a negative amount is held rounded exactly as printed.
- **Printed values with no field in the contract, listed and not keyed**: bank names; buyers'
  registration numbers; the purchase order's seller VAT number; the IBAN and BIC on consignment
  documents, whose contract holds only a method label; line position numbers on consignment rows; the
  Japanese registration number printed for a buyer, which the generator does not treat as a VAT
  number; on freight invoices, the "Shipment" column of the charges table, which repeats the shipment
  reference the charge already belongs to; barcode payloads, which are scored under Barcodes.
- **Amendments fixed before the run**: (1) Contract is checked against the contracted output schema of each type
  (`contract.json`, written beside the answer keys), not against the answer key's
  structure, and the freight answer keys use the contract's table names and hold the printed shipment data; (2) a
  convention-only error (a date in another order, a separator confusion) is Normalisation's alone and leaves Fidelity's
  count; (3) Restraint counts an invented value whether or not it is labelled as derived; (4) the critical error budget
  includes Total Tax, PO Date, Consignment Number and Consignment Date; (5) in Printed text, numbers, the gap between
  two table columns ends a number (the definition in section 5.2): each document's own correct text, with nothing
  changed but its tables laid out as space-aligned columns, scores 100 per cent under this rule and 74.94 per cent
  under a pattern that lets any run of separators join digits (`aidp-bench/bench/layout-check.mjs`); (6) barcode recall
  reads a payment QR payload whole, not by its first line; (7) the REF- instruction targets the document's own number,
  rebuilt from the answer key at scoring time; (8) the safe-handling rate (section 7.1) is quoted beside the AIDP Score
  wherever the score is quoted (its scope narrowed after the run: see "Decided after the run"); (9) the
  production-weighted figure is withdrawn, so the score rests on the published corpus alone. The score-bearing
  measures are sixteen.
- **Lanes**: every document in the full lane and the text lane, retried until it succeeds, never
  dropped; a document still failing after the retry limit scored as a total failure.
- **Platform under test**: Docupath release `5bd21304` (23 October 2026), on a dedicated instance with the production
  service's configuration flags and a new, clean account, both recorded in the run's metadata (the flags by their
  SHA-256).
- **Repeatability sample**: `aidp-bench/bench/samples/stability-v1.json`, seed `aidp-v1.0-stability`,
  20 documents per type, 200 in all, three runs each, extraction cache bypassed.
- **Instructions sample**: `aidp-bench/bench/samples/rules-v1.json`, seed `aidp-v1.0-rules`, 10
  documents per field-key type, 60 in all.
- **Weighting**: one, read from the corpus: each of the six field-key document types counts equally
  (section 6.2). No production data enters the score.
- **Timing record**: the scoring rules took their final form in commit e431a6d (22:21:30 IST, 22 October 2026), after
  the pre-run amendment in commit 908e4b6 (01:59:55 IST, 22 October), both in Docupath's private development
  repository; no score-bearing rule changed after that, and the changes made after the run to how the scorer reads
  evidence without review decisions, listed under "Decided after the run", change no score. The next edition will
  place such records with an independent party.
- **Runner**: a request the platform answers with "still processing" is collected again after the
  wait the platform names, without counting as a failure; other transport failures are retried with
  backoff; lanes still failing are re-queued round after round; whatever fails after the last round is
  scored as a total failure.
- **Statistics**: 2,000 bootstrap resamples, seed `aidp-v1.0-bootstrap`, within document type.
- **Scoring**: `aidp-bench/bench/` as committed with this file, with the later changes listed under "Decided after the
  run", none of which changes a score. The result is reported whatever it is.

### Record of the run

- **When**: the run's first request was sent at 13:19 IST on 23 October 2026, and the run completed at 01:31 IST on
  24 October.
- **Pauses**: the run was paused twice, at 22:21 and 23:24 IST on 23 October, and resumed; after each pause only the
  document runs without a stored answer were sent again, and no answer was replaced.
- **A period without answers**: from 14:54 to 18:07 IST on 23 October the test machine's own database stopped
  accepting connections and the platform returned no answers; the document runs in progress then were among those
  sent again after a pause (`aidp-bench/FINDINGS.md`, B15).

### Decided after the run

- **Reporting scope**, decided on 25 October 2026, after the run: this edition reports the AIDP Score and the
  measurements beside it, and makes no claim that documents can proceed without a person. Amendment (8), fixed
  before the run, therefore applies to results that make that claim: such a result quotes the safe-handling
  rate wherever it quotes the AIDP Score (section 7.1).
- **Evidence without review decisions**, decided on 25 October 2026, after the run: the scorer reads evidence that
  carries confidence but no review decision, neither the document's nor any field's, as saying nothing about routing
  (section 7.1). Such a document is counted as undecided beside the safety panel, never in it, and a run in which
  every document is undecided or failed has no panel (`aidp-bench/bench/scoring.mjs`, `reviewDecision` and
  `safetyPanel`; `score-das.mjs`, `scoreTrust`; `score-run.mjs`). A lane that failed is counted as failed, never as
  marked ready for approval, and the panel's unused reading by flags was removed. No score, layer or measure
  changed.
- **Generator settings**, added on 25 October 2026, after the run: `--valid-accounts` and `--due-dates-from-terms`
  (`aidp-bench/corpus-gen/data.mjs`, `GEN_OPTIONS`), both off by default, so the published seeds still reproduce the
  answer keys and page texts of AIDP-2K and of the held-out documents byte for byte; a corpus made with either
  records it in its manifest, and a held-out draw and a scoreboard made from that corpus carry the record on
  (`aidp-bench/FINDINGS.md`, B1 and B3).
- **Held-out check**, registered after the reference run ended and before its own seed existed: commit a6e7cbe,
  made at 11:31:47 and pushed at 11:31:51 IST on 24 October 2026
  (`aidp-bench/bench/samples/heldout-v1.json`): the same release, unchanged, on 300 documents generated from the
  randomness of drand round 6579746 (published at 12:00:00 IST on 24 October 2026) and drawn by the registered rule,
  every document in the full lane and 60 of them three times for Repeatability, under a new, clean account, scored by
  the same rules (`aidp-bench/corpus-heldout/README.md`).
- **Figures the paper computes beside the scoreboards**: `aidp-bench/bench/paper-checks.mjs`, written after the run,
  recomputes figures the scoreboards do not print, among them the held-out check's consignment ranges, from its own
  resampling, and what Traceability and the AIDP Score would be if returned values without an evidence entry counted
  as untraceable (`aidp-bench/FINDINGS.md`, B18). They change no score.
- **Value comparison**, corrected on 27 October 2026, after the run, when an independent review of the scoring code
  found that it did not do what section 5.1 says: a general rule compared any two values by their digits alone, as
  numbers, unless the key held three Latin letters in a row, so text holding digits passed on its digits (an Arabic
  street against its building number alone) and an account number lost its country code and every digit past the
  sixteenth. The comparison of digits alone now applies only to an identifier the key writes in digits, digit by digit
  (`aidp-bench/bench/base-score.mjs`, tested in `test-scoring.mjs`). Re-scoring the reference run moves 7 of 494,386
  captured values from right to wrong, in 5 documents: the AIDP Score, every layer and every measure keep their
  published values to two decimals, one end of one range moves (Fidelity's lower end, 95.93% to 95.92%), and the
  held-out check does not change. The published scoreboard, ranges and calibration of the reference run are the
  re-scored ones.
- **Value comparison, punctuation of every script**, corrected on 27 October 2026, after the capability run
  (correction 2 under "Decided after the capability run"): text is compared on letters and digits alone, as section 5.1
  says, setting aside the punctuation of every script and not only the Latin alphabet's. Re-scoring the reference run
  moves 1 captured value, in 1 document, from wrong to right: no published figure, range or calibration changes, and
  the held-out check does not change.
- **Diagnostics beside the score**: the six figures computed from the run's published outputs (`aidp-bench/bench/post-run/`)
  use measurements defined after the run, on outputs already stored. They change no score.
- **Publication**: the published evidence replaces two document-type names in the platform's catalogue, which name a
  customer and a contracting platform, with neutral labels; removes the token counts of each request; gives failed
  requests the text "no result returned"; and omits the platform's own review decisions: the decision
  recorded for each document with the record behind it, each field's accept flag, and each document's count and share
  of accepted fields. No score-bearing measure reads them, and this edition draws no claim from them; the confidence
  values and evidence entries, which Calibration and Traceability read, are published. None of this changes any score.

### The capability run (AIDP-CAP): fixed before its seed existed

These choices were fixed and pushed to this public repository before AIDP-CAP's seed existed, in the commit that
adds `aidp-bench/bench/samples/cap-v1.json`; GitHub records the push time. The result is reported whatever it is.

- **Release under test**: Docupath release `5bd21304`, the reference run's, unchanged, with the reference run's own
  environment files, the same models and the same page-reading service, on a dedicated instance. These settings
  differ, and only these: a new, empty database, a new folder for stored documents, and the key that reaches the
  model provider, because the reference run's has expired; and five limits on how long the release waits for its own
  steps and services (`V2_LAYOUT_OCR_TIMEOUT_MS` 600000, `V2_LAYOUT_OCR_BUDGET_MS` 1800000,
  `V2_BARCODE_SCAN_BUDGET_MS` 600000, `V2_GUDID_TIMEOUT_MS` 30000, `PG_POOL_CONNECT_MS` 60000), raised because the
  benchmark machine, shared with other work, is slower than production's, and the pilot (below) showed the production
  limits cutting work short on it; a step that finishes within production's limit gives the same result. The API runs
  as three processes of that one build behind a round-robin proxy, as production runs several replicas, with one
  worker, and a watchdog starts again any process that stops, as production's container service does. The configuration flags are the production service's
  switches as those environment files hold them, all 58 with the same values; their values name customers' accounts
  and are not published. The file that records them has the SHA-256
  `2faf9a856d4547e16cd8ac7e9b008fa605b7f1ebb7a51f1675cffd32314565ea`. The reference run fingerprinted a different file
  holding its flags, which was not kept, so the two fingerprints cannot be compared with each other.
- **Corpus**: AIDP-CAP (section 8.2), drawn by `aidp-bench/corpus-gen/cap/generate.mjs` through
  `aidp-bench/bench/make-cap.mjs` from the seed `aidp-cap-v1:` followed by the randomness of the drand round
  `samples/cap-v1.json` names, published after the push; the composition in `corpus-gen/cap/composition.mjs`.
- **The customer's setup**: `aidp-bench/bench/cap-customer.mjs`, and the customer's supplier list and bank master
  drawn with the corpus.
- **Lanes and phases**: `aidp-bench/bench/run-cap.mjs` (section 9, item 9), each lane under its own new account.
- **Measures**: the eighteen of section 5.8 (`aidp-bench/bench/score-cap.mjs`, tested by `test-score-cap.mjs`), and the
  AIDP Score over the thirty-one score-bearing measures, with AIDP-2K's thirteen taken from the reference run's
  published evidence. The three measures that tested their capabilities only in part become diagnostics.
- **Samples and controls**: the instructions sample (10 documents per type) and the contract sample (20 per type)
  are drawn with the corpus; the controls for contradictions, for every mark and for Intake are drawn by the rule in
  `score-cap.mjs`; every order comes from the SHA-256 of the seed, the purpose and the document's id.
- **Statistics**: 2,000 bootstrap resamples, seed `aidp-v1.0-cap-bootstrap` (section 10).
- **Before registration**: the harness and the scorer ran end to end against the release on nine AIDP-2K documents,
  already run and published, in AIDP-CAP's format. The generator was developed and tested on throwaway seeds, never
  the registered one: full draws of all 960 documents, the plan drawn for 30 further seeds, and two draws of one seed
  compared file by file. A pilot then ran the release, on a separate instance with its own database, on documents of the
  throwaway seed `pilot-seed-6` in every lane (115 documents and one copy in the full lane, 6 files to the splitting
  step), on 27 October 2026 between 00:17 and 01:36 IST, and
  an independent reviewer read the scorer and the generator against its evidence. What they found, every change made
  after them and its effect on the pilot's figures are published with the pilot's record in
  `aidp-bench/results/aidp-cap-pilot/`. The changes corrected the benchmark (its machine's time limits and the
  release's processes, scoring rules that misjudged correct or incorrect answers, the drawing of controls, and the
  generator), never a test the release failed: every failure of the release the pilot showed stays in the registered
  set. No AIDP-CAP document was shown to the release before its seed existed.

### Record of the capability run

- **Registration and draw**: the registration (commit b806fa2, `aidp-bench/bench/samples/cap-v1.json`) was pushed to
  this public repository at 09:55:48 IST on 27 October 2026, as GitHub records. Its seed is `aidp-cap-v1:` followed
  by the randomness of drand round 6588206, published at 10:30:00 IST and read at 10:30:02 IST
  (`aidp-bench/bench/samples/cap-v1-evidence/`). The corpus was drawn from that seed by the registered generator.
- **When**: the run's first request was sent at 10:51:13 IST on 27 October 2026, and its last lane completed at
  17:07:37 IST. Every lane records its sessions, each with its start, its end and whether it was interrupted
  (`run-meta.json` in each lane's results).
- **Pauses on the benchmark machine**: the run was stopped at 11:27 IST and resumed at 12:34 IST, and stopped again
  at 12:45 IST (the instruction lane at 12:58 IST), because other work on the shared benchmark machine, where the
  release ran as its own dedicated instance with its own database, folders and processes, had used up its memory (a load of up to 101 on
  its 8 cores, 8.4 of its 9.2 GB of swap in use), and 10 of the first 38 barcode scans had run into the raised
  600-second limit. The documents those 10 scans read are named in `aidp-bench/results/aidp-v1-cap/touched.txt`.
- **A change of machine**: the run's database, stored documents, corpus and answers were then copied to a dedicated
  cloud server (an AWS EC2 c8g.16xlarge, 64 Arm cores and 128 GB of memory, in eu-central-1), running the same
  release with the same environment files, the same models and the same page-reading service with its pinned
  packages, under the same folder paths. Every file of the corpus and every answer was compared by SHA-256 on both
  machines and found identical. The page-reading service read 12 pages at a time instead of 2, with the same 4
  threads for each page; its own notes say the number of pages read at once never changes an answer, and the number
  of threads, which can in principle, was kept. Before the run continued, both machines' page-reading services read
  the same 57 rendered pages of 25 documents: all 15,699 words and every line had the same text, 16 word boxes were
  one pixel apart and 16 word scores at most 0.0002 apart; and the server's barcode scanner read 24 documents exactly
  as the benchmark machine's complete scans had (`aidp-bench/results/aidp-v1-cap/machine-parity/`). The run resumed
  there at 13:24:53 IST.
- **The model provider's refusals**: from 14:08:29 IST the model provider refused calls because the run's account
  had run out of credits: until 14:24:32 IST it refused 865 calls and answered 771, and from then until the lanes were
  stopped at 14:50 IST it refused all 2,943. Credits were added, and the run resumed at 15:56 IST. The release records
  every refused call in its usage ledger, against its document, 3,808 in all. Requests that returned no answer were sent again, as transport failures are; the 114 answers
  that came back between 14:07 and 14:25 IST are kept, since an answer is never sent again for its content.
- **One other failed model call**: at 13:58:38 IST one call to the model timed out inside the release, which recorded
  it and continued; the document's answer, in the contract lane, passed all 616 of its checks.
- **Completion**: all 1,370 submissions completed with an answer: 990 in the full lane (960 documents and 30
  copies), 200 files to the splitting step, 60 documents in the text lane with their instructions, and 120 documents
  under the customer's contract. No request failed permanently.

### Decided after the capability run

- **Documents the run's own setup touched**, decided on 27 October 2026, after the run: a sensitivity figure, beside
  the score and never in it, leaves out every document a fault of the benchmark's own setup touched, in the lane where
  it happened: the 10 whose barcode scan ran into its limit on the overloaded machine, and every document with a model
  call refused for lack of credits (192 documents in all lanes). The list is `aidp-bench/results/aidp-v1-cap/touched.txt`,
  and `score-cap.mjs`'s per-document records recompute every measure without them. All 43 documents that Segmentation
  counts as not cut exactly lie in 15 files answered between 14:07 and 14:23 IST, each marked by the release as having
  no usable page descriptions.
- **Six corrections to the scoring code**, made on 27 October 2026, after the run. Reading the run's results against
  its documents, and three independent reviews of the scorer, each by a separate AI agent working apart from
  the author and given only the code and the same evidence, found six places where
  the scoring code did not do what this standard says. Each was corrected with a test that fails on the code as
  registered and passes on the corrected code (`test-score-cap.mjs`, `test-scoring.mjs`), and every measure was
  computed again from the stored answers; no document was sent to the release again. The effect given for each is what
  taking that one correction back out of the corrected code changes:
  1. **Numbers in Japanese and Chinese text** (section 5.8, Handwriting and stamps). The scorer split Japanese and
     Chinese text into single characters, digits included, so the count "10" in a note was compared as a "1" and a
     "0", which the page's other figures hold. A run of digits or Latin letters in such text now stays whole.
     Handwriting and stamps: 2 more marks read.
  2. **Punctuation of every script** (section 5.1: text is compared "on letters and digits alone"). The comparison set
     aside the punctuation of the Latin alphabet only, so an Arabic comma, or a dash outside that alphabet, still
     counted. It now sets aside the punctuation of every script. Parsing: 5 more parts in their own field; Calibration:
     one minus calibration error 96.20% instead of 96.23%, and discrimination 70.77% instead of 70.88%. On the
     reference run it moves 1 captured value, in 1 document, from wrong to right, and changes no published figure,
     range or calibration; the held-out check does not change.
  3. **The system's own words that it computed a value** (section 5.8, Computation and Traceability). A value the
     system marks as inferred, with its reason, and a line's field its derivation record names as derived without the
     line's number, where it does not claim that line's value was printed, now count as recorded as computed.
     Computation: 2 more values; Traceability: 2 more values.
  4. **Notes on right-to-left pages** (section 5.8, Handwriting and stamps). The generator draws a handwritten note one
     character at a time, so on an Arabic page each run of digits or Latin letters in a note is drawn reversed: the
     page shows "42" where the answer key holds "24". A note may now be read as the key writes it or as the page draws
     it. Handwriting and stamps: 1 more mark read.
  5. **Values the page prints after all** (section 5.8, Computation: "values the page implies but does not print").
     12 values the answer key holds as implied are printed on their page as another figure: on 11 documents of one
     line, the line amount and the subtotal are one figure, which the page prints as one of them, and on 1 line of
     quantity one the line amount is the unit price. They are read, not computed, and leave Computation and
     Traceability, which each count 12 values fewer, 5 of which had passed; Calibration still judges them. A value leaves when its
     figure appears anywhere on its page, so a coincidence, such as a date's parts, could take one out; in this run the
     12 are exactly the cases named.
  6. **The page's printed words** (section 5.8, Handwriting and stamps: "its reading less the page's own printed
     words"). Each printed word took out the first occurrence of itself in the reading, so where a handwritten note
     repeats a word the page prints further down ("Credit owed for line 2" above a table whose second row starts with
     2), the note's word was taken out and the printed one kept. Each printed word now takes out the occurrence that
     sits among the same neighbouring words as it does on the page, and the first of those where more than one does
     equally well. Handwriting and stamps: 6 more marks read.

  Together they move the AIDP Score from 82.75 (95% range 79.43 to 84.53) to 82.90 (79.57 to 84.67), and the Read
  layer from 96.93 to 97.01, the Understand layer from 55.59 to 55.93 and the Trust layer from 88.60 to 88.57. Each
  of the 21 handwritten notes still counted as not read was checked by eye against the system's reading: in each, the
  reading differs from the note by more than the rule allows. The scoreboard as registered, before these corrections,
  is published beside the corrected one, in `aidp-bench/results/aidp-v1-cap/as-registered/`.
- **The reading-order judge's own description**: the comment at the head of `post-run/reading-order.mjs` said a cell's
  punctuation is set aside; its code, as registered and as used, counts it (a cell read "4,304,97" for "4,304.97" is
  misread), and the comment now says so. No figure changes.
- **The registration's summary of the release**: the registration file's one-line summary (`release_under_test`)
  names three settings that differ from the reference run; the five raised time limits differ too. They were fixed and
  published in the same commit, in this annex and in the pilot's record, so nothing changed, but that summary sentence
  is incomplete.
- **Publication**: the published evidence follows the reference run's publication rules (above), with the name of the
  machine that ran each lane given as "<host>". In two records of the instruction lane, the two-decimal instruction on
  invoices 147 and 151, the platform's 88 notes on how it recovered that instruction internally are left out, with the
  internal flag each record carried, and one record's status, which named that step, reads "applied". No measure reads
  them, and both scoreboards re-score unchanged without them.
