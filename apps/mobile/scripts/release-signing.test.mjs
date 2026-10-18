import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const { applyReleaseSigning } = createRequire(import.meta.url)('../plugins/with-release-signing.js');

// The shape of Expo's android/app/build.gradle template (SDK 50 onward).
const template = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            signingConfig signingConfigs.debug
            minifyEnabled enableProguardInReleaseBuilds
        }
    }
}`;

test('a local release build signs with the upload key named outside the repository', () => {
  const gradle = applyReleaseSigning(template);
  assert.match(gradle, /release \{\n\s+if \(project\.hasProperty\('WODANA_UPLOAD_STORE_FILE'\)\)/);
  assert.match(gradle, /storePassword project\.property\('WODANA_UPLOAD_STORE_PASSWORD'\)/);
  assert.match(gradle, /signingConfig project\.hasProperty\('WODANA_UPLOAD_STORE_FILE'\) \? signingConfigs\.release : signingConfigs\.debug/);
  // Debug builds keep the debug key.
  assert.match(gradle, /debug \{\n\s+signingConfig signingConfigs\.debug\n/);
  assert.equal(applyReleaseSigning(gradle), gradle, 'applying twice changes nothing');
});

test('no password or keystore is written into the build file', () => {
  const gradle = applyReleaseSigning(template);
  assert.doesNotMatch(gradle, /\.jks|upload-keystore/);
});

test('a changed template fails the prebuild instead of silently signing with the debug key', () => {
  assert.throws(() => applyReleaseSigning('android { }'), /expected signingConfigs/);
});
