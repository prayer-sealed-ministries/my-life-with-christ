/**
 * Files that are not what they are named.
 *
 * Every fixture here is built in code and is entirely fictional. None of them
 * is a real exploit: they are the *shapes* a wrong file arrives in — a renamed
 * executable, a ZIP wearing a Word name, a PDF with a payload stapled to the
 * end — because those shapes are what a type check either notices or does not.
 *
 * The rule being tested is one sentence: a name is a claim, and nothing is
 * handed to a parser until the bytes agree with it.
 */
import { describe, expect, it } from 'vitest';

import {
  classifyDocument,
  claimedKind,
  inspectDocxPackage,
  inspectPdfStructure,
  memberPathIsUnsafe,
  mimeKind,
  normaliseMemberPath,
  signatureOf,
  TYPE_MESSAGES,
} from './document-type';
import { makeDocx, pdf } from './fixtures';
import { createZip } from '../export/zip';

const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text);

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const REAL_PDF = () => bytes(pdf([['BT /F1 12 Tf (FICTIONAL-DOC one) Tj ET']]));

/** A PE executable, as far as its first bytes are concerned. */
const FAKE_EXE = () => {
  const out = new Uint8Array(512);
  out[0] = 0x4d; // M
  out[1] = 0x5a; // Z
  out.fill(0x41, 2);
  return out;
};

/** A legacy OLE compound file — what a real `.doc` starts with. */
const FAKE_OLE = () => {
  const out = new Uint8Array(512);
  out.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  return out;
};

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

describe('a name is only a claim', () => {
  it('reads what the extension asks for, and nothing more', () => {
    expect(claimedKind('sermon.pdf')).toBe('pdf');
    expect(claimedKind('SERMON.DOCX')).toBe('docx');
    expect(claimedKind('notes.txt')).toBe('txt');
    expect(claimedKind('sermon.exe')).toBe('unknown');
    // An ordinary name with several dots is not a trick.
    expect(claimedKind('2026.03.14 sermon notes.docx')).toBe('docx');
    // The last extension is the claim; a double extension cannot smuggle one.
    expect(claimedKind('sermon.pdf.exe')).toBe('unknown');
    expect(claimedKind('sermon.exe.pdf')).toBe('pdf');
  });

  it('reads signatures at offset zero and nowhere else', () => {
    expect(signatureOf(REAL_PDF())).toBe('pdf');
    expect(signatureOf(FAKE_EXE())).toBe('executable');
    expect(signatureOf(FAKE_OLE())).toBe('ole');
    // The whole polyglot idea: a PDF header that is not at the beginning.
    expect(signatureOf(concat(FAKE_EXE(), REAL_PDF()))).toBe('executable');
  });
});

describe('a name that is not what it looks like', () => {
  it('reduces a path to the name at the end of it', async () => {
    const { safeFilename } = await import('./limits');
    expect(safeFilename('C:\\\\Users\\\\fictional\\\\handout.pdf')).toBe('handout.pdf');
    expect(safeFilename('/tmp/fictional/handout.pdf')).toBe('handout.pdf');
    expect(safeFilename('../../fictional/handout.pdf')).toBe('handout.pdf');
  });

  it('strips what makes a name read differently from what it is', async () => {
    const { safeFilename } = await import('./limits');
    // A right-to-left override before a reversed extension: this displays as
    // "handoutfdp.exe" reversed into something ending .pdf, while being .exe.
    expect(safeFilename('handout\u202efdp.exe')).toBe('handoutfdp.exe');
    // Zero-width characters hiding inside an extension.
    expect(safeFilename('handout.p\u200bdf')).toBe('handout.pdf');
    expect(safeFilename('\ufeffhandout.pdf')).toBe('handout.pdf');
  });

  it('refuses a double extension whose last part is not one we read', () => {
    for (const name of ['sermon.pdf.exe', 'sermon.docx.exe', 'sermon.pdf.scr']) {
      expect(claimedKind(name), name).toBe('unknown');
    }
    // And an ordinary name with several dots is not a trick.
    expect(claimedKind('2026.03.14 handout.pdf')).toBe('pdf');
  });
});

describe('MIME is a hint, and only when it says something', () => {
  it('says nothing when it is absent, empty or generic', () => {
    expect(mimeKind(undefined)).toBeNull();
    expect(mimeKind('')).toBeNull();
    // The common case on a phone: a provider that declined to tell us.
    expect(mimeKind('application/octet-stream')).toBeNull();
    expect(mimeKind('something/unheard-of')).toBeNull();
  });

  it('is read when it is specific, parameters and case included', () => {
    expect(mimeKind('application/pdf')).toBe('pdf');
    expect(mimeKind('APPLICATION/PDF')).toBe('pdf');
    expect(mimeKind('text/plain; charset=utf-8')).toBe('txt');
    expect(mimeKind(DOCX_MIME)).toBe('docx');
  });

  it('does not refuse a good file because the provider said nothing', () => {
    const verdict = classifyDocument({
      name: 'sermon.pdf',
      bytes: REAL_PDF(),
      mimeType: 'application/octet-stream',
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.kind).toBe('pdf');
  });

  it('does not pick a fight inside the text family', () => {
    /*
      A `.json` handed over as `text/plain`, a `.md` as `text/plain`: both
      happen constantly, both are true statements about the bytes, and neither
      is evidence of deception. There is nothing to protect either — a text
      file is decoded as text whichever of those names it arrives under.

      This was found by the existing import tests rather than written from
      first principles: the first version of the rule demanded exact agreement
      and refused ordinary sermon-notes JSON.
    */
    for (const [name, mime] of [
      ['sermon.json', 'text/plain'],
      ['notes.md', 'text/plain'],
      ['notes.txt', 'text/markdown'],
    ]) {
      const verdict = classifyDocument({ name, bytes: bytes('FICTIONAL-DOC text'), mimeType: mime });
      expect(verdict.ok, `${name} as ${mime}`).toBe(true);
    }
  });

  it('refuses a specific type that disagrees with the name', () => {
    const verdict = classifyDocument({
      name: 'sermon.pdf',
      bytes: REAL_PDF(),
      mimeType: DOCX_MIME,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.rejection).toBe('type-mismatch');
  });
});

describe('PDF', () => {
  it('accepts an ordinary one', () => {
    expect(inspectPdfStructure(REAL_PDF()).ok).toBe(true);
  });

  it('refuses an executable wearing a PDF name', () => {
    const verdict = classifyDocument({ name: 'sermon.pdf', bytes: FAKE_EXE() });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toBe(TYPE_MESSAGES.pdfMismatch);
  });

  it('refuses a Word package wearing a PDF name', async () => {
    const docx = await makeDocx([{ text: 'FICTIONAL-DOC' }]);
    expect(classifyDocument({ name: 'sermon.pdf', bytes: docx }).ok).toBe(false);
  });

  it('refuses a header that is not at the beginning', () => {
    const polyglot = concat(FAKE_EXE(), REAL_PDF());
    expect(classifyDocument({ name: 'sermon.pdf', bytes: polyglot }).ok).toBe(false);
  });

  it('refuses a payload stapled after the final marker', () => {
    for (const tail of [FAKE_EXE(), bytes('<html><script>alert(1)</script></html>'), bytes('<?php system($_GET[0]); ?>')]) {
      const stapled = concat(REAL_PDF(), tail);
      const verdict = classifyDocument({ name: 'sermon.pdf', bytes: stapled });
      expect(verdict.ok, `tail of ${tail.length} bytes was accepted`).toBe(false);
    }
  });

  it('allows the whitespace a writer legitimately ends with', () => {
    expect(classifyDocument({ name: 'sermon.pdf', bytes: concat(REAL_PDF(), bytes('\n\r\n  ')) }).ok).toBe(true);
  });

  it('keeps working for a document that was edited and re-saved', () => {
    /*
      An incremental update appends a second body and a second `%%EOF`. It is
      an ordinary thing for a handout that has been corrected, and it must not
      read as an appended payload — which is why the LAST marker is the one
      that counts rather than the first.
    */
    const once = REAL_PDF();
    const again = concat(once, bytes('\n2 0 obj\n<< >>\nendobj\nstartxref\n0\n%%EOF\n'));
    expect(classifyDocument({ name: 'sermon.pdf', bytes: again }).ok).toBe(true);
  });

  it('refuses a truncated document', () => {
    const whole = REAL_PDF();
    const cut = whole.subarray(0, Math.floor(whole.length / 2));
    const verdict = classifyDocument({ name: 'sermon.pdf', bytes: cut });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toBe(TYPE_MESSAGES.damaged);
  });

  it('refuses a disguised file on its own, without relying on the caller', () => {
    /*
      `classifyDocument` checks the signature too, so this fixture is refused
      twice over. Calling the structural check directly is the point: mutation
      testing showed that removing its own signature check broke nothing,
      because the outer gate was quietly doing the work. A check nothing can
      fail is not a check.
    */
    expect(inspectPdfStructure(FAKE_EXE()).ok).toBe(false);
    expect(inspectPdfStructure(bytes('PK\u0003\u0004 not a pdf')).ok).toBe(false);

    /*
      And specifically a file arranged so that the bytes at the version offset
      read like a version, while the header does not. Without a real signature
      check, a reader that looked only where the version lives would call this
      a PDF 1.4 — the header and the version are two different claims, and both
      have to be in the right place.
    */
    const faked = concat(bytes('MZABC1.4'), REAL_PDF().subarray(8));
    expect(inspectPdfStructure(faked).ok).toBe(false);
  });

  it('refuses a version this build does not claim to read', () => {
    const odd = REAL_PDF();
    odd[5] = 0x39; // "9" — %PDF-9.4
    expect(classifyDocument({ name: 'sermon.pdf', bytes: odd }).ok).toBe(false);
  });
});

describe('DOCX is a package, not a zip', () => {
  it('accepts a real Word package', async () => {
    const docx = await makeDocx([{ text: 'FICTIONAL-DOC church handout' }]);
    expect(classifyDocument({ name: 'handout.docx', bytes: docx }).ok).toBe(true);
    expect((await inspectDocxPackage(docx)).ok).toBe(true);
  });

  it('refuses a legacy .doc renamed', () => {
    const verdict = classifyDocument({ name: 'handout.docx', bytes: FAKE_OLE() });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toBe(TYPE_MESSAGES.docxMismatch);
  });

  it('refuses an executable and a PDF wearing a Word name', async () => {
    expect(classifyDocument({ name: 'handout.docx', bytes: FAKE_EXE() }).ok).toBe(false);
    expect(classifyDocument({ name: 'handout.docx', bytes: REAL_PDF() }).ok).toBe(false);
  });

  it('refuses a zip that merely contains a document body', async () => {
    // The thing anybody can build in a minute, and the reason requiring
    // word/document.xml alone was never enough.
    const zip = await createZip([{ path: 'word/document.xml', content: '<w:document/>' }]);
    expect((await inspectDocxPackage(zip)).ok).toBe(false);
  });

  it('refuses a package with no content types, and one with no root relationships', async () => {
    const noTypes = await makeDocx([{ text: 'FICTIONAL-DOC' }], [], { omit: ['[Content_Types].xml'] });
    const noRels = await makeDocx([{ text: 'FICTIONAL-DOC' }], [], { omit: ['_rels/.rels'] });
    expect((await inspectDocxPackage(noTypes)).ok).toBe(false);
    expect((await inspectDocxPackage(noRels)).ok).toBe(false);
  });

  it('refuses a package whose main part claims to be something else', async () => {
    const wrong = await makeDocx([{ text: 'FICTIONAL-DOC' }], [], {
      replace: {
        '[Content_Types].xml':
          '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.ms-excel.sheet.main+xml"/></Types>',
      },
    });
    const verdict = await inspectDocxPackage(wrong);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toBe(TYPE_MESSAGES.docxMismatch);
  });

  it('refuses a macro-enabled document, whichever way it says so', async () => {
    const byContentType = await makeDocx([{ text: 'FICTIONAL-DOC' }], [], {
      replace: {
        '[Content_Types].xml':
          '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>',
      },
    });
    const byMember = await makeDocx(
      [{ text: 'FICTIONAL-DOC' }],
      [{ path: 'word/vbaProject.bin', content: 'FICTIONAL-DOC not a real macro' }],
    );

    for (const file of [byContentType, byMember]) {
      const verdict = await inspectDocxPackage(file);
      expect(verdict.ok).toBe(false);
      expect(verdict.rejection).toBe('unsupported-feature');
      // Wording that tells somebody what to do, and does not call them names.
      expect(verdict.message).toBe(TYPE_MESSAGES.macroWord);
      expect(verdict.message).not.toMatch(/malware|virus|malicious/i);
    }
  });

  it('refuses a package that declares a macro part anywhere in its content types', async () => {
    /*
      The main part here is an ordinary Word document, so the main-type check
      passes. What gives it away is that the package also declares a macro
      project part — which is how a macro-enabled document describes itself
      when somebody has renamed the file and tidied the obvious giveaway.
    */
    const sneaky = await makeDocx([{ text: 'FICTIONAL-DOC' }], [], {
      replace: {
        '[Content_Types].xml':
          '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/project.bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>',
      },
    });
    const verdict = await inspectDocxPackage(sneaky);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toBe(TYPE_MESSAGES.macroWord);
  });

  it('refuses a root relationship that points somewhere else', async () => {
    const elsewhere = await makeDocx([{ text: 'FICTIONAL-DOC' }], [], {
      replace: {
        '_rels/.rels':
          '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/other.xml"/></Relationships>',
      },
    });
    expect((await inspectDocxPackage(elsewhere)).ok).toBe(false);
  });

  it('refuses a package that starts somewhere on the network', async () => {
    const external = await makeDocx([{ text: 'FICTIONAL-DOC' }], [], {
      replace: {
        '_rels/.rels':
          '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ' +
          'Target="https://fictional.invalid/document.xml" TargetMode="External"/></Relationships>',
      },
    });
    expect((await inspectDocxPackage(external)).ok).toBe(false);
  });

  it('refuses a document type declaration in a structural part', async () => {
    const doctyped = await makeDocx([{ text: 'FICTIONAL-DOC' }], [], {
      replace: {
        '[Content_Types].xml':
          '<?xml version="1.0"?><!DOCTYPE Types [<!ENTITY x "y">]><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      },
    });
    const verdict = await inspectDocxPackage(doctyped);
    expect(verdict.ok).toBe(false);
    expect(verdict.rejection).toBe('unsupported-feature');
  });

  it('keeps reading a document with ribbon customisation but no macros', async () => {
    /*
      Ribbon XML describes buttons. It carries nothing executable, and with no
      macro project there is nothing for a button to call. Refusing it would
      also mean telling somebody to "save a copy without macros" when there
      were none — advice they cannot act on.
    */
    const ribbon = await makeDocx(
      [{ text: 'FICTIONAL-DOC handout' }],
      [{ path: 'customUI/customUI.xml', content: '<customUI xmlns="http://fictional.invalid/ui"/>' }],
    );
    expect((await inspectDocxPackage(ribbon)).ok).toBe(true);
  });

  it('still refuses the macro project itself, alongside ribbon XML', async () => {
    const both = await makeDocx(
      [{ text: 'FICTIONAL-DOC handout' }],
      [
        { path: 'customUI/customUI.xml', content: '<customUI/>' },
        { path: 'word/vbaProject.bin', content: 'FICTIONAL-DOC not a real macro' },
      ],
    );
    expect((await inspectDocxPackage(both)).ok).toBe(false);
  });

  it('keeps reading a document that merely contains a picture', async () => {
    // Church handouts are full of logos. The text parser never opens them, and
    // refusing them would refuse the documents this feature exists for.
    const withImage = await makeDocx(
      [{ text: 'FICTIONAL-DOC with a logo' }],
      [{ path: 'word/media/image1.png', content: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) }],
    );
    expect((await inspectDocxPackage(withImage)).ok).toBe(true);
  });
});

describe('package member names', () => {
  it('normalises the spellings that would otherwise be different members', () => {
    expect(normaliseMemberPath('word/./document.xml')).toBe('word/document.xml');
    expect(normaliseMemberPath('WORD\\DOCUMENT.XML')).toBe('word/document.xml');
  });

  it('refuses the names no package has a reason to carry', () => {
    for (const path of ['../evil', '/absolute/evil', 'C:\\evil', 'word/../../evil']) {
      expect(memberPathIsUnsafe(path), path).toBe(true);
    }
    expect(memberPathIsUnsafe('word/media/image1.png')).toBe(false);
    expect(memberPathIsUnsafe('[Content_Types].xml')).toBe(false);
  });

  it('refuses a package carrying a traversing member', async () => {
    const traversal = await makeDocx([{ text: 'FICTIONAL-DOC' }], [
      { path: '../escaped.xml', content: '<x/>' },
    ]);
    expect((await inspectDocxPackage(traversal)).ok).toBe(false);
  });
});

describe('the classifier catches what a parser would not', () => {
  it('refuses a readable PDF with a payload stapled to it, before parsing', async () => {
    /*
      This is the case that justifies the whole layer.

      pdf.js opens this file perfectly well: the document in front of the
      appended bytes is valid, and a parser's job is to read what it can, not
      to police what came with it. So every downstream check passes and the
      import would succeed — carrying an executable's worth of bytes that
      nobody looked at, inside a file the app had just declared readable.

      Only the type check refuses it, which is why it must run first rather
      than being left to the parser to notice.
    */
    const { parseDocument } = await import('./candidates');
    const stapled = concat(REAL_PDF(), FAKE_EXE());

    // The parser alone is content. It gets a copy: pdf.js transfers the
    // buffer it is given to its worker, which detaches it — the probe would
    // otherwise hand an empty array to the import below and prove nothing.
    const { parsePdf } = await import('./pdf');
    const extraction = await parsePdf(stapled.slice());
    expect(extraction.pages.length).toBeGreaterThan(0);

    // The import is not.
    await expect(parseDocument(stapled, 'sermon.pdf')).rejects.toThrow(
      /named as a PDF, but its contents are not a supported PDF/i,
    );
  });

  it('refuses a real Word document whose declared type says PDF', async () => {
    const { parseDocument } = await import('./candidates');
    const docx = await makeDocx([{ text: 'FICTIONAL-DOC handout' }]);
    // Nothing downstream would notice: the package is genuinely a Word
    // document and parses cleanly. The disagreement is the finding.
    await expect(parseDocument(docx, 'handout.docx', 'application/pdf')).rejects.toThrow(
      /do not agree|not a supported/i,
    );
  });
});
