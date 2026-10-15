"""Package one APK, complete Windows directory, DMG and a signed IPA; reject unsigned iOS output."""
import hashlib
import json
from pathlib import Path
import shutil
import zipfile

manifest = json.loads(Path('release-readiness.json').read_text())
version = manifest['version']
root = Path('.build/release-artifacts')
out = Path('.build/release-assets')
out.mkdir(parents=True, exist_ok=True)

def one(pattern):
    matches = list(root.rglob(pattern))
    assert len(matches) == 1, f'Expected exactly one {pattern}, found {len(matches)}'
    return matches[0]

apk = one('*.apk')
dmg = one('*.dmg')
ipa = one('*.ipa')
assert not any(word in ipa.name.lower() for word in ['unsigned', 'not-installable']), 'Unsigned IPA cannot be released as installable'
with zipfile.ZipFile(ipa) as archive:
    names = archive.namelist()
    assert any(n.endswith('/embedded.mobileprovision') for n in names), 'IPA provisioning is missing'
    assert any('/_CodeSignature/CodeResources' in n for n in names), 'IPA signature is missing'
# The iOS build must additionally verify the signature on macOS before setting the signed-IPA release gate.
exe = one('BotHub.exe')
assert (exe.parent / 'tdjson.dll').is_file(), 'Native Windows TDLib DLL is missing'
windows = out / f'BotHub-{version}-Windows-x64.zip'
with zipfile.ZipFile(windows, 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in exe.parent.rglob('*'):
        if path.is_file():
            archive.write(path, Path('BotHub') / path.relative_to(exe.parent))
for source, suffix in [(apk, 'Android.apk'), (dmg, 'macOS-arm64.dmg'), (ipa, 'iOS.ipa')]:
    shutil.copy2(source, out / f'BotHub-{version}-{suffix}')
checksums = []
for path in sorted(out.iterdir()):
    if path.is_file() and path.name != 'SHA256SUMS.txt':
        with path.open('rb') as stream:
            checksums.append(hashlib.file_digest(stream, 'sha256').hexdigest() + '  ' + path.name)
(out / 'SHA256SUMS.txt').write_text('\n'.join(checksums) + '\n')
Path('.build/release-notes.md').write_text(f'''BotHub {version}

Verified source commit: `{manifest['tested_commit']}`.
Native build: https://github.com/az0512124155azz-sys/Botify/actions/runs/{manifest['native_run_id']}

- Android APK
- Windows x64 package: extract the entire ZIP and run BotHub.exe with its bundled TDLib DLL.
- macOS arm64 DMG
- Signed and provisioned iOS IPA; installation remains subject to its Apple provisioning method.
- SHA256SUMS.txt for every package.

Release gates and actual test coverage are recorded in docs/verification.md at the verified source revision.
''')
print('Prepared all platform packages and checksums')
