const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { signAsync } = require('@electron/osx-sign');

const identity = 'e322 Local Signing';
const app = path.resolve(__dirname, '..', 'release', 'mac-arm64', 'libfurry.app');
const keychain = path.join(os.homedir(), 'Library', 'Keychains', 'login.keychain-db');
const marker = path.join(os.homedir(), 'Library', 'Application Support', 'e322', 'local-signing.sha1');

async function main() {
  if (!fs.existsSync(app)) throw new Error('Build release/mac-arm64/libfurry.app first');
  if (!fs.existsSync(marker)) throw new Error('Create the local e322 certificate first');
  const certificate = execFileSync('security', ['find-certificate', '-c', identity, '-p', keychain]);
  const fingerprint = execFileSync('openssl', ['x509', '-noout', '-fingerprint', '-sha1'], { input: certificate }).toString().trim();
  if (fingerprint !== fs.readFileSync(marker, 'utf8').trim()) throw new Error('The e322 certificate does not match the original');

  await signAsync({
    app,
    keychain,
    identity,
    identityValidation: false,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    optionsForFile: () => ({ hardenedRuntime: false, timestamp: 'none' }),
  });
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=1', app], { stdio: 'inherit' });
  console.log('The local libfurry signature was verified.');
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
