#!/usr/bin/env bash
set -euo pipefail

identity='e322 Local Signing'
keychain="$HOME/Library/Keychains/login.keychain-db"
state_dir="$HOME/Library/Application Support/e322"
marker="$state_dir/local-signing.sha1"

if [[ ! -f "$keychain" ]]; then
  echo 'User Keychain was not found.' >&2
  exit 1
fi

existing=$(security find-certificate -c "$identity" -p "$keychain" 2>/dev/null || true)
if [[ -f "$marker" ]]; then
  if [[ -z "$existing" ]]; then
    echo 'The local e322 certificate is missing from Keychain. Restore the original certificate.' >&2
    exit 1
  fi
  fingerprint=$(printf '%s\n' "$existing" | openssl x509 -noout -fingerprint -sha1)
  if [[ "$fingerprint" != "$(cat "$marker")" ]]; then
    echo 'The e322 certificate has changed. Automatic signing-identity replacement is not allowed.' >&2
    exit 1
  fi
  echo 'The local e322 certificate is already installed.'
  exit 0
fi

if [[ -n "$existing" ]]; then
  echo 'A certificate named e322 Local Signing already exists. Check it manually.' >&2
  exit 1
fi

scratch=$(mktemp -d /tmp/e322-signing.XXXXXX)
chmod 700 "$scratch"
cleanup() { rm -rf "$scratch"; }
trap cleanup EXIT

password=$(openssl rand -hex 24)
openssl req -x509 -newkey rsa:3072 -nodes \
  -keyout "$scratch/key.pem" -out "$scratch/cert.pem" -days 3650 \
  -subj "/CN=$identity/" \
  -addext 'keyUsage=critical,digitalSignature' \
  -addext 'extendedKeyUsage=codeSigning' >/dev/null 2>&1
openssl pkcs12 -legacy -export \
  -inkey "$scratch/key.pem" -in "$scratch/cert.pem" \
  -out "$scratch/identity.p12" -passout "pass:$password" >/dev/null 2>&1

security import "$scratch/identity.p12" -k "$keychain" -P "$password" -T /usr/bin/codesign >/dev/null
fingerprint=$(openssl x509 -in "$scratch/cert.pem" -noout -fingerprint -sha1)
mkdir -p "$state_dir"
chmod 700 "$state_dir"
printf '%s\n' "$fingerprint" > "$marker"
chmod 600 "$marker"
echo 'The local e322 certificate was added to Keychain.'
