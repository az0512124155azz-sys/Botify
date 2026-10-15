"""Wrap upstream dynamic-library slices in frameworks supported by CocoaPods.

The expensive upstream XCFramework stays unchanged in the native cache. Each CI
checkout converts its local copy before CocoaPods embeds the dynamic frameworks.
"""
import plistlib
import shutil
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent.parent
source = root / 'modules/bothub-tdlib/ios/libtdjson.xcframework'
info = plistlib.loads((source / 'Info.plist').read_bytes())
libraries = info['AvailableLibraries']
if all(lib['LibraryPath'].endswith('.framework') for lib in libraries):
    print('TDLib already contains framework slices')
else:
    staging = root / '.build/ios-frameworks'
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True)
    command = ['xcodebuild', '-create-xcframework']
    for lib in libraries:
        if lib['SupportedPlatform'] != 'ios':
            raise ValueError('Unexpected TDLib platform')
        binary = source / lib['LibraryIdentifier'] / lib['LibraryPath']
        framework = staging / lib['LibraryIdentifier'] / 'tdjson.framework'
        framework.mkdir(parents=True)
        destination = framework / 'tdjson'
        shutil.copy2(binary, destination)
        subprocess.run(['install_name_tool', '-id', '@rpath/tdjson.framework/tdjson', str(destination)], check=True)
        platform = 'iPhoneSimulator' if lib.get('SupportedPlatformVariant') == 'simulator' else 'iPhoneOS'
        metadata = {
            'CFBundleExecutable': 'tdjson', 'CFBundleIdentifier': 'com.botify.tdjson',
            'CFBundleName': 'tdjson', 'CFBundlePackageType': 'FMWK',
            'CFBundleShortVersionString': '1.8.68', 'CFBundleVersion': '1',
            'CFBundleSupportedPlatforms': [platform], 'MinimumOSVersion': '15.1',
        }
        (framework / 'Info.plist').write_bytes(plistlib.dumps(metadata))
        subprocess.run(['otool', '-L', str(destination)], check=True)
        command += ['-framework', str(framework)]
    output = staging / 'libtdjson.xcframework'
    subprocess.run(command + ['-output', str(output)], check=True)
    shutil.rmtree(source)
    shutil.copytree(output, source)
    print('Packaged TDLib as embeddable dynamic frameworks')
