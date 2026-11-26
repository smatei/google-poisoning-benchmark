// Publishes what tools/build.mjs built:
// - site/ is force-pushed as a single commit to the gh-pages branch (GitHub Pages serves it): the branch keeps
//   no history, so the repository does not grow with the pages of every day
// - release/<date>/*.zip are uploaded to the GitHub release <date> (created if missing), with the gh CLI
//
//   node tools/publish.mjs [date ...] [--no-site] [--no-release] [--no-cleanup]
//
// date: the releases to upload; default: every folder in release/.
// - after the upload, release/<date> folders are deleted locally (they are on GitHub), except the newest kKeepReleases,
//   only when the GitHub release <date> has every file of the folder with the same size; --no-cleanup keeps them
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const kRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kSite = path.join(kRoot, 'site');
const kRelease = path.join(kRoot, 'release');
const kDatePattern = /^\d{4}-\d{2}-\d{2}$/;

// the newest release/<date> folders kept locally after the upload
const kKeepReleases = 1;

function Run(aCommand, aArgs, aOptions = {}) {
  console.log('> ' + aCommand + ' ' + aArgs.join(' '));
  const result = spawnSync(aCommand, aArgs, { stdio: aOptions.quiet ? 'pipe' : 'inherit', encoding: 'utf8',
    cwd: aOptions.cwd || kRoot });
  if (result.error) throw result.error;
  if (result.status !== 0 && !aOptions.allowFail) {
    throw new Error(aCommand + ' ' + aArgs.join(' ') + ' failed with ' + result.status);
  }
  return result;
}

function HasGh() {
  const result = spawnSync('gh', ['--version'], { stdio: 'pipe' });
  return !result.error && result.status === 0;
}

function PublishSite() {
  if (!fs.existsSync(path.join(kSite, 'index.html'))) throw new Error('site/ is not built: node tools/build.mjs');
  const remote = Run('git', ['remote', 'get-url', 'origin'], { quiet: true }).stdout.trim();
  const date = JSON.parse(fs.readFileSync(path.join(kSite, 'data', 'dates.json'), 'utf8'))[0];

  // a new repository each time: one commit, no history
  fs.rmSync(path.join(kSite, '.git'), { recursive: true, force: true });
  Run('git', ['init', '-q', '-b', 'gh-pages'], { cwd: kSite });
  Run('git', ['remote', 'add', 'origin', remote], { cwd: kSite });
  // the files are published as built: no CRLF conversion (a global core.autocrlf / core.safecrlf refuses LF files)
  Run('git', ['config', 'core.autocrlf', 'false'], { cwd: kSite });
  Run('git', ['config', 'core.safecrlf', 'false'], { cwd: kSite });
  Run('git', ['add', '-A'], { cwd: kSite });
  Run('git', ['commit', '-q', '-m', 'Google poisoning benchmark, last day ' + date], { cwd: kSite });
  Run('git', ['push', '-f', 'origin', 'gh-pages'], { cwd: kSite });
}

function PublishRelease(aDate) {
  const dir = path.join(kRelease, aDate);
  const files = fs.readdirSync(dir).map((f) => path.join(dir, f));
  if (!HasGh()) {
    console.log('\ngh (GitHub CLI) not found. Upload by hand: GitHub -> Releases -> Draft a new release, tag ' + aDate
      + ', title "Google poisoning benchmark ' + aDate + '", attach:\n  ' + files.join('\n  '));
    return;
  }
  const exists = Run('gh', ['release', 'view', aDate], { quiet: true, allowFail: true }).status === 0;
  if (exists) {
    Run('gh', ['release', 'upload', aDate, ...files, '--clobber']);
    // assets that are no longer built (e.g. a renamed source) are removed from the release
    const names = fs.readdirSync(dir);
    const assets = JSON.parse(Run('gh', ['release', 'view', aDate, '--json', 'assets'], { quiet: true }).stdout).assets;
    for (const asset of assets) {
      if (!names.includes(asset.name)) Run('gh', ['release', 'delete-asset', aDate, asset.name, '--yes']);
    }
  } else {
    Run('gh', ['release', 'create', aDate, ...files, '--title', 'Google poisoning benchmark ' + aDate,
      '--notes', 'Pages of every source for ' + aDate + ': scraped/<request>/N.html (page N+1, hard poisoning '
        + 'marked in the page) and parsed/<request>/serp.json; statistics in stats-' + aDate + '.json.']);
  }
}

// The release/<date> folders already on GitHub are deleted, except the newest kKeepReleases: a folder is deleted only
// when the release <date> has every file of it, with the same size.
function CleanupReleases() {
  if (!fs.existsSync(kRelease) || !HasGh()) return;
  const all = fs.readdirSync(kRelease).filter((d) => kDatePattern.test(d)).sort();
  for (const d of all.slice(0, Math.max(0, all.length - kKeepReleases))) {
    const dir = path.join(kRelease, d);
    const view = Run('gh', ['release', 'view', d, '--json', 'assets'], { quiet: true, allowFail: true });
    if (view.status !== 0) {
      console.log('release ' + d + ': kept locally (not on GitHub)');
      continue;
    }
    const sizes = new Map(JSON.parse(view.stdout).assets.map((a) => [a.name, a.size]));
    const missing = fs.readdirSync(dir).filter((f) => sizes.get(f) !== fs.statSync(path.join(dir, f)).size);
    if (missing.length) {
      console.log('release ' + d + ': kept locally, not uploaded (or another size): ' + missing.join(', '));
      continue;
    }
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('release ' + d + ': deleted locally (on GitHub)');
  }
}

function Main() {
  const args = process.argv.slice(2);
  const dates = args.filter((a) => kDatePattern.test(a));
  if (!args.includes('--no-site')) PublishSite();
  if (!args.includes('--no-release')) {
    const all = fs.existsSync(kRelease) ? fs.readdirSync(kRelease).filter((d) => kDatePattern.test(d)).sort() : [];
    for (const d of dates.length ? dates : all) PublishRelease(d);
    if (!args.includes('--no-cleanup')) CleanupReleases();
  }
}

Main();
