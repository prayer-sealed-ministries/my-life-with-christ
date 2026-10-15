import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Scan notes reads a page on the device, or says it could not.
 *
 * This is the gate on that sentence. The feature photographs somebody's
 * notebook and turns it into text, which makes it the most sensitive thing in
 * the application: a cloud recogniser would be a few lines of code, would
 * measurably improve accuracy on bad handwriting, and would quietly break the
 * one promise the product makes. That is exactly the shape of change a test has
 * to stand in front of, because in review it would look like an improvement.
 *
 * Three things make these assertions more than decoration:
 *
 *   - Every source is read by path and must clear a floor. A renamed or deleted
 *     plugin fails this file rather than passing it by having nothing left to
 *     search.
 *   - Each file must contain a sentinel proving the search reached real
 *     content, rather than an empty string or the wrong file.
 *   - The forbidden list names services, not generic words, so what was
 *     considered and rejected is on the record.
 *
 * What this file cannot prove is that the engines themselves are offline. That
 * is what `ScanNotesBundledModelTest` does on Android — recognising a page on a
 * device holding no network permission at all — and what the absence of any
 * NSURLSession reference in ScanNotesPlugin.o shows on iOS.
 */

const root = resolve(process.cwd());
const read = (path) => readFileSync(join(root, path), 'utf8');

/**
 * The same text with comments blanked and line numbers preserved.
 *
 * Every one of these files talks at length about what it deliberately does not
 * do, so a search that cannot tell prose from code either fails on its own
 * documentation or has to guess from the wording of a sentence. The first
 * version of this file guessed, and the guess was wrong on the very first
 * line: a doc comment reading "there is no URLSession here" was reported as a
 * use of URLSession.
 *
 * Comments may name anything. Code may not.
 *
 * String literals are tracked for one specific reason. Without them, the `//`
 * in `https://api.openai.com` reads as the start of a comment and the rest of
 * the line disappears — so a hard-coded endpoint, the exact thing this gate
 * exists to catch, became invisible to it. That was found by mutation: adding
 * an OpenAI URL to the scan bridge did not fail the test it was supposed to
 * fail. A gate nobody had tried to break would still be sitting here passing.
 */
function codeOnly(text) {
  let inBlock = false;
  return text
    .split('\n')
    .map((line) => {
      let output = '';
      let quote = null;
      for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        if (inBlock) {
          if (line.startsWith('*/', i)) {
            inBlock = false;
            i += 1;
          }
          continue;
        }
        if (quote) {
          // Keep the literal: its contents are code, and an endpoint hidden in
          // one is the whole point of searching.
          output += char;
          if (char === '\\') {
            if (i + 1 < line.length) {
              output += line[i + 1];
              i += 1;
            }
            continue;
          }
          if (char === quote) quote = null;
          continue;
        }
        if (char === '"' || char === "'" || char === '`') {
          quote = char;
          output += char;
          continue;
        }
        if (line.startsWith('/*', i)) {
          inBlock = true;
          i += 1;
          continue;
        }
        if (line.startsWith('//', i) || char === '#') break;
        output += char;
      }
      return output;
    })
    .join('\n');
}

/** Every file that participates in reading a page. */
const SCAN_SOURCES = [
  { path: 'ios/App/App/ScanNotesPlugin.swift', sentinel: 'VNRecognizeTextRequest' },
  {
    path: 'android/app/src/main/java/com/myjourneywithchrist/lifewithchrist/ScanNotesPlugin.java',
    sentinel: 'TextRecognizerOptions',
  },
  { path: 'src/platform/native-scan.ts', sentinel: 'registerPlugin' },
  { path: 'src/platform/web-scanner.ts', sentinel: 'unsupported' },
  { path: 'src/scan/session.ts', sentinel: 'reduceScan' },
  { path: 'src/views/ScanNotes.tsx', sentinel: 'Use text' },
];

/**
 * Services that would take a page off the device.
 *
 * Named individually rather than caught by a pattern, because the point is to
 * record what was considered and rejected. Each is a real product somebody
 * could reach for in an afternoon, and each would improve the numbers.
 */
const FORBIDDEN_SERVICES = [
  'api.openai.com',
  'openai',
  'vision.googleapis.com',
  'cloud.google.com/vision',
  'generativelanguage.googleapis.com',
  'gemini',
  'textract',
  'cognitiveservices.azure.com',
  'api.cognitive.microsoft',
  'cloudmersive',
  'ocr.space',
  'mathpix',
  'anthropic.com',
  'claude.ai',
];

/** Ways a page or its text could leave, whatever the destination. */
const FORBIDDEN_TRANSPORT = [
  'URLSession',
  'URLRequest',
  'HttpURLConnection',
  'OkHttpClient',
  'XMLHttpRequest',
  'sendBeacon',
  'WebSocket',
  'EventSource',
];

describe('scan notes keeps recognition on the device', () => {
  const sources = SCAN_SOURCES.map((entry) => {
    const text = read(entry.path);
    return { ...entry, text, code: codeOnly(text) };
  });

  it('reads every scan source, and each is really the file it claims', () => {
    // The floor. Everything below is "search these and find nothing", the
    // assertion shape that passes hardest when it examined nothing at all.
    expect(sources).toHaveLength(6);
    for (const { path, text, code, sentinel } of sources) {
      expect(text.length, `${path} is empty`).toBeGreaterThan(400);
      expect(text, `${path} does not contain ${sentinel}`).toContain(sentinel);
      // Comment-stripping must not have stripped the file: a codeOnly() that
      // returned whitespace would make every search below vacuous.
      expect(code.replace(/\s/g, '').length, `${path} has no code left`).toBeGreaterThan(200);
    }
  });

  it('names no cloud recognition service', () => {
    const hits = [];
    for (const { path, code } of sources) {
      for (const [index, line] of code.split('\n').entries()) {
        const lowered = line.toLowerCase();
        for (const term of FORBIDDEN_SERVICES) {
          if (lowered.includes(term)) hits.push(`${path}:${index + 1} mentions ${term}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('carries no way to send a page or its text anywhere', () => {
    const hits = [];
    for (const { path, code } of sources) {
      for (const [index, line] of code.split('\n').entries()) {
        for (const term of FORBIDDEN_TRANSPORT) {
          if (line.includes(term)) hits.push(`${path}:${index + 1} uses ${term}`);
        }
        // `fetch(` is too common a word to ban across the repository, and in
        // these six files there is no legitimate use of it.
        if (/\bfetch\s*\(/.test(line)) hits.push(`${path}:${index + 1} calls fetch()`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('uses the bundled Android model, not the downloaded one', () => {
    const source = read('android/app/build.gradle');
    const gradle = codeOnly(source);
    // The bundled artefact ships the Latin model inside the APK. Its sibling,
    // play-services-mlkit-text-recognition, fetches the model through Google
    // Play Services — which needs the network, and would make the promise
    // depend on a download nobody told the reader about.
    expect(gradle).toContain('com.google.mlkit:text-recognition');
    expect(gradle).not.toContain('play-services-mlkit-text-recognition');
    // And the floor for the strip: the comment explaining the rejection is
    // still there, so `gradle` above is a stripped file rather than an empty
    // one that would satisfy the negative assertion by containing nothing.
    expect(source).toContain('play-services-mlkit-text-recognition');
  });

  it('declares no network permission on Android', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    // ML Kit's transitive play-services dependencies merge INTERNET and
    // ACCESS_NETWORK_STATE into an application that declared neither. These
    // removals keep them out; the instrumented test proves the merged manifest
    // really lacks them on a device, which this cannot.
    for (const permission of ['INTERNET', 'ACCESS_NETWORK_STATE']) {
      const removal = new RegExp(
        `uses-permission[^>]*android:name="android\\.permission\\.${permission}"[^>]*tools:node="remove"`,
      );
      expect(manifest, `${permission} must be removed from the merged manifest`).toMatch(removal);
    }
  });

  it('asks for the camera only, and explains why', () => {
    const plist = read('ios/App/App/Info.plist');
    expect(plist).toContain('<key>NSCameraUsageDescription</key>');
    expect(plist).toMatch(/only when you choose to scan notes/);
    // No photo-library permission: PHPickerViewController runs out of process
    // and hands back one image, so there is nothing to ask for. A usage string
    // here would mean something had switched back to an API that can read the
    // whole library.
    expect(plist).not.toContain('NSPhotoLibraryUsageDescription');

    expect(read('ios/App/App/ScanNotesPlugin.swift')).toContain('PHPickerViewController');
    expect(
      read('android/app/src/main/java/com/myjourneywithchrist/lifewithchrist/ScanNotesPlugin.java'),
    ).toContain('ACTION_PICK_IMAGES');
  });

  it('never lets the recogniser guess at a word', () => {
    const swift = codeOnly(read('ios/App/App/ScanNotesPlugin.swift'));
    // Language correction substituted plausible wrong words on degraded pages
    // in the benchmark — "khn 3:16" became "she 3:16". A journal keeps
    // people's words; the person reviews the text, and the recogniser does not
    // get a vote on what it says.
    expect(swift).toMatch(/usesLanguageCorrection\s*=\s*false/);
    expect(swift).not.toMatch(/usesLanguageCorrection\s*=\s*true/);
  });

  it('logs nothing that could contain a page or its text', () => {
    const hits = [];
    const logging = [
      /\bprint\s*\(/,
      /NSLog\s*\(/,
      /\bLog\.[dveiw]\s*\(/,
      /console\.(log|info|warn|error)\s*\(/,
    ];
    for (const { path, code } of sources) {
      for (const [index, line] of code.split('\n').entries()) {
        if (logging.some((pattern) => pattern.test(line))) hits.push(`${path}:${index + 1}`);
      }
    }
    // Not one. A log line that seemed to carry only a length or a filename is
    // how the text ends up in a crash report.
    expect(hits).toEqual([]);
  });
});
