// A local release build (`npx expo prebuild` then `./gradlew bundleRelease`) signs with the Play upload key
// named in ~/.gradle/gradle.properties, never with a file or password in this repository:
//
//   WODANA_UPLOAD_STORE_FILE=/absolute/path/to/upload-keystore.jks
//   WODANA_UPLOAD_STORE_PASSWORD=…
//   WODANA_UPLOAD_KEY_ALIAS=…
//   WODANA_UPLOAD_KEY_PASSWORD=…
//
// Without those properties the release build keeps Expo's default. EAS Build ignores all of this: it signs
// with the keystore uploaded through `eas credentials`.
const { withAppBuildGradle } = require('expo/config-plugins');

const PROPERTY = 'WODANA_UPLOAD_STORE_FILE';
const RELEASE_CONFIG = `        release {
            if (project.hasProperty('${PROPERTY}')) {
                storeFile file(project.property('${PROPERTY}'))
                storePassword project.property('WODANA_UPLOAD_STORE_PASSWORD')
                keyAlias project.property('WODANA_UPLOAD_KEY_ALIAS')
                keyPassword project.property('WODANA_UPLOAD_KEY_PASSWORD')
            }
        }
`;

/** Adds the upload-key signing config to an app/build.gradle and uses it for release when configured. */
function applyReleaseSigning(gradle) {
  if (gradle.includes(PROPERTY)) return gradle;
  const withConfig = gradle.replace(/signingConfigs\s*\{\n/, (match) => `${match}${RELEASE_CONFIG}`);
  const withRelease = withConfig.replace(/(buildTypes\s*\{[\s\S]*?\brelease\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
    `$1signingConfig project.hasProperty('${PROPERTY}') ? signingConfigs.release : signingConfigs.debug`);
  if (withConfig === gradle || withRelease === withConfig) throw new Error('with-release-signing: app/build.gradle no longer has the expected signingConfigs/buildTypes blocks.');
  return withRelease;
}

const withReleaseSigning = (config) => withAppBuildGradle(config, (mod) => {
  if (mod.modResults.language !== 'groovy') throw new Error('with-release-signing: expected a Groovy app/build.gradle.');
  mod.modResults.contents = applyReleaseSigning(mod.modResults.contents);
  return mod;
});

module.exports = withReleaseSigning;
module.exports.applyReleaseSigning = applyReleaseSigning;
