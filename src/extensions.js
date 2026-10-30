const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const stream = require('stream');

function unpackCrx(buffer) {
  if (buffer.length < 16) throw new Error('Invalid CRX file (too short)');
  const magic = buffer.toString('utf8', 0, 4);
  if (magic !== 'Cr24') throw new Error('Invalid CRX magic: ' + magic);
  const version = buffer.readUInt32LE(4);
  let zipOffset;
  if (version === 3) {
    const headerSize = buffer.readUInt32LE(8);
    zipOffset = 12 + headerSize;
  } else if (version === 2) {
    const pubkeyLen = buffer.readUInt32LE(8);
    const sigLen = buffer.readUInt32LE(12);
    zipOffset = 16 + pubkeyLen + sigLen;
  } else {
    throw new Error('Unsupported CRX version: ' + version);
  }
  return buffer.subarray(zipOffset);
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    client
      .get(
        url,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          },
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return resolve(fetchBuffer(res.headers.location));
          }
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
          }
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks)));
          res.on('error', reject);
        }
      )
      .on('error', reject);
  });
}

const unzipper = require('unzipper');

async function extractZip(zipBuf, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  try {
    const directory = await unzipper.Open.buffer(zipBuf);
    await directory.extract({ path: targetDir });
  } catch (err) {
    // Fallback in case unzipper encounters unusual headers
    const tmpZip = path.join(targetDir, '__temp.zip');
    fs.writeFileSync(tmpZip, zipBuf);
    try {
      const { execFileSync } = require('child_process');
      if (process.platform === 'win32') {
        execFileSync('tar', ['-xf', tmpZip, '-C', targetDir]);
      } else {
        try {
          execFileSync('unzip', ['-q', '-o', tmpZip, '-d', targetDir]);
        } catch {
          execFileSync('python3', [
            '-c',
            'import zipfile, sys; zf = zipfile.ZipFile(sys.argv[1]); zf.extractall(sys.argv[2]); zf.close()',
            tmpZip,
            targetDir,
          ]);
        }
      }
    } finally {
      try { fs.unlinkSync(tmpZip); } catch {}
    }
  }
}

async function downloadAndInstallExtension(id, extensionsDir, ses) {
  const crxUrl = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=130.0&acceptformat=crx2,crx3&x=id%3D${id}%26uc`;
  const crxData = await fetchBuffer(crxUrl);
  const zipData = unpackCrx(crxData);
  const extDir = path.join(extensionsDir, id);
  if (fs.existsSync(extDir)) {
    fs.rmSync(extDir, { recursive: true, force: true });
  }
  fs.mkdirSync(extDir, { recursive: true });
  await extractZip(zipData, extDir);

  const manifestPath = path.join(extDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('Extracted extension is missing manifest.json');
  }

  const ext = await ses.loadExtension(extDir, { allowFileAccess: true });
  return ext;
}

async function downloadAndInstallFirefoxExtension(urlOrSlug, extensionsDir, ses) {
  let xpiUrl = urlOrSlug.trim();
  let extId = 'fx-' + Date.now().toString(36);

  // If user provided an AMO page URL (e.g. addons.mozilla.org/.../addon/ublock-origin/)
  if (!xpiUrl.endsWith('.xpi')) {
    const slugMatch = xpiUrl.match(/\/addon\/([a-z0-9_-]+)/i);
    const slug = slugMatch ? slugMatch[1] : xpiUrl;
    extId = 'fx-' + slug.replace(/[^a-z0-9_-]/gi, '');
    try {
      const apiRes = await fetchBuffer(`https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(slug)}/`);
      const apiData = JSON.parse(apiRes.toString('utf8'));
      if (apiData.current_version?.file?.url) {
        xpiUrl = apiData.current_version.file.url;
      } else {
        throw new Error('Could not find XPI download link for ' + slug);
      }
    } catch (err) {
      throw new Error(`Firefox addon API error: ${err.message}`);
    }
  } else {
    // Extract a nice ID from filename
    const filenameMatch = xpiUrl.match(/\/([^\/?#]+)\.xpi/i);
    if (filenameMatch) {
      extId = 'fx-' + filenameMatch[1].replace(/[^a-z0-9_-]/gi, '').slice(0, 32);
    }
  }

  const xpiData = await fetchBuffer(xpiUrl);
  const extDir = path.join(extensionsDir, extId);
  if (fs.existsSync(extDir)) {
    fs.rmSync(extDir, { recursive: true, force: true });
  }
  fs.mkdirSync(extDir, { recursive: true });
  await extractZip(xpiData, extDir);

  const manifestPath = path.join(extDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('Extracted Firefox extension is missing manifest.json');
  }

  // Sanitize Firefox manifest for Chromium
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    delete manifest.browser_specific_settings;
    delete manifest.applications;
    if (!manifest.manifest_version) manifest.manifest_version = 2;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  } catch {}

  const ext = await ses.loadExtension(extDir, { allowFileAccess: true });
  return ext;
}

function loadAllExtensions(extensionsDir, ses, disabledList = []) {
  if (!fs.existsSync(extensionsDir)) return [];
  const entries = fs.readdirSync(extensionsDir);
  const loaded = [];
  for (const entry of entries) {
    if (disabledList && disabledList.includes(entry)) continue;
    const extDir = path.join(extensionsDir, entry);
    if (!fs.statSync(extDir).isDirectory()) continue;
    const manifestPath = path.join(extDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const ext = ses.loadExtension(extDir, { allowFileAccess: true });
      loaded.push(ext);
    } catch (e) {
      console.error(`Failed to load extension ${entry}:`, e.message);
    }
  }
  return loaded;
}

module.exports = {
  downloadAndInstallExtension,
  downloadAndInstallFirefoxExtension,
  loadAllExtensions,
};
